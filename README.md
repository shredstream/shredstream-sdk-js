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

### TypeScript

Create a file `index.ts`:

```typescript
import { ShredListener } from 'shredstream';

const PORT = parseInt(process.env.SHREDSTREAM_PORT || '8001');
const listener = new ShredListener(PORT);

// Decoded transactions — ready-to-use Solana transactions
listener.on('transactions', (slot, txs) => {
  txs.forEach(tx => console.log(`slot ${slot}: ${tx.signature}`));
});

// OR raw shreds — lowest latency, arrives before block assembly
// listener.on('shred', (slot, index, payload) => {
//   console.log(`slot ${slot} index ${index} len ${payload.length}`);
// });

listener.start();
```

Run it:

```bash
npx tsx index.ts
```

### JavaScript

Create a file `index.js`:

```javascript
const { ShredListener } = require('shredstream');

// Bind to the UDP port configured on ShredStream.com
const PORT = parseInt(process.env.SHREDSTREAM_PORT || '8001');
const listener = new ShredListener(PORT);

// Decoded transactions — ready-to-use Solana transactions
listener.on('transactions', (slot, txs) => {
  txs.forEach(tx => console.log(`slot ${slot}: ${tx.signature}`));
});

// OR raw shreds — lowest latency, arrives before block assembly
// listener.on('shred', (slot, index, payload) => {
//   console.log(`slot ${slot} index ${index} len ${payload.length}`);
// });

listener.start();
```

Run it:

```bash
node index.js
```

## 📖 API Reference

### `new ShredListener(port, options?)`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `port` | `number` | — | UDP port to bind |
| `options.recvBuf` | `number` | 8 MiB | Socket receive buffer size |
| `options.maxAge` | `number` | 128 | Maximum slot age before eviction |

#### Events

- `'shred'` `(slot: bigint, index: number, payload: Buffer)` — Emitted for each received data shred
- `'transactions'` `(slot: bigint, txs: Transaction[])` — Emitted as transactions are decoded from incoming shreds

#### Methods

- `listener.start()` — Create the UDP socket and begin listening
- `listener.stop()` — Close the socket
- `listener.activeSlots()` — Number of slots currently being accumulated

### `Transaction`

| Field | Type | Description |
|-------|------|-------------|
| `signatures` | `Buffer[]` | Raw 64-byte signatures |
| `raw` | `Buffer` | Full wire-format transaction bytes |
| `signature` | `string` | First signature as base58 |

## 🎯 Use Cases

ShredStream.com shred data powers a wide range of latency-sensitive strategies — HFT, MEV extraction, token sniping, copy trading, liquidation bots, on-chain analytics, and more.

### 💎 PumpFun Token Sniping

ShredStream.com SDK detects PumpFun token creations **~499ms before they appear on PumpFun's live feed** — tested across 25 consecutive detections:

<img src="https://raw.githubusercontent.com/shredstream/shredstream-sdk-js/main/assets/shredstream.com_sdk_vs_pumpfun_live_feed.gif" alt="ShredStream.com SDK vs PumpFun live feed — ~499ms advantage" width="600">

> [ShredStream.com](https://shredstream.com) provides a complete, optimized PumpFun token creation detection code exclusively to Pro plan subscribers and above. Battle-tested, high-performance, ready to plug into your sniping pipeline. To get access, open a ticket on [Discord](https://discord.gg/4w2DNbTaWD) or reach out on Telegram [@shredstream](https://t.me/shredstream).

## ⚙️ Configuration

### OS Tuning

```bash
# Linux — increase max receive buffer
sudo sysctl -w net.core.rmem_max=33554432

# macOS
sudo sysctl -w kern.ipc.maxsockbuf=33554432
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
