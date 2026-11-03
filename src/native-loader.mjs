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
  status.textContent = 'Loading Midnight’s encryption tools…';
  try {
    const manifest = await loadManifest();
    if (manifest?.enabled !== true) {
      status.textContent = 'This copy of the app is missing its Midnight build. Voting is unavailable. See the technical guide to build it, or use the published app.';
      status.dataset.state = 'unavailable';
      return 'unavailable';
    }
    const application = await loadApplication();
    if (typeof application.initNativeDemo !== 'function') throw new Error('Native application entry point missing');
    await application.initNativeDemo();
    status.textContent = 'Ready. Midnight encrypts votes in your browser. This demo creates no proofs and sends no blockchain transactions.';
    status.dataset.state = 'ready';
    return 'ready';
  } catch {
    disable();
    status.textContent = 'Midnight’s encryption tools could not load, so voting is unavailable. Try reloading the page. If the problem continues, check the technical guide.';
    status.dataset.state = 'error';
    return 'error';
  }
}

if (typeof document !== 'undefined') void loadNativeDemo();
