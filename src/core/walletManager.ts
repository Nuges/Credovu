import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config();

let keypair: Keypair;

const privateKeyBase58 = process.env.PAYER_PRIVATE_KEY;

if (privateKeyBase58 && privateKeyBase58.trim().length > 0) {
  try {
    const decoded = bs58.decode(privateKeyBase58.trim());
    keypair = Keypair.fromSecretKey(decoded);
    console.log(`[WalletManager] Successfully loaded Phantom signing wallet: ${keypair.publicKey.toBase58()}`);
  } catch (err) {
    console.error('[WalletManager] Error parsing private key from environment, falling back to fresh keypair:', err);
    keypair = Keypair.generate();
  }
} else {
  console.warn('[WalletManager] No PAYER_PRIVATE_KEY found in .env. Initializing a mock keypair for safety:');
  keypair = Keypair.generate();
  console.warn(`[WalletManager] Public key: ${keypair.publicKey.toBase58()}`);
}

export const walletManager = {
  getSigner(): Keypair {
    return keypair;
  },
  getPublicKey() {
    return keypair.publicKey;
  }
};
