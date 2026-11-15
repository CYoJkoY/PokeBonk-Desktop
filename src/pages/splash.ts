/**
 * The loading screen's page logic (static/splash.html). src/main.ts opens it with ?lang, img, tips, tip, label and ver, and
 * then drives it through window.pb: the progress bar never goes back, and out() fades the page away.
 */
type LoadingScreen = {
  set: (progress: number, label: string) => void;
  out: () => void;
};

// The page loads this file with <script src>, not as a module: the wrapper keeps its names out of the global scope.
(() => {
  function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error(`static/splash.html has no #${id}`);
    return found;
  }

  /** The tips travel as a JSON array in the query; anything else leaves the card empty rather than breaking the page. */
  function readTips(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((tip): tip is string => typeof tip === 'string') : [];
    } catch {
      return [];
    }
  }

  const query = new URLSearchParams(location.search);
  document.documentElement.lang = query.get('lang') || 'en';
  const version = query.get('ver');
  element('ver').textContent = version ? `v${version}` : '';
  element('label').textContent = query.get('label') || '';
  element('tipLabel').textContent = query.get('tip') || '';

  // The illustration fades the page in once it is there; a broken one still shows the wordmark and the bar.
  const art = new Image();
  const reveal = (): void => {
    if (art.naturalWidth) element('art').style.backgroundImage = `url("${art.src}")`;
    document.body.classList.add('in');
  };
  art.onload = reveal;
  art.onerror = reveal;
  art.src = `splash/${query.get('img') || 'forest'}.webp`;

  // Tips: a random start, then the next one every 7 s.
  const tips = readTips(query.get('tips'));
  let index = Math.floor(Math.random() * Math.max(1, tips.length));
  const tipCard = element('tip');
  const showTip = (): void => {
    element('tipText').textContent = tips[index % tips.length] ?? '';
    tipCard.hidden = tips.length === 0;
  };
  showTip();
  setInterval(() => {
    tipCard.classList.add('swap');
    setTimeout(() => {
      index++;
      showTip();
      tipCard.classList.remove('swap');
    }, 350);
  }, 7_000);

  let shown = 0;
  (window as unknown as Window & { pb: LoadingScreen }).pb = {
    set(progress: number, label: string): void {
      if (progress > shown) {
        shown = Math.min(1, progress);
        element('fill').style.transform = `scaleX(${shown.toFixed(3)})`;
      }
      if (label) element('label').textContent = label;
    },
    out(): void {
      document.body.classList.add('out');
    },
  };
})();
