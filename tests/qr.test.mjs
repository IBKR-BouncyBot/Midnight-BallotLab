import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qrMatrix, qrSvg, QR_VERSION, QR_CAPACITY_BYTES } from '../src/qr.mjs';

// Independent encoder fixtures generated with ReportLab 4.4.9's MIT-licensed
// reportlab.graphics.barcode.qrencoder.QRCode(8, QRErrorCorrectLevel.L),
// explicitly adding QR8bitByte(text), makeImpl(false, mask). Hash input is
// 2,401 row-major ASCII '0'/'1' module values; no quiet zone. All eight masks
// were compared module-for-module against ReportLab during development.
// These frozen fixtures keep the distributed test suite dependency-free.
const reference = [
  {
    "name": "empty",
    "text": "",
    "hashes": [
      "588ae68252eb0f87a808e63d9eca6204e4dfe9e72b9ce6199d79bcc6291ae365",
      "933ed5ecb27f3bebadbf7b2d7469c9307d2ecd56bcb438c2f1058dbdfc7cac91",
      "e8ed06d54253d4eb505c616a5711cd415161a1ba62ceb983849ec51bb455d25b",
      "eed233de3785d5645aacfac55a233cb06354e818966420df914125ac403a25d3",
      "358e0200fa04003dda33bacf503f2741b961909900486a619802b608124fa6cf",
      "fb27a95e1adcfa8e867932ed04f32f1f48e93c91df5e8b653fa3285f0e417a31",
      "577d58a7f6d3a6646514d0be5e3e16873e3ad13fcfb15c5ba0d8e312f39845cc",
      "2f3fc8ea2d3553dba51480ccb2b2e810c8c8ae6afeba283041e3141ace4b6f57"
    ]
  },
  {
    "name": "plain",
    "text": "Hello, world!",
    "hashes": [
      "32a9d5ecd3ab7662767f49b93143321ac1b9640548e2234e7e8314fbdc584fb0",
      "7ce3ec941e58e5f0d62c501df17cf19c7ec71fab8fafd25704cbbe1182187b60",
      "88507b39b9bcd0621d5f8a4bb1d15cbee6c6def7632571accf5e4f2d687e482f",
      "6c4832539b6d3a6702bc1929445982b5dcb645f461aa62ec3137470ce6b6d62b",
      "09a51ac18072d941be28c5e28ceeb1e0b80dbc5984fc684c0ef2da72981b5eec",
      "44aafe775a1775ffacf652cbd016c743a607c8791fd35a92c010564231ad0264",
      "97f668d9c9188c339ffe72e626abb2d4a968156623178a9f79896e2bc62d16a7",
      "3016188570c4ec52a02e2aad68b1ad26e03172156b2337caa6066fdc01494687"
    ]
  },
  {
    "name": "maximum",
    "text": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "hashes": [
      "47808a9ea0c76cad86929e105673b769f968b2bb2179c3c70017d4fe1d731572",
      "bdf305ae02fe2dcb8f0f3d61b5f1f8c432dda65a522695c2d98f76f577c4be3b",
      "38964116472c5017dc3ca0c80529a8bbe46e81d17a5b73c2076e643942e49334",
      "2a041cad0a3cde60e0d86b602a2c91f48d10b7d5f1692846eef96113b35b28b6",
      "2e66f37a0a2aa5f41600d31b576909ddff21079f77e173dac2461df166224d0e",
      "f1d6db57878041d91fb2c9441befd6efef44da5ef80737c587b5b7765af34e22",
      "700aa55641969f674579896631513aff8eb4407c618e3961984c7abf84077db2",
      "d6e10412db47430e9e18dd572ae531f1a8d3fcb625216953b0e06e4c11ee862c"
    ]
  }
];
const digest = (m) => createHash('sha256').update(m.flat().map(Number).join('')).digest('hex');

for (const fixture of reference) {
  test(`QR ${fixture.name}: all eight masks match independent reference`, () => {
    for (let mask = 0; mask < 8; mask++) {
      const matrix = qrMatrix(fixture.text, { mask });
      assert.equal(matrix.length, 49);
      assert.ok(matrix.every(row => row.length === 49 && row.every(cell => typeof cell === 'boolean')));
      assert.equal(digest(matrix), fixture.hashes[mask]);
    }
  });
  test(`QR ${fixture.name}: automatic mask is one of eight valid symbols`, () => {
    assert.ok(fixture.hashes.includes(digest(qrMatrix(fixture.text))));
  });
}

test('QR receipt capacity and format are explicit', () => {
  assert.equal(QR_VERSION, 8);
  assert.equal(QR_CAPACITY_BYTES, 192);
  assert.throws(() => qrMatrix('x'.repeat(193)), /at most 192/);
  assert.throws(() => qrMatrix('é'), /ASCII/);
  assert.throws(() => qrMatrix('hello\nworld'), /ASCII/);
  assert.throws(() => qrMatrix(null), /string/);
  assert.throws(() => qrMatrix('x', {mask:8}), /mask/);
  assert.throws(() => qrMatrix('x', {mask:0.5}), /mask/);
});

test('SVG has four-module quiet zone and never interpolates receipt text', () => {
  const svg = qrSvg('<script>alert(1)</script>', {scale:4});
  assert.match(svg, /viewBox="0 0 57 57"/);
  assert.match(svg, /width="228" height="228"/);
  assert.match(svg, /<rect width="57" height="57" fill="#fff"/);
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes('alert'));
  assert.ok(!svg.includes('href'));
  assert.match(svg, /M4,4h1v1h-1z/);
  assert.throws(() => qrSvg('x', {scale:'4'}), /scale/);
  assert.throws(() => qrSvg('x', {scale:0}), /scale/);
  assert.throws(() => qrSvg('x', {scale:17}), /scale/);
});
