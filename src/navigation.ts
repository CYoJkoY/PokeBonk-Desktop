/** Trust is an exact origin, never a hostname suffix or a renderer-supplied flag. */
export function createNavigationPolicy(gameUrl: string, offlineUrl: string) {
  const game = new URL(gameUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(game.hostname);
  if (game.username || game.password || (game.protocol !== 'https:' && !(game.protocol === 'http:' && loopback))) {
    throw new Error('Game URL must use HTTPS (HTTP is allowed only on loopback for development)');
  }
  const isGame = (value: string): boolean => {
    try { const u = new URL(value); return !u.username && !u.password && u.origin === game.origin && u.protocol === game.protocol; } catch { return false; }
  };
  const isOffline = (value: string): boolean => {
    try { const u = new URL(value); u.search = ''; u.hash = ''; return u.href === offlineUrl; } catch { return false; }
  };
  return { isGame, isOffline, mayNavigate: (value: string) => isGame(value) || isOffline(value) };
}
