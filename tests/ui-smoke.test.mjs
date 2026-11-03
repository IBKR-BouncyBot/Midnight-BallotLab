/**
 * Handler-level integration test using a deliberately minimal synthetic DOM.
 * Exercises the actual application and cryptographic library in Node.
 * This is NOT browser, rendering, layout, accessibility or camera testing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('synthetic DOM: setup, ballots, QR, threshold tally, public verification and tamper rejection', { timeout: 180_000 }, async () => {
  const html = await readFile(new URL('../src/legacy.html', import.meta.url), 'utf8');
  const elements = [];

  class Element {
    constructor(tagName = 'div', id = '') {
      Object.assign(this, {
        tagName, id, children: [], handlers: {}, dataset: {}, hidden: false,
        disabled: false, value: '', checked: false, attributes: {},
        className: '', style: {}, files: [],
      });
      this.classList = { toggle() {}, add() {} };
      elements.push(this);
    }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    prepend(item) { this.children.unshift(item); }
    remove() {}
    click() {}
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(type, handler) { (this.handlers[type] ??= []).push(handler); }
  }

  const ids = new Map();
  for (const match of html.matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1], match[2]);
    assert(!ids.has(element.id), `Duplicate HTML id: ${element.id}`);
    element.hidden = match[0].includes(' hidden');
    const initialValue = /\bvalue="([^"]*)"/.exec(match[0]);
    if (initialValue) element.value = initialValue[1];
    ids.set(element.id, element);
  }
  ids.get('candidate-list').value = 'Option A\nOption B\nOption C';
  ids.get('voter-count').value = '2';
  for (const step of ['setup', 'vote', 'tally', 'verify']) {
    const button = new Element('button');
    button.dataset.step = step;
    ids.get(`panel-${step}`).dataset.panel = step;
  }
  const workspace = new Element();
  function selectAll(selector) {
    if (selector === '[data-panel]') return elements.filter(element => element.dataset.panel);
    if (selector === '[data-step]') return elements.filter(element => element.dataset.step);
    if (selector === '[data-go]') return [];
    const input = /input\[name="(\w+)"\](:checked)?/.exec(selector);
    if (input) return elements.filter(element => element.tagName === 'input' && element.name === input[1] && (!input[2] || element.checked));
    return [];
  }

  const globals = ['document', 'confirm', 'location'];
  const previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    globalThis.document = {
      getElementById: id => ids.get(id),
      createElement: tag => new Element(tag),
      querySelectorAll: selectAll,
      querySelector: selector => selector === '.work-main' ? workspace : selectAll(selector)[0],
      body: new Element('body'),
    };
    globalThis.confirm = () => true;
    globalThis.location = { reload() {} };
    await import(new URL('../src/app.mjs', import.meta.url));

    async function trigger(id, type) {
      const element = ids.get(id);
      assert(element, `Missing UI element: ${id}`);
      assert(element.handlers[type]?.length, `Missing handler: ${id}/${type}`);
      for (const handler of element.handlers[type]) handler({ preventDefault() {} });
      const started = Date.now();
      if (ids.get('global-status').className.includes('working')) {
        for (const field of ['expected-manifest', 'expected-record', 'receipt-input']) {
          assert(ids.get(field).disabled, `${field} must be disabled while checks are running`);
        }
      }
      while (ids.get('global-status').className.includes('working')) {
        assert(Date.now() - started < 90_000, `Handler timed out: ${id}`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert(!ids.get('global-status').className.includes('error'), ids.get('global-status').textContent);
    }

    await trigger('setup-form', 'submit');
    assert.equal(ids.get('metric-phase').textContent, 'Voting open');
    for (let voter = 0; voter < 2; voter++) {
      selectAll('input[name="candidate"]').forEach((input, index) => { input.checked = index === voter; });
      await trigger('vote-form', 'submit');
      assert.equal(ids.get('metric-ballots').textContent, String(voter + 1));
    }
    assert(ids.get('cast-ballot').disabled, 'Used credentials must not be offered another vote');
    assert(ids.get('receipt-qr').innerHTML.startsWith('<svg'), 'Receipt QR SVG must be rendered');
    await trigger('close-election', 'click');
    assert.equal(ids.get('metric-phase').textContent, 'Voting closed');
    await trigger('finalize-election', 'click');
    assert.equal(ids.get('metric-phase').textContent, 'Finalized locally');
    assert.equal(ids.get('result-bars').children.length, 3);
    await trigger('verify-current', 'click');
    assert(ids.get('verification-result').children[0].textContent.includes('passed'));
    assert.equal(ids.get('verification-result').hidden, false);

    // Obtain a genuine successful receipt check, then ensure editing its input
    // cannot leave that success attached to a different, unchecked receipt.
    const receiptCode = `mbl1:${ids.get('expected-manifest').value}:${ids.get('receipt-id').textContent}`;
    ids.get('receipt-input').value = receiptCode;
    await trigger('receipt-input', 'input');
    await trigger('check-receipt', 'click');
    assert(ids.get('receipt-check-result').textContent.startsWith('Receipt matches'));
    ids.get('receipt-input').value = `${receiptCode}x`;
    await trigger('receipt-input', 'input');
    assert.equal(ids.get('receipt-check-result').textContent, '', 'Editing the receipt must invalidate its previous result');
    assert.equal(ids.get('verification-result').hidden, false, 'Editing a receipt does not change the verified public record');
    ids.get('receipt-input').value = receiptCode;

    // Both independently supplied pins affect the meaning of the displayed
    // verification result; changing either must invalidate record AND receipt.
    for (const pin of ['expected-manifest', 'expected-record']) {
      await trigger('check-receipt', 'click');
      assert(ids.get('receipt-check-result').textContent.startsWith('Receipt matches'));
      const original = ids.get(pin).value;
      ids.get(pin).value = '0'.repeat(64);
      await trigger(pin, 'input');
      assert.equal(ids.get('verification-result').hidden, true, `${pin} edit must hide old record verification`);
      assert.equal(ids.get('tamper-panel').hidden, true, `${pin} edit must hide controls tied to old verification`);
      assert.equal(ids.get('receipt-check-result').textContent, '', `${pin} edit must clear old receipt verification`);
      ids.get(pin).value = original;
      await trigger(pin, 'input');
      await trigger('verify-imported', 'click');
      assert(ids.get('verification-result').children[0].textContent.includes('passed'));
    }
    await trigger('tamper-test', 'click');
    assert.equal(ids.get('verification-result').children[0].textContent, 'Tampered copy rejected');
  } finally {
    for (const key of globals) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
