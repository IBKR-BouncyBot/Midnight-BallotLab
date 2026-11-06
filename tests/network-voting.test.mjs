// Display-boundary fixtures only; actual generated-ledger tests run separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeNetworkVoting } from '../src/network-voting.mjs';

const OPEN = 2_000_000_000n, CLOSE = OPEN + 600n;
const state = Object.freeze({ phase: 1n, keysConfigured: true, candidateCount: 3n,
  opensAt: OPEN, closesAt: CLOSE, enrolled: Object.freeze({ size: () => 1n }) });
const ready = Object.freeze({ walletConnected: true, contractConnected: true, configurationVerified: true,
  state, busy: false, pendingReceipt: false, voterKeyValid: true, voterRegistered: true, voterSpent: false,
  selectedChoice: '1', nowMilliseconds: Number(OPEN) * 1000 });
const describe = changes => describeNetworkVoting({ ...ready, ...changes });
const assertLocked = display => { assert.equal(display.canChoose, false); assert.equal(display.canCast, false); };

test('wallet, election, setup and busy states explain the next step without enabling votes', () => {
  for (const [changes, kind] of [
    [{ busy: true }, 'busy'], [{ walletConnected: false }, 'wallet-required'],
    [{ contractConnected: false }, 'election-required'], [{ configurationVerified: false }, 'configuration-unverified'],
    [{ state: { ...state, phase: 0n, keysConfigured: false }, nowMilliseconds: Number(OPEN - 1n) * 1000 }, 'setup-required'],
    [{ state: { ...state, phase: 0n, keysConfigured: false } }, 'setup-expired'],
  ]) {
    const display = describe(changes); assert.equal(display.kind, kind); assertLocked(display);
    assert.ok(Object.isFrozen(display));
  }
  assert.equal(describeNetworkVoting().kind, 'wallet-required');
});

test('scheduled opening requires an actual phase change and registration cannot be assumed', () => {
  const enrolling = { ...state, phase: 0n };
  assert.equal(describe({ state: enrolling, nowMilliseconds: Number(OPEN) * 1000 - 1 }).kind, 'scheduled');
  assert.equal(describe({ state: enrolling }).kind, 'awaiting-open');
  assert.equal(describe({ state: { ...enrolling, enrolled: { size: () => 0n } } }).kind, 'enrollment-missed');
  assert.equal(enrolling.phase, 0n);
  for (const nowMilliseconds of [Number(CLOSE) * 1000, Number(CLOSE + 1n) * 1000]) {
    const display = describe({ state: enrolling, nowMilliseconds });
    assert.equal(display.kind, 'deadline-reached'); assertLocked(display);
    assert.ok(display.message.includes('device’s clock'));
  }
});

test('local deadline and clock disagreement lock choices without declaring a closed or finalized ledger', () => {
  assert.equal(describe({ nowMilliseconds: Number(CLOSE) * 1000 - 1 }).kind, 'ready');
  const expired = describe({ nowMilliseconds: Number(CLOSE) * 1000 });
  assert.equal(expired.kind, 'deadline-reached'); assertLocked(expired);
  assert.ok(expired.message.includes('closing transaction is still required'));
  const early = describe({ nowMilliseconds: Number(OPEN) * 1000 - 1 });
  assert.equal(early.kind, 'clock-mismatch'); assertLocked(early);
  assert.equal(state.phase, 1n);
  assert.equal(describe({ state: { ...state, phase: 2n } }).kind, 'closed');
  assert.equal(describe({ state: { ...state, phase: 3n } }).kind, 'finalized');
});

test('pending outcomes stay locked regardless of selected voter, deadline or finalized phase', () => {
  for (const changes of [{}, { voterKeyValid: false }, { voterSpent: true },
    { nowMilliseconds: Number(CLOSE + 86400n) * 1000 }, { state: { ...state, phase: 3n } }]) {
    const display = describe({ ...changes, pendingReceipt: true });
    assert.equal(display.kind, 'pending'); assertLocked(display);
    assert.equal(display.actionHref, '#network-recover-receipt');
    assert.ok(display.message.includes('do not assume it was submitted or rejected'));
  }
});

test('key validity, unavailable eligibility, nonmembership and already spent keys have distinct locked outcomes', () => {
  for (const [changes, kind] of [
    [{ voterKeyValid: false }, 'key-required'], [{ voterRegistered: null }, 'unavailable'],
    [{ voterSpent: null }, 'unavailable'], [{ voterRegistered: false }, 'not-registered'],
    [{ voterSpent: true }, 'already-voted'], [{ voterRegistered: false, voterSpent: true }, 'unavailable'],
  ]) {
    const display = describe(changes); assert.equal(display.kind, kind); assertLocked(display);
  }
});

test('only an active candidate can enable casting while choosing remains available', () => {
  for (const candidateCount of [2n, 3n, 4n, 5n]) {
    for (let option = 0; option < 5; option++) {
      const display = describe({ state: { ...state, candidateCount }, selectedChoice: String(option) });
      assert.equal(display.canChoose, true); assert.equal(display.canCast, BigInt(option) < candidateCount);
      assert.equal(display.kind, BigInt(option) < candidateCount ? 'ready' : 'choice-invalid');
    }
  }
  assert.equal(describe({ selectedChoice: '' }).kind, 'choose');
  for (const selectedChoice of ['01', '-1', '5', '1 ', 'NaN']) {
    const display = describe({ selectedChoice });
    assert.equal(display.canChoose, true); assert.equal(display.canCast, false);
  }
});

test('malformed flags, ledger values, enrollment reads and clock inputs fail closed with fixed text', () => {
  const invalid = [
    { walletConnected: 'yes' }, { contractConnected: 1 }, { configurationVerified: {} }, { pendingReceipt: {} },
    { voterKeyValid: 1 }, { voterRegistered: 'yes' }, { voterSpent: 0 }, { selectedChoice: 1 },
    { state: null }, { state: { ...state, phase: 1 } }, { state: { ...state, phase: 4n } },
    { state: { ...state, keysConfigured: false } }, { state: { ...state, candidateCount: 6n } },
    { state: { ...state, opensAt: -1n } }, { state: { ...state, closesAt: OPEN } },
    { state: { ...state, closesAt: 8_640_000_000_001n } },
    { state: { ...state, enrolled: null } }, { state: { ...state, enrolled: { size: () => 1 } } },
    { state: { ...state, enrolled: { size: () => 1025n } } },
    { state: { ...state, enrolled: { size: () => { throw new Error('SYNTHETIC-PRIVATE-ERROR'); } } } },
    ...[NaN, Infinity, -1, 1.5, '2000000000000', 8_640_000_000_000_001].map(nowMilliseconds => ({ nowMilliseconds })),
  ];
  for (const changes of invalid) {
    const display = describe(changes); assert.equal(display.kind, 'unavailable'); assertLocked(display);
    assert.ok(!display.message.includes('SYNTHETIC-PRIVATE-ERROR'));
  }
});
