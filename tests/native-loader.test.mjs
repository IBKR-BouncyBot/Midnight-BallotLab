import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNativeDemo } from '../src/native-loader.mjs';

function fixture() {
  const status = { textContent: '', dataset: {} };
  const controls = [{ disabled: false }, { disabled: false }];
  const document = { getElementById: () => status, querySelectorAll: () => controls };
  return { status, controls, document };
}

test('native loader: an unavailable build never imports code or enables voting', async () => {
  const state = fixture();
  const result = await loadNativeDemo({ document: state.document,
    loadManifest: async () => ({ enabled: false }),
    loadApplication: () => { throw new Error('Must not import'); },
  });
  assert.equal(result, 'unavailable');
  assert.ok(state.controls.every(control => control.disabled));
  assert.equal(state.status.dataset.state, 'unavailable');
});

test('native loader: initialization failure disables controls even after partial setup', async () => {
  const state = fixture();
  const result = await loadNativeDemo({ document: state.document,
    loadManifest: async () => ({ enabled: true }),
    loadApplication: async () => ({ initNativeDemo: async () => {
      state.controls[0].disabled = false;
      throw new Error('Initialization failure');
    } }),
  });
  assert.equal(result, 'error');
  assert.ok(state.controls.every(control => control.disabled));
  assert.equal(state.status.dataset.state, 'error');
});

test('native loader: readiness is reported only after application initialization completes', async () => {
  const state = fixture();
  let initialized = false;
  const result = await loadNativeDemo({ document: state.document,
    loadManifest: async () => ({ enabled: true }),
    loadApplication: async () => ({ initNativeDemo: async () => {
      assert.notEqual(state.status.dataset.state, 'ready');
      initialized = true;
    } }),
  });
  assert.ok(initialized);
  assert.equal(result, 'ready');
  assert.match(state.status.textContent, /no ZK proofs/);
  assert.match(state.status.textContent, /no blockchain transactions/);
});
