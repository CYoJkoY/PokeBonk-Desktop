import { expect, test } from 'bun:test';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiscordFrames, MAX_RPC_PAYLOAD } from '../src/adapters/discord-frames';
import { DiscordPresence } from '../src/discord';
import { isRecord } from '../src/domain/config';

function frame(op: number, value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(8);
  header.writeInt32LE(op); header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

test('IPC framing handles every split boundary, UTF-8 and coalesced frames', () => {
  const input = Buffer.concat([frame(1, { evt: 'READY', text: 'PokéBonk' }), frame(3, { nonce: 42 })]);
  for (let split = 0; split <= input.length; split++) {
    const parser = new DiscordFrames();
    expect([...parser.read(input.subarray(0, split)), ...parser.read(input.subarray(split))]).toEqual([
      { op: 1, data: { evt: 'READY', text: 'PokéBonk' } }, { op: 3, data: { nonce: 42 } },
    ]);
  }
  const parser = new DiscordFrames();
  expect([...input].flatMap(byte => [...parser.read(Buffer.from([byte]))])).toHaveLength(2);
});

test('IPC rejects invalid lengths before accepting a payload', () => {
  for (const length of [-2147483648, -8, -1, 0, MAX_RPC_PAYLOAD + 1, 2147483647]) {
    const header = Buffer.alloc(8); header.writeInt32LE(length, 4);
    expect(() => [...new DiscordFrames().read(header)]).toThrow('length');
  }
});

test('IPC bounds large fragmented frames and rejects malformed JSON', () => {
  const input = frame(1, 'x'.repeat(MAX_RPC_PAYLOAD - 2));
  const parser = new DiscordFrames();
  const result = [];
  for (let offset = 0; offset < input.length; offset += 1024) result.push(...parser.read(input.subarray(offset, offset + 1024)));
  expect(result[0].data).toHaveLength(MAX_RPC_PAYLOAD - 2);
  const broken = frame(1, 'ok'); broken.fill(123, 8);
  expect(() => [...new DiscordFrames().read(broken)]).toThrow();
});

const waitFor = async (condition: () => boolean) => {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for IPC assertion');
    await Bun.sleep(5);
  }
};

async function withPeer(run: (peer: { path: string; clients: Socket[]; messages: { op: number; data: unknown }[] }) => Promise<void>) {
  const id = `pokebonk-rpc-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const path = process.platform === 'win32' ? '\\\\?\\pipe\\' + id : join(tmpdir(), id);
  const clients: Socket[] = [], messages: { op: number; data: unknown }[] = [];
  const server = createServer(socket => {
    clients.push(socket);
    const parser = new DiscordFrames();
    socket.on('error', () => {});
    socket.on('data', data => messages.push(...parser.read(Buffer.from(data))));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  try { await run({ path, clients, messages }); } finally {
    clients.forEach(socket => socket.destroy());
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test('presence handshakes, answers ping, publishes latest activity and closes on disable', async () => {
  await withPeer(async ({ path, clients, messages }) => {
    const presence = new DiscordPresence('12345678901234567', () => [path]);
    try {
      presence.set({ details: 'old activity' }); presence.set({ details: 'latest activity' }); presence.enable(true);
      await waitFor(() => messages.length === 1);
      expect(messages[0]).toEqual({ op: 0, data: { v: 1, client_id: '12345678901234567' } });
      clients[0].write(Buffer.concat([frame(1, null), frame(3, { nonce: 'test' }), frame(1, { evt: 'READY' })]));
      await waitFor(() => messages.length >= 3);
      expect(messages[1]).toEqual({ op: 4, data: { nonce: 'test' } });
      expect(messages[2].data).toMatchObject({ cmd: 'SET_ACTIVITY', args: { activity: { details: 'latest activity' } } });
      presence.enable(false);
      await waitFor(() => clients[0].destroyed);
    } finally { presence.enable(false); }
  });
});

test('presence closes silent handshake peers and can reconnect after re-enabling', async () => {
  await withPeer(async ({ path, clients, messages }) => {
    const presence = new DiscordPresence('12345678901234567', () => [path], 100);
    try {
      presence.enable(true);
      await waitFor(() => messages.length === 1);
      await waitFor(() => clients[0].destroyed);
      presence.enable(false); presence.enable(true);
      await waitFor(() => messages.length === 2);
      presence.enable(false);
      await waitFor(() => clients[1].destroyed);
    } finally { presence.enable(false); }
  });
});

test('presence isolates invalid frames, null messages and application changes', async () => {
  await withPeer(async ({ path, clients, messages }) => {
    const presence = new DiscordPresence('12345678901234567', () => [path]);
    try {
      presence.enable(true);
      await waitFor(() => messages.length === 1);
      clients[0].write(frame(1, null));
      clients[0].write(Buffer.alloc(8, 255));
      await waitFor(() => clients[0].destroyed);
      presence.useApp('76543210987654321');
      await waitFor(() => messages.length === 2);
      expect(messages[1].data).toEqual({ v: 1, client_id: '76543210987654321' });
      presence.useApp(''); presence.enable(false);
      await waitFor(() => clients[1].destroyed);
    } finally { presence.enable(false); }
  });
});

test('disabling an in-flight connection cannot interfere with the next generation', async () => {
  await withPeer(async ({ path, clients, messages }) => {
    const presence = new DiscordPresence('12345678901234567', () => [path]);
    try {
      presence.enable(true); presence.enable(false); presence.enable(true);
      await waitFor(() => messages.length > 0);
      const live = clients.at(-1)!;
      live.write(frame(1, { evt: 'READY' }));
      await waitFor(() => messages.some(message => isRecord(message.data) && message.data.cmd === 'SET_ACTIVITY'));
    } finally { presence.enable(false); }
  });
});

test('presence skips unavailable endpoints and obeys CLOSE without processing later frames', async () => {
  await withPeer(async ({ path, clients, messages }) => {
    const presence = new DiscordPresence('12345678901234567', () => [path + '-missing', path]);
    try {
      presence.enable(true);
      await waitFor(() => messages.length === 1);
      clients[0].write(Buffer.concat([frame(2, { code: 0 }), frame(1, { evt: 'READY' })]));
      await waitFor(() => clients[0].destroyed);
      expect(messages).toHaveLength(1);
    } finally { presence.enable(false); }
  });
});
