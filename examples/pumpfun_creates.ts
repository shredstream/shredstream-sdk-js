import { ShredListener } from '../src/index.js';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

const PUMPFUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const CREATE_DISC = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
const CREATE_V2_DISC = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

interface PumpfunCreate {
  mint: string;
  bondingCurve: string;
  creator: string;
  sig: string;
}

function detectCreate(raw: Buffer): PumpfunCreate | null {
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(raw);
  } catch {
    return null;
  }
  const message = tx.message;
  const keys = message.staticAccountKeys;
  for (const ix of message.compiledInstructions) {
    const pidIdx = ix.programIdIndex;
    if (pidIdx >= keys.length) continue;
    if (!keys[pidIdx].equals(PUMPFUN_PROGRAM_ID)) continue;
    const data = Buffer.from(ix.data);
    if (data.length < 8) continue;
    const disc = data.subarray(0, 8);
    const isCreate = disc.equals(CREATE_DISC);
    const isV2 = disc.equals(CREATE_V2_DISC);
    if (!isCreate && !isV2) continue;
    const accounts = ix.accountKeyIndexes;
    const resolve = (idx: number): string => {
      if (idx >= accounts.length) return '';
      const k = accounts[idx];
      if (k >= keys.length) return '';
      return keys[k].toBase58();
    };
    const creatorIdx = isV2 ? 5 : 7;
    return {
      mint: resolve(0),
      bondingCurve: resolve(2),
      creator: resolve(creatorIdx),
      sig: Buffer.from(tx.signatures[0]).toString('hex'),
    };
  }
  return null;
}

function printCard(slot: bigint, sig: string, c: PumpfunCreate) {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
  const sigShort = sig.length >= 8 ? `${sig.slice(0, 4)}...${sig.slice(-4)}` : sig;

  const G = '\x1b[1;32m', DIM = '\x1b[90m', W = '\x1b[97m';
  const Y = '\x1b[33m', C = '\x1b[36m', M = '\x1b[35m';
  const D = '\x1b[2m', R = '\x1b[0m';

  console.log(`${DIM}┌───────────────────────────────────────────────────────────────┐${R}`);
  console.log(`${DIM}│${R}  🌐 ${W}ShredStream.com${R} ${DIM}SDK${R}                                       ${DIM}│${R}`);
  console.log(`${DIM}└───────────────────────────────────────────────────────────────┘${R}`);
  console.log();
  console.log(`${G}━━━━━━━━━━━━━━━━━━━━━━ 🚀 PUMPFUN CREATE ━━━━━━━━━━━━━━━━━━━━━━━${R}`);
  console.log(` ${DIM}›${R} ${DIM}🕐 Time${R}     ${W}${timeStr}${R}`);
  console.log(` ${DIM}›${R} ${DIM}📦 Slot${R}     ${W}${slot}${R}`);
  console.log(` ${DIM}›${R} ${DIM}🪙 Mint${R}     ${Y}${c.mint}${R}`);
  console.log(` ${DIM}›${R} ${DIM}📈 Curve${R}    ${C}${c.bondingCurve}${R}`);
  console.log(` ${DIM}›${R} ${DIM}👤 Creator${R}  ${M}${c.creator}${R}`);
  console.log(` ${DIM}›${R} ${DIM}🔑 Sig${R}      ${D}${sigShort}${R}`);
  console.log(`${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}`);
}

async function main() {
  const port = Number.parseInt(process.argv[2] ?? process.env.SHREDSTREAM_PORT ?? '8001', 10);
  const listener = ShredListener.bind(port);
  process.stderr.write(`Listening for PumpFun creates on ${listener.localAddress}\n`);

  let found = 0n;
  for await (const batch of listener) {
    for (const raw of batch.transactions) {
      const c = detectCreate(raw);
      if (c === null) continue;
      found += 1n;
      process.stdout.write('\x1b[H\x1b[2J');
      printCard(batch.slot, c.sig, c);
      console.log(`\n\x1b[90m  #${found} detected\x1b[0m`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
});
