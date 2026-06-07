import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

console.log(`[SolanaConnection] Initializing connection to Solana RPC: ${RPC_URL}`);

export const solanaConnection = new Connection(RPC_URL, {
  commitment: 'processed',
  wsEndpoint: RPC_URL.replace(/^http/, 'ws'), // Automatically map ws endpoint if custom
});
