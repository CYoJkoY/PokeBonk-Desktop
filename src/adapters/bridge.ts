import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { createNavigationPolicy } from '../domain/navigation';
import type { DesktopRequests } from '../ports/desktop-requests';

type Event = IpcMainEvent | IpcMainInvokeEvent;
/** The composition root owns the active window; adapters receive only the access they need. */
export function desktopBridge(getWindow: () => BrowserWindow | null, policy: ReturnType<typeof createNavigationPolicy>): DesktopRequests {
  const allowed = (event: Event, offline = false) => {
    const w = getWindow(), frame = event.senderFrame;
    return !!w && !w.isDestroyed() && event.sender === w.webContents && !!frame
      && frame === w.webContents.mainFrame
      && ((policy.isGame(frame.url) && frame.origin === new URL(frame.url).origin) || (offline && policy.isOffline(frame.url)));
  };
  return {
    handle(channel: string, run: (payload: unknown) => unknown) {
      ipcMain.handle(channel, (event, payload: unknown) => {
        if (!allowed(event)) throw new Error('Desktop request denied');
        return run(payload);
      });
    },
    on(channel: string, run: (payload: unknown) => void, offline = false) {
      ipcMain.on(channel, (event, payload: unknown) => { if (allowed(event, offline)) run(payload); });
    },
    fullscreen() {
      ipcMain.on('pb:fullscreen', event => { event.returnValue = allowed(event, true) ? !!getWindow()?.isFullScreen() : false; });
    },
  };
}
