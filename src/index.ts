const native = require('../index.js');

export type IoErrorKind =
  | 'BrokenPipe'
  | 'ConnectionReset'
  | 'ConnectionAborted'
  | 'ConnectionRefused'
  | 'NetworkDown'
  | 'NetworkUnreachable'
  | 'NotConnected'
  | 'TimedOut'
  | 'Other';

export type VariantKind =
  | 'DataLegacy'
  | 'CodeLegacy'
  | 'DataMerkleUnchained'
  | 'DataMerkleResigned'
  | 'CodeMerkleUnchained'
  | 'CodeMerkleResigned';

export interface AccumulatorConfig {
  maxFecSetsPerSlot?: number;
  stuckBatchTimeoutMs?: number;
}

export interface ListenerOptions {
  recvBuf?: number;
  maxAge?: bigint;
  busyPollUs?: number;
  disableBusyPoll?: boolean;
  poolSize?: number;
  enableFec?: boolean;
  disableSalvageDelivery?: boolean;
  accumulator?: AccumulatorConfig;
}

export interface TransactionBatch {
  slot: bigint;
  transactions: Buffer[];
}

export interface RawShred {
  slot: bigint;
  index: number;
  payloadLen: number;
}

export interface ShredListener {
  nextTransaction(): Promise<TransactionBatch | null>;
  nextTransactionSync(): TransactionBatch | null;
  nextShred(): Promise<RawShred | null>;
  handlePacket(data: Buffer): TransactionBatch | null;
  close(): void;

  readonly slotCount: number;
  readonly poolExhaustedCount: bigint;
  readonly busyPollActive: boolean;
  readonly lastIoErrorKind: IoErrorKind | string | null;
  readonly dataShredCountTotal: bigint;
  readonly codeShredCountTotal: bigint;
  readonly bytesReceived: bigint;
  readonly unparseablePackets: bigint;
  readonly unparseableTooShort: bigint;
  readonly unparseableVariant: bigint;
  readonly unparseablePayload: bigint;
  readonly unparseableSlotRange: bigint;
  readonly droppedKnownSlots: bigint;
  readonly harvestedBatchesTotal: bigint;
  readonly decodeErrorsTotal: bigint;
  readonly fecRecoveriesTotal: bigint;
  readonly fecRecoveryFailuresTotal: bigint;
  readonly batchesSkippedTotal: bigint;
  readonly batchesDecodedStreamingTotal: bigint;
  readonly batchesDecodedFallbackTotal: bigint;
  readonly slotsCompletedTotal: bigint;
  readonly slotsEvictedByAge: bigint;
  readonly salvagedTailTxTotal: bigint;
  readonly fecSetsDiscardedUnusedTotal: bigint;
  readonly fecSetsEvictedEarlyTotal: bigint;
  readonly batchesForceFinalizedCorruptedTotal: bigint;
  readonly batchesForceFinalizedTimeoutTotal: bigint;
  readonly localAddress: string | null;

  [Symbol.asyncIterator](): AsyncIterator<TransactionBatch>;
}

interface ShredListenerCtor {
  bind(port: number): ShredListener;
  bindWithOptions(port: number, opts: ListenerOptions): ShredListener;
  offline(): ShredListener;
  fromFd(fd: number, opts: ListenerOptions): ShredListener;
}

const NativeShredListener = native.ShredListener as ShredListenerCtor & {
  prototype: ShredListener;
};

NativeShredListener.prototype[Symbol.asyncIterator] = async function* (
  this: ShredListener,
) {
  while (true) {
    const item = await this.nextTransaction();
    if (item === null) return;
    yield item;
  }
};

export const ShredListener: ShredListenerCtor = NativeShredListener;

export const classifyVariant: (byte: number) => VariantKind | null =
  native.classifyVariant;
export const variantProofSize: (byte: number) => number = native.variantProofSize;
export const variantResigned: (byte: number) => boolean = native.variantResigned;
export const variantMerkleSuffix: (byte: number) => number = native.variantMerkleSuffix;
export const pinCurrentThreadToCpu: (cpuId: number) => void =
  native.pinCurrentThreadToCpu;
export const VariantKind = native.VariantKind;
