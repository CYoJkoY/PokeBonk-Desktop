/** Discord IPC framing. Each payload is bounded before allocating its buffer. */
export const MAX_RPC_PAYLOAD = 1024 * 1024;
export type RpcFrame = { op: number; data: unknown };

export class DiscordFrames {
  private header = Buffer.alloc(8);
  private headerBytes = 0;
  private body: Buffer | null = null;
  private bodyBytes = 0;

  *read(chunk: Buffer): Generator<RpcFrame> {
    let offset = 0;
    while (offset < chunk.length) {
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
