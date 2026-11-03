/** Fail closed until the separately built, real network application initializes. */
export async function loadNetworkApplication({ document = globalThis.document,
  loadManifest = async () => {
    const response = await fetch(new URL('./network-build.json', import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error('Network build manifest unavailable');
    return response.json();
  },
  loadApplication = () => import(new URL('./network-bundle.mjs', import.meta.url).href),
} = {}) {
  const status = document.getElementById('network-availability');
  const disable = () => document.querySelectorAll('[data-network-control]').forEach(control => { control.disabled = true; });
  disable();
  try {
    const manifest = await loadManifest();
    if (manifest?.enabled !== true) throw new Error('Network bundle not built');
    const application = await loadApplication();
    await application.initNetworkApplication();
    status.textContent = 'Real Midnight.js loaded. Select a test network and wallet. Nothing has been proved or submitted yet.';
    status.dataset.state = 'ready';
  } catch {
    disable();
    status.textContent = 'The network application is unavailable in this build. Generate the real contract, keys and browser bundle before connecting a wallet.';
    status.dataset.state = 'unavailable';
  }
}

if (typeof document !== 'undefined') void loadNetworkApplication();
