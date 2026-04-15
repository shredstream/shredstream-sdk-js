import { BatchDecoder, Transaction } from './decoder';

interface PendingShred {
  payload: Buffer;
  batchComplete: boolean;
  lastInSlot: boolean;
}

export class SlotAccumulator {
  private static readonly GAP_SKIP_THRESHOLD = 5;
  private static readonly MAX_AWAITING_SKIPPED = 64;

  private pending = new Map<number, PendingShred>();
  private decoder = new BatchDecoder();
  private _nextIndex = 0;
  private _stallCount = 0;
  private _decodeErrors = 0;
  private awaitingBatchStart = false;
  private awaitingSkipped = 0;

  slotComplete = false;

  get decodeErrors(): number {
    return this._decodeErrors;
  }

  push(
    index: number,
    payload: Buffer,
    batchComplete: boolean,
    lastInSlot: boolean,
  ): Transaction[] {
    if (index < this._nextIndex || this.pending.has(index)) {
      return [];
    }

    this.pending.set(index, { payload, batchComplete, lastInSlot });

    return this.drain();
  }

  private drain(): Transaction[] {
    const allTxs: Transaction[] = [];
    const prevIndex = this._nextIndex;

    while (this.pending.has(this._nextIndex)) {
      const shred = this.pending.get(this._nextIndex)!;
      this.pending.delete(this._nextIndex);
      this._nextIndex++;

      if (this.awaitingBatchStart) {
        this.awaitingSkipped++;
        if (shred.batchComplete) {
          this.awaitingBatchStart = false;
          this.awaitingSkipped = 0;
        } else if (this.awaitingSkipped >= SlotAccumulator.MAX_AWAITING_SKIPPED) {
          this._decodeErrors++;
          return allTxs;
        }
        continue;
      }

      if (shred.lastInSlot) {
        this.slotComplete = true;
      }

      const txs = this.decoder.push(shred.payload);
      if (this.decoder.hadError) {
        this._decodeErrors++;
        return allTxs;
      }
      allTxs.push(...txs);

      if (shred.batchComplete) {
        this.decoder.reset();
      }
    }

    if (this._nextIndex > prevIndex) {
      this._stallCount = 0;
    } else {
      this._stallCount++;
      if (
        this._stallCount >= SlotAccumulator.GAP_SKIP_THRESHOLD &&
        this.pending.size > 0
      ) {
        let minKey = Infinity;
        for (const k of this.pending.keys()) {
          if (k < minKey) minKey = k;
        }
        this._nextIndex = minKey;
        this._stallCount = 0;
        this.decoder.reset();
        this.awaitingBatchStart = true;
        this.awaitingSkipped = 0;
        const skippedTxs = this.drain();
        allTxs.push(...skippedTxs);
      }
    }

    return allTxs;
  }
}
