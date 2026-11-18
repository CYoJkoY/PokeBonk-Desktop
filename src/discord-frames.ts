/** Discord IPC framing. Each payload is bounded before allocating its buffer. */
export const MAX_RPC_PAYLOAD = 1024 * 1024;
export type RpcFrame = { op: number; data: unknown };

/** Encodes one frame into a single buffer instead of allocating body, header and concatenated copies. */
export function encodeFrame(op: number, data: unknown): Buffer {
  const body = JSON.stringify(data);
  if (typeof body !== 'string') throw new Error('Discord IPC payload is not JSON serializable');
  const length = Buffer.byteLength(body, 'utf8');
  if (length > MAX_RPC_PAYLOAD) throw new Error('Discord IPC payload is too large');
  const frame = Buffer.allocUnsafe(8 + length);
  frame.writeInt32LE(op, 0);
  frame.writeInt32LE(length, 4);
  frame.write(body, 8, length, 'utf8');
  return frame;
}

export class DiscordFrames {
  private header = Buffer.alloc(8);
  private headerBytes = 0;
  private body: Buffer | null = null;
  private bodyBytes = 0;

  *read(chunk: Buffer): Generator<RpcFrame> {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.body && this.headerBytes === 0 && chunk.length - offset >= 8) {
        const length = chunk.readInt32LE(offset + 4);
        if (length <= 0 || length > MAX_RPC_PAYLOAD) throw new Error('Invalid Discord IPC payload length');
        if (length <= chunk.length - offset - 8) {
          const op = chunk.readInt32LE(offset);
          const end = offset + 8 + length;
          const data = JSON.parse(chunk.toString('utf8', offset + 8, end)) as unknown;
          offset = end;
          yield { op, data };
          continue;
        }
      }
      if (!this.body) {
        const count = Math.min(8 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + count);
        this.headerBytes += count;
        offset += count;
        if (this.headerBytes < 8) return;
        const length = this.header.readInt32LE(4);
        if (length <= 0 || length > MAX_RPC_PAYLOAD) throw new Error('Invalid Discord IPC payload length');
        this.body = Buffer.allocUnsafe(length);
      }
      const count = Math.min(this.body.length - this.bodyBytes, chunk.length - offset);
      chunk.copy(this.body, this.bodyBytes, offset, offset + count);
      this.bodyBytes += count;
      offset += count;
      if (this.bodyBytes < this.body.length) return;
      const op = this.header.readInt32LE(0);
      const body = this.body;
      this.body = null;
      this.bodyBytes = this.headerBytes = 0;
      yield { op, data: JSON.parse(body.toString('utf8')) as unknown };
    }
  }
}
