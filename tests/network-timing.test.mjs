// Deterministic display inputs only. These are not contract executions or
// fabricated wallet/indexer confirmations; generated-ledger checks are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeNetworkElectionTiming, formatNetworkDuration, formatNetworkTimingDate } from '../src/network-timing.mjs';

const opensAt = 2_000_000_000n, closesAt = opensAt + 600n;
const state = Object.freeze({ phase: 0n, keysConfigured: true, opensAt, closesAt });
const at = seconds => Number(seconds) * 1000;

test('unconnected and invalid schedules never produce countdowns or finalized claims', () => {
  assert.equal(describeNetworkElectionTiming(null, Date.now()).kind, 'empty');
  for (const record of [false, {}, { ...state, phase: 1 }, { ...state, phase: 4n }, { ...state, keysConfigured: 1 },
    { ...state, opensAt: -1n }, { ...state, opensAt: closesAt }, { ...state, closesAt: opensAt - 1n },
    { ...state, closesAt: 8_640_000_000_001n }, { ...state, phase: 3n, keysConfigured: false }]) {
    const display = describeNetworkElectionTiming(record, at(opensAt));
    assert.equal(display.kind, 'invalid'); assert.equal(display.remainingSeconds, null);
    assert.equal(display.countdown, '—'); assert.equal(display.opens.dateTime, null);
  }
  for (const now of [NaN, Infinity, -1, 1.5, 8_640_000_000_000_001, '2000000000000']) {
    assert.equal(describeNetworkElectionTiming(state, now).kind, 'invalid');
  }
});

test('planned/setup states use the real opening boundary and never open automatically', () => {
  const planned = describeNetworkElectionTiming(state, at(opensAt - 1n));
  assert.equal(planned.kind, 'planned'); assert.equal(planned.remainingSeconds, 1);
  assert.ok(planned.countdown.includes('local estimate'));
  assert.equal(describeNetworkElectionTiming({ ...state, keysConfigured: false }, at(opensAt - 1n)).kind, 'setup-pending');
  assert.equal(describeNetworkElectionTiming({ ...state, keysConfigured: false }, at(opensAt)).kind, 'setup-expired');
  const openedTime = describeNetworkElectionTiming(state, at(opensAt));
  assert.equal(openedTime.kind, 'awaiting-open'); assert.equal(openedTime.remainingSeconds, 600);
  assert.equal(state.phase, 0n);
});

test('running countdown respects exact closing time without inventing closing or finalization', () => {
  const open = { ...state, phase: 1n };
  assert.equal(describeNetworkElectionTiming(open, at(opensAt)).remainingSeconds, 600);
  const lastMillisecond = describeNetworkElectionTiming(open, at(closesAt) - 1);
  assert.equal(lastMillisecond.kind, 'open'); assert.equal(lastMillisecond.remainingSeconds, 1);
  for (const phase of [0n, 1n]) {
    for (const now of [at(closesAt), at(closesAt + 86400n)]) {
      const display = describeNetworkElectionTiming({ ...state, phase }, now);
      assert.equal(display.kind, 'awaiting-close'); assert.equal(display.remainingSeconds, null);
      assert.ok(!display.phase.includes('Results published'));
    }
  }
  assert.equal(open.phase, 1n);
});

test('indexed closed/finalized phases dominate local-clock estimates with disagreement disclosed', () => {
  const closed = describeNetworkElectionTiming({ ...state, phase: 2n }, at(closesAt + 100n));
  assert.equal(closed.kind, 'closed'); assert.equal(closed.remainingSeconds, null);
  assert.ok(closed.phase.includes('awaiting tally'));
  const finalized = describeNetworkElectionTiming({ ...state, phase: 3n }, at(closesAt + 100n));
  assert.equal(finalized.kind, 'finalized'); assert.equal(finalized.remainingSeconds, null);
  for (const phase of [1n, 2n, 3n]) {
    const display = describeNetworkElectionTiming({ ...state, phase }, at(opensAt - 10n));
    assert.ok(display.note.includes('clock and indexed phase disagree'));
    assert.equal(display.remainingSeconds, null);
    assert.equal(display.kind === 'finalized', phase === 3n);
  }
});

test('duration display covers seconds, minutes, hours and days without negative values', () => {
  for (const [seconds, text] of [[0, '0s'], [59, '59s'], [60, '1m 0s'], [3599, '59m 59s'],
    [3600, '1h 0m 0s'], [86399, '23h 59m 59s'], [86400, '1d 0h 0m 0s'], [93784, '1d 2h 3m 4s']]) {
    assert.equal(formatNetworkDuration(seconds), text);
  }
  for (const seconds of [-1, 0.1, NaN, Infinity, '60', 1n]) assert.throws(() => formatNetworkDuration(seconds));
});

test('local date display includes an explicit timezone and bounded ISO dateTime metadata', () => {
  const display = describeNetworkElectionTiming(state, at(opensAt));
  assert.equal(display.opens.dateTime, '2033-05-18T03:33:20.000Z');
  assert.equal(display.closes.dateTime, '2033-05-18T03:43:20.000Z');
  assert.ok(display.opens.text.includes('GMT'));
  for (const value of [null, undefined, -1, Infinity, '0', 8_640_000_000_000_001]) {
    assert.deepEqual(formatNetworkTimingDate(value), { text: '—', dateTime: null });
  }
  assert.equal(formatNetworkTimingDate(0).dateTime, '1970-01-01T00:00:00.000Z');
  assert.ok(formatNetworkTimingDate(8_640_000_000_000_000).dateTime);
  assert.ok(display.note.includes('reaching zero does not send a transaction'));
  assert.ok(Object.isFrozen(display)); assert.ok(Object.isFrozen(display.opens));
});
