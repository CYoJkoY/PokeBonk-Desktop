import { isRecord } from './config';
export type Distribution = { schemaVersion: '1.0.0'; discordAppId: string; updates: { enabled: boolean; owner: string; repo: string } };
export function parseDistribution(value: unknown): Distribution {
  if (!isRecord(value) || value.schemaVersion !== '1.0.0' || typeof value.discordAppId !== 'string' || !/^\d{17,20}$/.test(value.discordAppId)) throw new Error('Invalid distribution configuration');
  const u = value.updates;
  if (!isRecord(u) || typeof u.enabled !== 'boolean' || typeof u.owner !== 'string' || typeof u.repo !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(u.owner) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(u.repo)) throw new Error('Invalid update repository');
  return { schemaVersion: '1.0.0', discordAppId: value.discordAppId, updates: { enabled: u.enabled, owner: u.owner, repo: u.repo } };
}
