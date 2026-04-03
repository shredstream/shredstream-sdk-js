const DATA_HEADER_SIZE = 0x58;

export interface ParsedShred {
  slot: bigint;
  index: number;
  payload: Buffer;
  batchComplete: boolean;
  lastInSlot: boolean;
}

const FLAG_DATA_COMPLETE = 0x40;
const FLAG_LAST_IN_SLOT = 0xc0;

export function parseShred(raw: Buffer): ParsedShred | null {
  if (raw.length < DATA_HEADER_SIZE) return null;

  const slot = raw.readBigUInt64LE(0x41);
  const index = raw.readUInt32LE(0x49);
  const flags = raw.readUInt8(0x55);
  const size = raw.readUInt16LE(0x56);

  const payloadLen = size - DATA_HEADER_SIZE;
  if (payloadLen < 0 || raw.length < size) return null;

  const payload = raw.subarray(DATA_HEADER_SIZE, DATA_HEADER_SIZE + payloadLen);

  const lastInSlot = (flags & FLAG_LAST_IN_SLOT) === FLAG_LAST_IN_SLOT;
  const batchComplete = lastInSlot || (flags & FLAG_DATA_COMPLETE) === FLAG_DATA_COMPLETE;

  return { slot, index, payload, batchComplete, lastInSlot };
}
