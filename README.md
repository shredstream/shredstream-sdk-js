# Solana ShredStream SDK for JavaScript / TypeScript

Solana ShredStream SDK/Decoder for JavaScript/TypeScript, enabling ultra-low latency Solana transaction streaming via UDP shreds from ShredStream.com

> Part of the [ShredStream.com](https://shredstream.com) ecosystem — ultra-low latency [Solana shred streaming](https://shredstream.com) via UDP.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178C6?logo=typescript&logoColor=white)](#)
[![Node](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](#)

## 📋 Prerequisites

1. **Create an account** on [ShredStream.com](https://shredstream.com)
2. **Launch a Shred Stream** and pick your region (Frankfurt, Amsterdam, Singapore, Chicago, and more)
3. **Enter your server's IP address** and the UDP port where you want to receive shreds
4. **Open your firewall** for inbound UDP traffic on that port (e.g. configure your cloud provider's security group)
5. Install [Node.js 18+](https://nodejs.org) and npm:
   ```bash
   # Linux (Ubuntu/Debian)
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs

   # macOS
   brew install node
   ```

> 🎁 Want to try before you buy? Open a ticket on our [Discord](https://discord.gg/4w2DNbTaWD) to request a free trial.

## 📦 Installation

```bash
npm install shredstream
```

## ⚡ Quick Start

Create a file `index.ts`:

```typescript
import { ShredListener } from 'shredstream';
import { VersionedTransaction } from '@solana/web3.js';

const PORT = parseInt(process.env.SHREDSTREAM_PORT || '8001');
const listener = ShredListener.bind(PORT);

while (true) {
  const batch = listener.nextTransactionSync();
  if (batch === null) {
    throw new Error(`shredstream listener stopped: ${listener.lastIoErrorKind ?? 'unknown'}`);
  }
  for (const raw of batch.transactions) {
    const tx = VersionedTransaction.deserialize(new Uint8Array(raw));
    console.log(`slot ${batch.slot}: ${tx.signatures[0]}`);
  }
}
```

> `nextTransactionSync()` is the lowest-latency path — recommended for dedicated MEV / sniping consumers. A `null` return is a terminal state (socket closed, fatal I/O like `BrokenPipe` or `NetworkDown`); inspect `listener.lastIoErrorKind` and let your process supervisor (systemd, Docker, k8s) restart you. If you need to mix with other Node async I/O (`dgram.send`, HTTP, timers), use `for await (const batch of listener)` instead — see [Performance](#-performance).

Run it:

```bash
npx tsx index.ts
```

## 📖 API Reference

### `ShredListener`

- `ShredListener.bind(port)` — Bind with defaults (64 MB recv buf, 3 slot window, FEC enabled)
- `ShredListener.bindWithOptions(port, opts)` — Custom configuration
- `ShredListener.offline()` — Bind on ephemeral port; drive via `handlePacket()`
- `ShredListener.fromFd(fd, opts)` — Adopt an existing UDP file descriptor
- `listener.nextTransactionSync()` — **Sync** single-pull (lowest latency, MEV-grade — see [Performance](#-performance))
- `for await (const { slot, transactions } of listener)` — Async iterator, compatible with other Node async I/O
- `await listener.nextTransaction()` — Async single-pull, resolves to `{ slot, transactions } | null`
- `await listener.nextShred()` — Raw shred header `{ slot, index, payloadLen }`
- `listener.handlePacket(buf: Buffer)` — Inject an externally-received UDP datagram
- `listener.close()` — Release the socket

### Options

```typescript
interface ListenerOptions {
  recvBuf?: number;
  maxAge?: bigint;
  busyPollUs?: number;
  disableBusyPoll?: boolean;
  poolSize?: number;
  enableFec?: boolean;
  disableSalvageDelivery?: boolean;
  accumulator?: { maxFecSetsPerSlot?: number; stuckBatchTimeoutMs?: number };
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `recvBuf` | `64 MB` | `SO_RCVBUF` size. Kernel `rmem_max` must allow it |
| `maxAge` | `3n` | Slot retention window |
| `busyPollUs` | `200` | Linux `SO_BUSY_POLL` µs (best-effort) |
| `disableBusyPoll` | `false` | Pass `true` to disable busy poll explicitly |
| `poolSize` | `4096` | Number of 2 KiB buffers in the zero-copy pool |
| `enableFec` | `true` | Reed-Solomon recovery on dropped data shreds |
| `disableSalvageDelivery` | `false` | Drop salvaged tail txs for lowest p99 |
| `accumulator.maxFecSetsPerSlot` | `32` | Per-slot FEC buffer cap |
| `accumulator.stuckBatchTimeoutMs` | `50` | Force-finalize a stuck batch after this delay |

### Metrics

Read-only getters mirroring the Rust crate. All `u64` counters are `bigint`:

| Group | Getters |
|-------|---------|
| **Throughput** | `dataShredCountTotal`, `codeShredCountTotal`, `bytesReceived`, `slotCount` |
| **Decoder** | `batchesDecodedStreamingTotal`, `batchesDecodedFallbackTotal`, `batchesSkippedTotal`, `decodeErrorsTotal` |
| **FEC** | `fecRecoveriesTotal`, `fecRecoveryFailuresTotal`, `fecSetsDiscardedUnusedTotal`, `fecSetsEvictedEarlyTotal` |
| **Unparseable** | `unparseablePackets`, `unparseableTooShort`, `unparseableVariant`, `unparseablePayload`, `unparseableSlotRange` |
| **Slot lifecycle** | `slotsCompletedTotal`, `slotsEvictedByAge`, `droppedKnownSlots`, `harvestedBatchesTotal`, `salvagedTailTxTotal` |
| **Tail control** | `batchesForceFinalizedCorruptedTotal`, `batchesForceFinalizedTimeoutTotal` |
| **Pool / I-O** | `poolExhaustedCount`, `lastIoErrorKind`, `busyPollActive`, `localAddress` |

### Helpers

- `classifyVariant(byte: number)` → `'DataLegacy' | 'CodeLegacy' | 'DataMerkleUnchained' | 'DataMerkleResigned' | 'CodeMerkleUnchained' | 'CodeMerkleResigned' | null`
- `variantProofSize(byte)` / `variantResigned(byte)` / `variantMerkleSuffix(byte)` — Merkle metadata
- `pinCurrentThreadToCpu(cpuId: number)` — Best-effort thread pinning. Linux: `sched_setaffinity`; macOS: hint; other: no-op

## 🎯 Use Cases

ShredStream.com shred data powers a wide range of latency-sensitive strategies — HFT, MEV extraction, token sniping, copy trading, liquidation bots, on-chain analytics, and more.

### 💎 PumpFun Token Sniping

ShredStream.com SDK detects PumpFun token creations **~499ms before they appear on PumpFun's live feed** — tested across 25 consecutive detections:

<img src="https://raw.githubusercontent.com/shredstream/shredstream-sdk-js/main/assets/shredstream.com_sdk_vs_pumpfun_live_feed.gif" alt="ShredStream.com SDK vs PumpFun live feed — ~499ms advantage" width="600">

> Ready-to-run example included: see [`examples/pumpfun_creates.ts`](examples/pumpfun_creates.ts). Run with `npx tsx examples/pumpfun_creates.ts [port]`.

## 🏎️ Performance

Two delivery APIs, depending on what your process does between batches.

### `listener.nextTransactionSync()` — MEV-grade hot loop (default in Quick Start)

Synchronous pull. Returns `{ slot, transactions } | null` directly — no Promise allocation, no `Buffer.from` round-trip, no event-loop hop. Fastest possible delivery.

```typescript
while (true) {
  const batch = listener.nextTransactionSync();
  if (batch === null) {
    throw new Error(`shredstream listener stopped: ${listener.lastIoErrorKind ?? 'unknown'}`);
  }
  for (const raw of batch.transactions) {
    // synchronous decode + outbound send (e.g. raw-socket, RDMA, etc.)
  }
}
```

> ⚠️ **Sync mode blocks the libuv event loop** while parked on UDP `recv`. Any other async I/O in this process (`dgram.send`, HTTP, `fs.readFile`, `setTimeout`) will not progress while sync mode is parked. Use sync mode only in a dedicated process or a `worker_thread` whose only job is to consume shreds. For mixed workloads, switch to `for await` below.

### `for await` / `await listener.nextTransaction()` — mixed async workloads

Async-await flow. Compatible with any other Node async I/O (`dgram`, `fs`, HTTP clients, timers). The iterator parks on the libuv event loop while waiting on UDP.

```typescript
for await (const { slot, transactions } of listener) {
  // safe to await other async work here
}
```

## ⚙️ Configuration

### OS Tuning

```bash
# Linux
sudo sysctl -w net.core.rmem_max=67108864
sudo sysctl -w net.core.busy_read=200

# macOS
sudo sysctl -w kern.ipc.maxsockbuf=67108864
```

## 🚀 Launch a Shred Stream

Need a feed? **[Launch a Solana Shred Stream on ShredStream.com](https://shredstream.com)** — sub-millisecond delivery, multiple global regions, 5-minute setup.

## 🔗 Links

- 🌐 Website: https://www.shredstream.com/
- 📖 Documentation: https://docs.shredstream.com/
- 🐦 X (Twitter): https://x.com/ShredStream
- 🎮 Discord: https://discord.gg/4w2DNbTaWD
- 💬 Telegram: https://t.me/ShredStream
- 💻 GitHub: https://github.com/ShredStream
- 🎫 Support: [Discord](https://discord.gg/4w2DNbTaWD)
- 📊 Benchmarks: [Discord](https://discord.gg/4w2DNbTaWD)

## 📄 License

MIT — [ShredStream.com](https://shredstream.com)
