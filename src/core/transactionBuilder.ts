import { Keypair, PublicKey, SystemProgram, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import bs58 from 'bs58';

export class TransactionBuilder {
  private payer: Keypair;

  constructor(privateKeyBase58?: string) {
    if (privateKeyBase58) {
      try {
        const decoded = bs58.decode(privateKeyBase58.trim());
        this.payer = Keypair.fromSecretKey(decoded);
        console.log(`[TransactionBuilder] Payer loaded: ${this.payer.publicKey.toBase58()}`);
      } catch (err) {
        console.error('[TransactionBuilder] Error parsing private key, generating random:', err);
        this.payer = Keypair.generate();
      }
    } else {
      this.payer = Keypair.generate();
    }
  }

  public getPayerPublicKey(): PublicKey {
    return this.payer.publicKey;
  }

  /**
   * Builds a real Transfer Transaction with optional Compute Budget instructions
   * @param recipientAddress Destination wallet base58 string
   * @param amountLamports Lamports to transfer
   * @param recentBlockhash Target blockhash
   * @param computeLimit optional maximum compute units (default 200,000)
   * @param microLamports optional priority fee price (microLamports/CU)
   */
  public buildTransferTx(
    recipientAddress: string,
    amountLamports: number,
    recentBlockhash: string,
    computeLimit: number = 200000,
    microLamports: number = 5000 // default light priority fee
  ): Transaction {
    const recipient = new PublicKey(recipientAddress);
    
    const transaction = new Transaction({
      feePayer: this.payer.publicKey,
      recentBlockhash: recentBlockhash,
    });

    // 1. Add Compute Unit Limit instruction
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: computeLimit
      })
    );

    // 2. Add Compute Unit Price (priority fee) instruction
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: BigInt(microLamports)
      })
    );

    // 3. Add transfer instruction
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: this.payer.publicKey,
        toPubkey: recipient,
        lamports: BigInt(amountLamports),
      })
    );

    // Sign transaction
    transaction.sign(this.payer);

    return transaction;
  }
}
