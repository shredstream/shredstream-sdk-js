import bs58 from 'bs58';

export interface Transaction {
  signatures: Buffer[];
  raw: Buffer;
  signature: string;
}

export function readCompactU16(buf: Buffer, offset: number): [number, number] {
  const b0 = buf.readUInt8(offset);
  if (b0 < 0x80) {
    return [b0, offset + 1];
  }
  const b1 = buf.readUInt8(offset + 1);
  if (b1 < 0x80) {
    return [(b0 & 0x7f) | (b1 << 7), offset + 2];
  }
  const b2 = buf.readUInt8(offset + 2);
  return [(b0 & 0x7f) | ((b1 & 0x7f) << 7) | (b2 << 14), offset + 3];
}

function tryReadCompactU16(buf: Buffer, offset: number, length: number): [number, number] | null {
  if (offset >= length) return null;
  const b0 = buf[offset];
  if (b0 < 0x80) {
    return [b0, offset + 1];
  }
  if (offset + 1 >= length) return null;
  const b1 = buf[offset + 1];
  if (b1 < 0x80) {
    return [(b0 & 0x7f) | (b1 << 7), offset + 2];
  }
  if (offset + 2 >= length) return null;
  const b2 = buf[offset + 2];
  return [(b0 & 0x7f) | ((b1 & 0x7f) << 7) | (b2 << 14), offset + 3];
}

function tryWalkTransaction(buf: Buffer, offset: number, length: number): [number, Buffer[]] | null {
  let off = offset;
  const r0 = tryReadCompactU16(buf, off, length);
  if (!r0) return null;
  const [sigCount, newOff0] = r0;
  off = newOff0;

  const signatures: Buffer[] = [];
  for (let s = 0; s < sigCount; s++) {
    if (off + 64 > length) return null;
    signatures.push(buf.subarray(off, off + 64));
    off += 64;
  }

  if (off >= length) return null;
  const msgFirst = buf[off];
  const isV0 = msgFirst >= 0x80;
  if (isV0) off += 1;

  off += 3;
  if (off > length) return null;

  const r1 = tryReadCompactU16(buf, off, length);
  if (!r1) return null;
  const [acctCount, newOff1] = r1;
  off = newOff1;
  off += acctCount * 32;
  if (off > length) return null;

  off += 32;
  if (off > length) return null;

  const r2 = tryReadCompactU16(buf, off, length);
  if (!r2) return null;
  const [instrCount, newOff2] = r2;
  off = newOff2;
  for (let i = 0; i < instrCount; i++) {
    off += 1;
    if (off > length) return null;
    const r3 = tryReadCompactU16(buf, off, length);
    if (!r3) return null;
    const [acctsLen, newOff3] = r3;
    off = newOff3 + acctsLen;
    if (off > length) return null;
    const r4 = tryReadCompactU16(buf, off, length);
    if (!r4) return null;
    const [dataLen, newOff4] = r4;
    off = newOff4 + dataLen;
    if (off > length) return null;
  }

  if (isV0) {
    const r5 = tryReadCompactU16(buf, off, length);
    if (!r5) return null;
    const [lookupCount, newOff5] = r5;
    off = newOff5;
    for (let l = 0; l < lookupCount; l++) {
      off += 32;
      if (off > length) return null;
      const r6 = tryReadCompactU16(buf, off, length);
      if (!r6) return null;
      const [wLen, newOff6] = r6;
      off = newOff6 + wLen;
      if (off > length) return null;
      const r7 = tryReadCompactU16(buf, off, length);
      if (!r7) return null;
      const [rLen, newOff7] = r7;
      off = newOff7 + rLen;
      if (off > length) return null;
    }
  }

  return [off, signatures];
}

export class BatchDecoder {
  hadError = false;

  private buf: Buffer = Buffer.alloc(0);
  private cursor = 0;
  private expectedCount: number | null = null;
  private entriesYielded = 0;

  push(payload: Buffer): Transaction[] {
    this.hadError = false;
    this.buf = Buffer.concat([this.buf, payload]);
    return this.tryDeserialize();
  }

  reset(): void {
    this.hadError = false;
    this.buf = Buffer.alloc(0);
    this.cursor = 0;
    this.expectedCount = null;
    this.entriesYielded = 0;
  }

  private tryDeserialize(): Transaction[] {
    const txs: Transaction[] = [];
    const buf = this.buf;
    const len = buf.length;

    if (this.expectedCount === null) {
      if (len < this.cursor + 8) return txs;
      const count = Number(buf.readBigUInt64LE(this.cursor));
      this.cursor += 8;
      if (count > 100_000) {
        this.hadError = true;
        return txs;
      }
      this.expectedCount = count;
    }

    while (this.entriesYielded < this.expectedCount) {
      if (this.cursor + 48 > len) break;

      let off = this.cursor;
      off += 8 + 32;
      if (off + 8 > len) break;
      const txCount = Number(buf.readBigUInt64LE(off));
      off += 8;

      const entryTxs: Transaction[] = [];
      for (let t = 0; t < txCount; t++) {
        const txStart = off;
        const result = tryWalkTransaction(buf, off, len);
        if (result === null) {
          return txs;
        }
        const [endOff, signatures] = result;
        off = endOff;
        const raw = buf.subarray(txStart, off);
        const signature = signatures.length > 0 ? bs58.encode(signatures[0]) : '';
        entryTxs.push({ signatures, raw, signature });
      }

      txs.push(...entryTxs);
      this.cursor = off;
      this.entriesYielded++;
    }

    return txs;
  }
}
