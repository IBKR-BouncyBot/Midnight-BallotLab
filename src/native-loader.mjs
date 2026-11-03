/** Enable native controls only after the actual native application initializes. */
const fetchManifest = async () => {
  const response = await fetch(new URL('./native-build.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('Native build manifest unavailable');
  return response.json();
};
const importApplication = () => import(new URL('./native-bundle.mjs', import.meta.url).href);

export async function loadNativeDemo({ document = globalThis.document, loadManifest = fetchManifest, loadApplication = importApplication } = {}) {
  const status = document.getElementById('native-availability');
  const disable = () => document.querySelectorAll('[data-native-control]').forEach(control => { control.disabled = true; });
  disable();
  status.textContent = 'Checking native runtime availability…';
  try {
    const manifest = await loadManifest();
    if (manifest?.enabled !== true) {
      status.textContent = 'Native mode is not built in this release. Build with the pinned Midnight toolchain or run the GitHub Pages workflow. The controls stay disabled until the actual runtime and generated contract are available.';
      status.dataset.state = 'unavailable';
      return 'unavailable';
    }
    const application = await loadApplication();
    if (typeof application.initNativeDemo !== 'function') throw new Error('Native application entry point missing');
    await application.initNativeDemo();
    status.textContent = 'Midnight native runtime loaded. Local emulator only: no ZK proofs are generated and no blockchain transactions are submitted.';
    status.dataset.state = 'ready';
    return 'ready';
  } catch {
    disable();
    status.textContent = 'Native mode could not initialize. Its controls are disabled. Rebuild using the pinned compiler and runtime, and check the native build results. No substitute cryptography is running on this page.';
    status.dataset.state = 'error';
    return 'error';
  }
}

if (typeof document !== 'undefined') void loadNativeDemo();
