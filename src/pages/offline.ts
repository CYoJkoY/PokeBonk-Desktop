/**
 * The offline page's logic (static/offline.html): it shows the localized text the client puts in the query and asks the
 * main process to load the game again through the preload's pokebonkDesktop.retry (src/preload.ts).
 */
type OfflineWindow = Window & { pokebonkDesktop?: { retry: () => void } };

// The page loads this file with <script src>, not as a module: the wrapper keeps its names out of the global scope.
(() => {
  function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error(`static/offline.html has no #${id}`);
    return found;
  }

  const query = new URLSearchParams(location.search);
  document.documentElement.lang = query.get('lang') || 'en';
  element('title').textContent = query.get('title') || '';
  element('text').textContent = query.get('body') || '';
  const retry = element('retry');
  if (!(retry instanceof HTMLButtonElement)) throw new Error('static/offline.html has no #retry button');
  retry.textContent = query.get('retry') || 'Retry';

  const again = (): void => {
    retry.disabled = true;
    (window as unknown as OfflineWindow).pokebonkDesktop?.retry();
  };
  retry.onclick = again;
  addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') again();
  });
  // Try again by itself every 20 s: a deploy or a short outage comes back on its own.
  setTimeout(again, 20_000);
})();
