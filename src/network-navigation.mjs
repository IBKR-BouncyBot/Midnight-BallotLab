/** Presentation only: keep forms mounted while showing one step. This module
 * has no wallet, provider, storage, election or cryptographic operations. */
const headings = Object.freeze({ connect: 'connect-heading', setup: 'contract-heading',
  vote: 'vote-heading', tally: 'tally-heading', check: 'check-heading' });

export function initNetworkNavigation({ document = globalThis.document,
  window = globalThis.window, isBusy = () => false } = {}) {
  const panels = new Map([...document.querySelectorAll('[data-network-panel]')]
    .map(panel => [panel.dataset.networkPanel, panel]));
  if (panels.size !== 5 || Object.entries(headings).some(([name, id]) =>
    !panels.get(name)?.contains(document.getElementById(id)))) throw new Error('Incomplete election steps');
  const buttons = [...document.querySelectorAll('[data-network-nav]')];
  if (buttons.some(button => !panels.has(button.dataset.networkNav))) throw new Error('Invalid election step');
  let active = 'connect', acceptedHash = window.location.hash;
  const targetForHash = hash => {
    try { return hash.startsWith('#') ? document.getElementById(decodeURIComponent(hash.slice(1))) : null; }
    catch { return null; }
  };
  const owner = target => {
    const panel = target?.closest('[data-network-panel]');
    return panel && panels.get(panel.dataset.networkPanel) === panel ? panel.dataset.networkPanel : null;
  };
  const changeHash = (hash, replace = false) => {
    if (window.location.hash === hash) return;
    const url = new URL(window.location.href); url.hash = hash;
    try { window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', url); }
    catch { /* Screen navigation remains available when history is restricted. */ }
  };
  const show = (name, { target = null, focus = true } = {}) => {
    active = name;
    for (const [key, panel] of panels) panel.hidden = key !== name;
    for (const button of buttons) {
      if (!button.classList.contains('step')) continue;
      const selected = button.dataset.networkNav === name;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    if (!focus) return;
    const heading = document.getElementById(headings[name]);
    // Reveal disclosure ancestors for deep links, never conditional hidden
    // Create/Join, receipt or result sections controlled by the application.
    if (target && !target.closest('[hidden]')) {
      for (let ancestor = target.parentElement; ancestor && ancestor !== panels.get(name); ancestor = ancestor.parentElement) {
        if (ancestor.tagName === 'DETAILS') ancestor.open = true;
      }
    }
    const visibleTarget = target && !target.closest('[hidden]') && target.getClientRects().length > 0 ? target : heading;
    const focusTarget = visibleTarget.matches('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]')
      ? visibleTarget : heading;
    focusTarget.focus({ preventScroll: true });
    focusTarget.scrollIntoView({ block: 'start', behavior: 'auto' });
  };
  const navigate = (name, target = null) => {
    if (isBusy()) return;
    changeHash(`#${target?.id || headings[name]}`);
    acceptedHash = window.location.hash;
    show(name, { target });
  };
  for (const button of buttons) button.addEventListener('click', () => {
    if (!button.disabled) navigate(button.dataset.networkNav);
  });
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || url.search !== window.location.search) return;
    const target = targetForHash(url.hash), name = owner(target);
    if (!name) return; // Support, skip and external links retain normal behavior.
    event.preventDefault(); navigate(name, target);
  });
  const routeHash = ({ initial = false } = {}) => {
    const hash = window.location.hash;
    const target = targetForHash(hash), name = hash === '' ? 'connect' : owner(target);
    if (name && isBusy()) {
      changeHash(acceptedHash, true); return;
    }
    acceptedHash = hash;
    if (name) show(name, { target, focus: !initial || hash !== '' });
    else if (initial) show(active, { focus: false });
  };
  // During history traversal, popstate can precede the browser's own fragment
  // scroll/focus. Route hashchange too, even for the hash just seen in popstate.
  window.addEventListener('hashchange', () => routeHash());
  window.addEventListener('popstate', () => routeHash());
  routeHash({ initial: true });
}
