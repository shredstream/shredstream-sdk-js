import { ShredListener } from '../src';

const listener = new ShredListener(8001);

listener.on('transactions', (slot, txs) => {
  console.log(`slot ${slot}: ${txs.length} transaction(s)`);
  txs.forEach(tx => console.log(`  ${tx.signature}`));
});

listener.start();
console.log('Listening on port 8001...');
