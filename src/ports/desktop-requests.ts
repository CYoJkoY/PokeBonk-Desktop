export interface DesktopRequests {
  handle(channel: string, run: (payload: unknown) => unknown): void;
  on(channel: string, run: (payload: unknown) => void, offline?: boolean): void;
  fullscreen(): void;
}
