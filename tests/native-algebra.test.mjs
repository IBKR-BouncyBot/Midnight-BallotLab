/**
 * Algebra-only reference checks for the proposed native election equations.
 * Points are represented by their coefficient in an abstract cyclic group of
 * prime order q. This is NOT elliptic-curve code, a Compact emulator, a ZK proof,
 * a test of compiler-generated artifacts, or evidence of network execution.
 * Never use this deliberately transparent model to encrypt actual ballots.
 *
 * q: https://docs.midnight.network/compact/standard-library/exports#jubjubscalar
 * BLS scalar field: https://zips.z.cash/protocol/protocol.pdf section 5.4.9.2.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const Q = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const FIELD = 52435875175126190479447740508185965837690552500527637822603658699938581184513n;
const mod = n => ((n % Q) + Q) % Q;
const pairs = [[1, 2], [1, 3], [2, 3]];

function setup(x, slope) {
  for (const value of [x, slope]) assert(value > 0n && value < Q, 'Nonzero canonical scalar required');
  const shares = [1n, 2n, 3n].map(i => mod(x + slope * i));
  assert(shares.every(value => value !== 0n), 'Identity public share reduces secrecy threshold');
  return { x, slope, shares };
}

function ballot(choice, randomness, key) {
  assert(Number.isInteger(choice) && choice >= 0 && choice < 3, 'Exactly one of three choices required');
  assert.equal(randomness.length, 3);
  return randomness.map((r, index) => {
    assert(r > 0n && r < Q, 'Nonzero canonical randomness required');
    return { a: r, b: mod(r * key + (index === choice ? 1n : 0n)) };
  });
}

function aggregate(ballots) {
  return [0, 1, 2].map(index => ballots.reduce((sum, encrypted) => ({
    a: mod(sum.a + encrypted[index].a), b: mod(sum.b + encrypted[index].b),
  }), { a: 0n, b: 0n }));
}

function partials(agg, shares) {
  return shares.map(secret => agg.map(({ a }) => mod(secret * a)));
}

function validTotals(agg, ds, pair, totals, accepted) {
  if (totals.length !== 3 || !totals.every(n => Number.isInteger(n) && n >= 0 && n <= accepted)) return false;
  if (totals.reduce((sum, n) => sum + n, 0) !== accepted) return false;
  const key = pair.join(',');
  if (!['1,2', '1,3', '2,3'].includes(key)) return false;
  return agg.every(({ b }, index) => {
    const count = BigInt(totals[index]);
    // Positive coefficient equations avoid inverting two in Compact's Field.
    if (key === '1,2') return mod(b + ds[1][index]) === mod(count + 2n * ds[0][index]);
    if (key === '1,3') return mod(2n * b + ds[2][index]) === mod(2n * count + 3n * ds[0][index]);
    return mod(b + 2n * ds[2][index]) === mod(count + 3n * ds[1][index]);
  });
}

function fixture(x = Q - 1n, slope = Q - 2n) {
  const keys = setup(x, slope);
  const ballots = [0, 1, 2, 2, 0].map((choice, i) => ballot(choice,
    [Q - BigInt(i * 3 + 5), BigInt(i * 7 + 3), BigInt(i * 11 + 17)], x));
  const agg = aggregate(ballots);
  return { keys, ballots, agg, ds: partials(agg, keys.shares), totals: [2, 1, 2] };
}

test('algebra model only: all two-of-three pairs recover totals across scalar wraparound', () => {
  const cases = [[1n, 1n], [13n, 29n], [Q - 1n, Q - 2n], [Q / 2n, Q / 3n]];
  for (const [x, slope] of cases) {
    const { agg, ds, totals } = fixture(x, slope);
    for (const pair of pairs) assert(validTotals(agg, ds, pair, totals, 5), `Pair ${pair}`);
  }
});

test('algebra model only: base-field arithmetic is not Jubjub scalar arithmetic', () => {
  const keys = setup(Q - 1n, Q - 2n);
  assert.equal(keys.shares[0], Q - 3n);
  const wrongShare = ((Q - 1n) + (Q - 2n)) % FIELD;
  assert.notEqual(wrongShare, keys.shares[0]);
  assert(wrongShare >= Q, 'Wrong field reduction leaves an invalid EC scalar');
  const inverseTwoInBaseField = (FIELD + 1n) / 2n;
  assert.equal(2n * inverseTwoInBaseField % FIELD, 1n);
  assert.notEqual(mod(2n * inverseTwoInBaseField), 1n, 'Field inverse is not subgroup inverse');
});

test('algebra model only: byte-derived limbs bound scalars without oversized Uint types', () => {
  // Compact bounds Uint at 248 bits, so q cannot be compared as one Uint.
  // Field -> Bytes<32> is little endian; byte 31 supplies the high limb.
  const base = 1n << 248n;
  const qLow = 222104516725044372704429320860625768980218979470098935457522536959433977015n;
  assert.equal(Q, 14n * base + qLow);
  const canonicalByLimbs = s => {
    assert(s >= 0n && s < FIELD, 'Model input must be a valid Compact Field');
    const high = s >> 248n;
    const low = s - high * base;
    assert(low >= 0n && low < base);
    return high < 14n || (high === 14n && low < qLow);
  };
  for (const value of [0n, 1n, base - 1n, base, 14n * base, Q - 1n, Q, Q + 1n, 15n * base, FIELD - 1n]) {
    assert.equal(canonicalByLimbs(value), value < Q);
  }
});

test('algebra model only: zero setup secrets and zero trustee shares undermine threshold privacy', () => {
  assert.throws(() => setup(0n, 1n), /Nonzero/);
  assert.throws(() => setup(1n, 0n), /Nonzero/);
  for (const zeroIndex of [1n, 2n, 3n]) {
    const slope = 7n;
    assert.throws(() => setup(Q - zeroIndex * slope, slope), /Identity public share/);
  }
  assert.throws(() => setup(Q, 1n), /canonical/);
});

test('algebra model only: every trustee pair rejects altered totals and decryption contributions', () => {
  const { agg, ds, totals } = fixture();
  for (const pair of pairs) {
    assert(!validTotals(agg, ds, pair, [3, 0, 2], 5));
    assert(!validTotals(agg, ds, pair, [2, 1, 3], 5));
    assert(!validTotals(agg, ds, pair, [-1, 4, 2], 5));
    const corrupt = ds.map(vector => [...vector]);
    corrupt[pair[0] - 1][0] = mod(corrupt[pair[0] - 1][0] + 1n);
    assert(!validTotals(agg, corrupt, pair, totals, 5));
  }
  assert(!validTotals(agg, ds, [1, 1], totals, 5));
});

test('algebra model only: pair one/three factor two has one bounded tally solution', () => {
  const { agg, ds, totals } = fixture();
  let solutions = 0;
  for (let a = 0; a <= 5; a++) for (let b = 0; b <= 5 - a; b++) {
    const proposed = [a, b, 5 - a - b];
    if (validTotals(agg, ds, [1, 3], proposed, 5)) {
      solutions++;
      assert.deepEqual(proposed, totals);
    }
  }
  assert.equal(solutions, 1);
  assert.equal(Q % 2n, 1n, 'Multiplication by two is injective in the prime-order subgroup');
});

test('algebra model only: empty and identity-aggregate elections remain valid', () => {
  const { shares } = setup(13n, 29n);
  const empty = aggregate([]);
  for (const pair of pairs) assert(validTotals(empty, partials(empty, shares), pair, [0, 0, 0], 0));
  const first = ballot(0, [2n, 3n, 5n], 13n);
  const second = ballot(1, [Q - 2n, Q - 3n, Q - 5n], 13n);
  const cancelled = aggregate([first, second]);
  assert(cancelled.every(c => c.a === 0n));
  for (const pair of pairs) assert(validTotals(cancelled, partials(cancelled, shares), pair, [1, 1, 0], 2));
});

test('algebra model only: reusing one mask across choices reveals the chosen position', () => {
  const key = 13n, reused = 17n;
  const ciphertext = ballot(1, [reused, reused, reused], key);
  assert.equal(mod(ciphertext[1].b - ciphertext[0].b), 1n);
  assert.equal(mod(ciphertext[1].b - ciphertext[2].b), 1n);
  assert.equal(mod(ciphertext[0].b - ciphertext[2].b), 0n);
  const independent = ballot(1, [17n, 23n, 41n], key);
  assert.notEqual(mod(independent[1].b - independent[0].b), 1n);
  // This illustrates the mask requirement; it does not prove randomness or
  // privacy. The actual client must obtain independent scalars from a CSPRNG.
});

test('algebra model only: shares for a ballot subset cannot decrypt a different aggregate', () => {
  const { ballots, keys, agg, totals } = fixture();
  const subsetShares = partials(aggregate(ballots.slice(0, 1)), keys.shares);
  for (const pair of pairs) assert(!validTotals(agg, subsetShares, pair, totals, 5));
});
