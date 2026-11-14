import type { ClientCfg } from '../domain/config';
export interface SettingsStore {
  read(): ClientCfg;
  write(patch: Partial<ClientCfg>): void;
}
