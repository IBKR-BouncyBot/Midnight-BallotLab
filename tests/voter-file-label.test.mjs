import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoterFileLabels, receiptFilenameForLabel } from '../src/voter-file-label.mjs';

// Inert formatting fixtures only; never wallet credentials or proof witnesses.
const firstKey = 'a7'.repeat(32), secondKey = 'b8'.repeat(32);

test('voter labels normalize keys and retain the first filename for repeated downloads', () => {
  const labels = createVoterFileLabels();
  assert.equal(labels.lookup(firstKey), null);
  assert.equal(labels.remember('  ' + firstKey.toUpperCase() + '\n', '000001'), '000001');
  assert.equal(labels.remember(firstKey, '000002'), '000001');
  assert.equal(labels.lookup(firstKey), '000001');
  assert.equal(labels.remember(secondKey, '000002'), '000002');
  assert.equal(labels.lookup(secondKey.toUpperCase()), '000002');
  assert.equal(receiptFilenameForLabel(labels.lookup(firstKey)), 'midnight-voter-000001-receipt.json');
});

test('exact counter and timestamp fallback filenames can restore a private session label', () => {
  const labels = createVoterFileLabels();
  assert.equal(labels.import(firstKey, 'midnight-voter-key-000123.private.txt'), '000123');
  const fallback = '1793959200123-000004';
  assert.equal(labels.import(secondKey, `midnight-voter-key-${fallback}.private.txt`), fallback);
  assert.equal(receiptFilenameForLabel(fallback), `midnight-voter-${fallback}-receipt.json`);
  assert.equal(labels.import(firstKey, 'midnight-voter-key-000999.private.txt'), '000123');
  assert.equal(labels.import(firstKey, 'renamed-key.txt'), '000123');
});

test('renamed and arbitrary filenames do not become receipt labels', () => {
  for (const filename of ['renamed-key.txt', '../midnight-voter-key-000001.private.txt',
    'midnight-voter-key-000001.private.txt/extra', 'midnight-voter-key-000001.private.txt\n',
    'Midnight-voter-key-000001.private.txt', 'midnight-voter-key-000001.private.TXT',
    'midnight-voter-key-secret-description.private.txt', 'midnight-voter-key-000001.json',
    'midnight-voter-key-0000001.private.txt', 'midnight-voter-key-000000.private.txt', null, {}, 'x'.repeat(1000)]) {
    const labels = createVoterFileLabels();
    assert.equal(labels.import(firstKey, filename), null);
    assert.equal(labels.lookup(firstKey), null);
  }
});

test('receipt filenames accept only bounded canonical numeric labels', () => {
  for (const label of ['000001', '999999', '1000000', '9007199254740991', '1-000001', '8640000000000000-000001']) {
    assert.equal(receiptFilenameForLabel(label), `midnight-voter-${label}-receipt.json`);
  }
  for (const label of ['', '1', '000000', '0000001', '9007199254740992', '10000000000000000',
    '0-000001', '01-000001', '8640000000000001-000001', '1793959200123-0',
    '1793959200123-0000001', '1793959200123-000000', '1793959200123-000001-extra',
    '../000001', '000001\n', '000001 ', '000001.json', 'choice-blue', 1, null, undefined, {}]) {
    assert.equal(receiptFilenameForLabel(label), null);
    assert.throws(() => createVoterFileLabels().remember(firstKey, label), /Invalid voter file label/);
  }
});

test('labels remain private to one helper instance and clear removes all associations', () => {
  const first = createVoterFileLabels(), other = createVoterFileLabels();
  first.remember(firstKey, '000001'); first.remember(secondKey, '000002');
  assert.equal(other.lookup(firstKey), null);
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(Object.keys(first).sort(), ['clear', 'import', 'lookup', 'remember']);
  assert.equal(JSON.stringify(first), '{}', 'The API must not serialize keys or associations');
  first.clear();
  assert.equal(first.lookup(firstKey), null); assert.equal(first.lookup(secondKey), null);
  assert.equal(first.remember(firstKey, '000003'), '000003');
});

test('invalid private keys are rejected without learning or exposing their input', () => {
  const labels = createVoterFileLabels();
  for (const key of [null, '0'.repeat(64), 'not-a-key', firstKey + 'ff']) {
    for (const operation of [() => labels.remember(key, '000001'),
      () => labels.import(key, 'midnight-voter-key-000001.private.txt'), () => labels.lookup(key)]) {
      assert.throws(operation, error => {
        assert.equal(error.cause, undefined);
        if (typeof key === 'string') assert.ok(!error.message.includes(key));
        return true;
      });
    }
  }
  assert.equal(labels.lookup(firstKey), null);
});

