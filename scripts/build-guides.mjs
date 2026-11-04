import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = 'https://github.com/IBKR-BouncyBot/Midnight-BallotLab';
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const slug = value => value.toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');

function documentLink(href, source) {
  if (href.startsWith('#')) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) throw new Error('Unsupported guide link scheme');
  const [file, fragment] = href.split('#');
  const path = posix.normalize(posix.join(posix.dirname(source), file));
  if (path.startsWith('../') || path.startsWith('/')) throw new Error('Guide link escapes repository');
  const pages = { 'docs/NATIVE_MIDNIGHT.md': './technical-guide.html', 'docs/NATIVE_NETWORK.md': './network-guide.html',
    LICENSE: './license.html#license-text', 'NOTICE.md': './license.html#project-notice', 'THIRD_PARTY_NOTICES.md': './license.html#third-party-notices' };
  if (pages[path]) return pages[path] + (fragment && !pages[path].includes('#') ? `#${fragment}` : '');
  return `${repository}/${file.endsWith('/') ? 'tree' : 'blob'}/main/${encodeURI(path)}${fragment ? `#${fragment}` : ''}`;
}

// A deliberately small renderer for the Markdown constructs in the owned guides.
// Raw HTML is escaped; no client script, external renderer or runtime fetch is used.
function inline(text, source) {
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|<(https?:\/\/[^>]+)>|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let result = '', previous = 0;
  for (const match of text.matchAll(pattern)) {
    result += escape(text.slice(previous, match.index));
    if (match[1] !== undefined) result += `<code>${escape(match[1])}</code>`;
    else if (match[2] !== undefined || match[4] !== undefined) {
      const href = documentLink(match[3] ?? match[4], source);
      const external = /^https?:/.test(href);
      result += `<a href="${escape(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inline(match[2] ?? match[4], source)}${external ? '<span class="visually-hidden"> (opens in a new tab)</span>' : ''}</a>`;
    } else if (match[5] !== undefined) result += `<strong><em>${escape(match[5])}</em></strong>`;
    else if (match[6] !== undefined) result += `<strong>${escape(match[6])}</strong>`;
    else result += `<em>${escape(match[7])}</em>`;
    previous = match.index + match[0].length;
  }
  return result + escape(text.slice(previous));
}

export function renderGuideMarkdown(markdown, source) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n'), html = [], headings = [], ids = new Map();
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (/^```/.test(line)) {
      const code = []; index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index === lines.length) throw new Error('Unclosed guide code fence');
      index++; html.push(`<pre tabindex="0"><code>${escape(code.join('\n'))}</code></pre>`); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const base = slug(heading[2]), duplicate = ids.get(base) ?? 0; ids.set(base, duplicate + 1);
      const id = base + (duplicate ? `-${duplicate}` : ''), level = Math.min(6, heading[1].length + 1);
      html.push(`<h${level} id="${id}">${inline(heading[2], source)}</h${level}>`);
      if (heading[1].length === 2) headings.push({ id, label: heading[2] });
      index++; continue;
    }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? '')) {
      const headers = cells(line); index += 2; const rows = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const row = cells(lines[index++]);
        if (row.length !== headers.length) throw new Error('Inconsistent guide table');
        rows.push(`<tr>${row.map(value => `<td>${inline(value, source)}</td>`).join('')}</tr>`);
      }
      html.push(`<div class="guide-table" role="region" aria-label="Documentation table" tabindex="0"><table><thead><tr>${headers.map(value => `<th scope="col">${inline(value, source)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`); continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      html.push(`<blockquote><p>${inline(quote.join(' '), source)}</p></blockquote>`); continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line), items = [];
      const marker = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (index < lines.length && marker.test(lines[index])) {
        const item = [lines[index++].replace(marker, '')];
        while (index < lines.length && /^ {2,}\S/.test(lines[index]) && !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[index])) item.push(lines[index++].trim());
        items.push(`<li>${inline(item.join(' '), source)}</li>`);
      }
      const tag = ordered ? 'ol' : 'ul'; html.push(`<${tag}>${items.join('')}</${tag}>`); continue;
    }
    const paragraph = [line]; index++;
    while (index < lines.length && lines[index].trim() && !/^(?:#{1,6}\s|```|>\s?|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(lines[index])) paragraph.push(lines[index++]);
    html.push(`<p>${inline(paragraph.join(' '), source)}</p>`);
  }
  return { html: html.join('\n'), contents: headings.map(({ id, label }) => `<a href="#${id}">${escape(label)}</a>`).join('\n') };
}

export async function buildGuides(root, destination) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const header = `<header class="masthead"><a class="brand" href="./" aria-label="Ballot Lab home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>ballot<span class="brand-light">lab</span><small>MIDNIGHT VOTING RESEARCH</small></span></a><nav class="masthead-links" aria-label="Main navigation"><span class="version">v${escape(version)}</span><a href="./">Try the demo</a><a href="${repository}" target="_blank" rel="noopener noreferrer">View source ↗<span class="visually-hidden"> (opens in a new tab)</span></a></nav></header>`;
  const navigation = '<nav class="guide-navigation" aria-label="Guides"><a href="./how-it-works.html">How the demo works</a><a href="./technical-guide.html">Technical guide</a><a href="./network-guide.html">Wallet &amp; network guide</a><a href="./license.html">License &amp; notices</a></nav>';
  const footer = `<footer class="page-footer"><p>Midnight Ballot Lab <span>·</span> Learning &amp; research</p><div><a href="./">Try the demo</a><a href="${repository}" target="_blank" rel="noopener noreferrer">View source ↗<span class="visually-hidden"> (opens in a new tab)</span></a><a href="./license.html">Noncommercial license</a></div><p class="footer-note">Independent voting research. This application does not imply Midnight endorsement.</p></footer>`;
  await mkdir(destination, { recursive: true });
  const pages = [{ name: 'how-it-works' }, { name: 'technical-guide', source: 'docs/NATIVE_MIDNIGHT.md' },
    { name: 'network-guide', source: 'docs/NATIVE_NETWORK.md' }, { name: 'license', source: 'LICENSE' }];
  for (const page of pages) {
    let template = await readFile(join(root, 'src', `${page.name}.html`), 'utf8');
    const currentNavigation = navigation.replace(`href="./${page.name}.html"`, `href="./${page.name}.html" aria-current="page"`);
    const values = { HEADER: header, NAVIGATION: currentNavigation, FOOTER: footer };
    if (page.source) {
      const source = await readFile(join(root, page.source), 'utf8'), rendered = renderGuideMarkdown(source, page.source);
      values.CONTENT = rendered.html; values.CONTENTS = rendered.contents;
      if (page.name === 'license') {
        values.LICENSE_SOURCE = escape(source);
        values.NOTICE = renderGuideMarkdown(await readFile(join(root, 'NOTICE.md'), 'utf8'), 'NOTICE.md').html;
        values.THIRD_PARTY = renderGuideMarkdown(await readFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'), 'THIRD_PARTY_NOTICES.md').html;
      }
    }
    template = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
      if (!(key in values)) throw new Error('Unknown guide template slot');
      return values[key];
    });
    await writeFile(join(destination, `${page.name}.html`), template);
  }
  return pages.map(page => `${page.name}.html`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pages = await buildGuides(root, join(root, 'dist'));
  console.log(JSON.stringify({ builtGuides: pages }));
}
