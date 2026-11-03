/** Strict JSON transport for public native election data.
 * Reject ambiguous object fields and number spellings before JSON.parse
 * creates any objects.
 */
export const BROWSER_JSON_LIMIT = 8 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 64;

function checkLimit(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid JSON byte limit');
}

/** Preserve a BOM so it is rejected as JSON, and reject malformed UTF-8. */
export function decodeJsonUtf8(bytes, { maxBytes = BROWSER_JSON_LIMIT } = {}) {
  checkLimit(maxBytes);
  if (!(bytes instanceof Uint8Array)) throw new TypeError('JSON input must be UTF-8 bytes');
  if (bytes.byteLength > maxBytes) throw new RangeError('JSON input exceeds the byte limit');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new SyntaxError('JSON input is not valid UTF-8'); }
}

export function parseStrictJson(source, { maxBytes = BROWSER_JSON_LIMIT, maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  checkLimit(maxBytes);
  if (typeof source !== 'string') throw new TypeError('JSON input must be text');
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 256) throw new RangeError('Invalid JSON nesting limit');
  if (source.length > maxBytes) throw new RangeError('JSON input exceeds the byte limit');
  // Count UTF-8 bytes without allocating an encoded copy of untrusted input.
  let bytes = 0;
  for (let offset = 0; offset < source.length; offset++) {
    const code = source.charCodeAt(offset);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && source.charCodeAt(offset + 1) >= 0xdc00 && source.charCodeAt(offset + 1) <= 0xdfff) {
      bytes += 4; offset++;
    } else bytes += 3;
    if (bytes > maxBytes) throw new RangeError('JSON input exceeds the byte limit');
  }

  let position = 0;
  const fail = message => { throw new SyntaxError(`${message} at position ${position}`); };
  const digit = char => char >= '0' && char <= '9';
  const whitespace = () => {
    while (position < source.length && ' \t\r\n'.includes(source[position])) position++;
  };
  function string(decode = false) {
    const start = position++;
    while (position < source.length) {
      const char = source[position++];
      if (char === '"') return decode ? JSON.parse(source.slice(start, position)) : undefined;
      if (char.charCodeAt(0) < 0x20) fail('Control character in JSON string');
      if (char === '\\') {
        const escape = source[position++];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(position, position + 4))) fail('Invalid JSON Unicode escape');
          position += 4;
        } else if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) {
          fail('Invalid JSON string escape');
        }
      }
    }
    fail('Unterminated JSON string');
  }
  function number() {
    const start = position;
    if (source[position] === '-') position++;
    if (!digit(source[position])) fail('Invalid JSON number');
    if (source[position] === '0') position++;
    else while (digit(source[position])) position++;
    if (['.', 'e', 'E'].includes(source[position])) fail('Fractional or exponent-form JSON numbers are not accepted');
    const token = source.slice(start, position);
    if (token === '-0') fail('Negative zero is not canonical');
    if (token.length - (token[0] === '-' ? 1 : 0) > 16 || !Number.isSafeInteger(Number(token))) fail('Unsafe JSON integer');
  }
  function value(depth) {
    whitespace();
    const char = source[position];
    if (char === '"') { string(); return; }
    if (char === '-' || digit(char)) { number(); return; }
    for (const literal of ['true', 'false', 'null']) {
      if (source.startsWith(literal, position)) { position += literal.length; return; }
    }
    if (char !== '{' && char !== '[') fail('Expected JSON value');
    if (depth >= maxDepth) fail('JSON nesting limit exceeded');
    const object = char === '{';
    const end = object ? '}' : ']';
    const keys = object ? new Set() : null;
    position++; whitespace();
    if (source[position] === end) { position++; return; }
    for (;;) {
      if (object) {
        if (source[position] !== '"') fail('Expected JSON object field');
        const key = string(true);
        if (keys.has(key)) fail('Duplicate JSON object field');
        keys.add(key);
        whitespace();
        if (source[position++] !== ':') fail('Expected colon after JSON object field');
      }
      value(depth + 1);
      whitespace();
      if (source[position] === end) { position++; return; }
      if (source[position++] !== ',') fail('Expected comma or end of JSON container');
      whitespace();
    }
  }
  value(0); whitespace();
  if (position !== source.length) fail('Unexpected content after JSON value');
  // Native parsing handles __proto__ as an own data property, never assignment
  // through Object.prototype's setter. The scanner does not construct objects.
  return JSON.parse(source);
}
