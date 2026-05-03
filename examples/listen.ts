import { ShredListener } from '../src/index.js';
import { VersionedTransaction } from '@solana/web3.js';

async function main() {
  const port = parseInt(process.env.SHREDSTREAM_PORT ?? '8001', 10);
  const listener = ShredListener.bind(port);
  console.error(`shredstream listening on ${listener.localAddress}`);
  for await (const { slot, transactions } of listener) {
    for (const raw of transactions) {
      const tx = VersionedTransaction.deserialize(new Uint8Array(raw));
      console.log(`slot=${slot} sig=${tx.signatures[0]}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
