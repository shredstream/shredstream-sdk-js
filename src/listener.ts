import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import { parseShred } from './parser';
import { SlotAccumulator } from './accumulator';
import { Transaction } from './decoder';

export interface ShredListenerOptions {
  recvBuf?: number;
  maxAge?: number;
}

export interface ShredListenerEvents {
  transactions: (slot: bigint, txs: Transaction[]) => void;
  shred: (slot: bigint, index: number, payload: Buffer) => void;
}

export class ShredListener extends EventEmitter {
  private readonly port: number;
  private readonly recvBuf: number;
  private readonly maxAge: number;
  private socket: dgram.Socket | null = null;

  private slots = new Map<bigint, SlotAccumulator>();
  private latestSlot: bigint = 0n;

  constructor(port: number, options?: ShredListenerOptions) {
    super();
    this.port = port;
    this.recvBuf = options?.recvBuf ?? 25 * 1024 * 1024;
    this.maxAge = options?.maxAge ?? 10;
  }

  on(event: 'transactions', listener: (slot: bigint, txs: Transaction[]) => void): this;
  on(event: 'shred', listener: (slot: bigint, index: number, payload: Buffer) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  start(): void {
    if (this.socket) return;

    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = sock;

    try {
      sock.on('message', (msg: Buffer) => this.handleMessage(msg));
      sock.bind(this.port, () => {
        try {
          sock.setRecvBufferSize(this.recvBuf);
        } catch {
        }
      });
    } catch (err) {
      this.socket = null;
      throw err;
    }
  }

  stop(): void {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }

  private handleMessage(msg: Buffer): void {
    const shred = parseShred(msg);
    if (!shred) {
      return;
    }

    this.emit('shred', shred.slot, shred.index, shred.payload);

    if (shred.slot > this.latestSlot) {
      this.latestSlot = shred.slot;
      this.evictOldSlots();
    }

    let acc = this.slots.get(shred.slot);
    if (!acc) {
      acc = new SlotAccumulator();
      this.slots.set(shred.slot, acc);
    }

    const prevErrors = acc.decodeErrors;
    const txs = acc.push(shred.index, shred.payload, shred.batchComplete, shred.lastInSlot);
    const newErrors = acc.decodeErrors - prevErrors;
    if (newErrors > 0) {
      this.slots.delete(shred.slot);
      if (txs.length > 0) {
        this.emit('transactions', shred.slot, txs);
      }
      return;
    }

    if (txs.length > 0) {
      this.emit('transactions', shred.slot, txs);
    }

    if (acc.slotComplete) {
      this.slots.delete(shred.slot);
    }
  }

  private evictOldSlots(): void {
    const cutoff = this.latestSlot - BigInt(this.maxAge);
    for (const slot of this.slots.keys()) {
      if (slot < cutoff) {
        this.slots.delete(slot);
      }
    }
  }
}
