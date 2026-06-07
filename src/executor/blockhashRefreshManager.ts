import crypto from 'crypto';
import { solanaConnection } from '../network/solanaConnection';

export class BlockhashRefreshManager {
  private cachedBlockhash: string = '5K85x43H57kC8sM9oAdG3dm1zwP9S2n5Xy2T4eG96gWZ';
  private fetchSlot: number = 0;
  private mockMode: boolean;

  constructor(mockMode: boolean = true) {
    this.mockMode = mockMode;
  }

  /**
   * Helper to encode a Buffer to base58
   */
  private encodeBase58(buffer: Buffer): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const digits = [0];
    
    for (let i = 0; i < buffer.length; i++) {
      let carry = buffer[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = Math.floor(carry / 58);
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = Math.floor(carry / 58);
      }
    }
    
    // Add leading zeros
    let string = '';
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
      string += ALPHABET[0];
    }
    
    for (let i = digits.length - 1; i >= 0; i--) {
      string += ALPHABET[digits[i]];
    }
    
    return string;
  }

  /**
   * Generates a random 32-byte buffer and encodes it to base58 to produce a valid blockhash
   */
  private generateMockBlockhash(): string {
    const randomBytes = crypto.randomBytes(32);
    return this.encodeBase58(randomBytes);
  }

  /**
   * Fetches a fresh blockhash or returns a cached one if it is still within the freshness threshold (30 slots)
   */
  public async getRecentBlockhash(currentSlot: number, forceRefresh: boolean = false): Promise<string> {
    const age = currentSlot - this.fetchSlot;
    
    if (age > 30 || forceRefresh || this.fetchSlot === 0) {
      this.fetchSlot = currentSlot;
      
      if (this.mockMode) {
        this.cachedBlockhash = this.generateMockBlockhash();
        console.log(`[BlockhashRefreshManager] Refreshed cached blockhash at slot ${currentSlot}: ${this.cachedBlockhash}`);
      } else {
        try {
          console.log(`[BlockhashRefreshManager] REAL MODE: Fetching latest blockhash from Solana Devnet...`);
          const { blockhash } = await solanaConnection.getLatestBlockhash('processed');
          this.cachedBlockhash = blockhash;
          console.log(`[BlockhashRefreshManager] Successfully fetched live blockhash: ${this.cachedBlockhash}`);
        } catch (err) {
          console.error('[BlockhashRefreshManager] Failed to fetch live blockhash from Solana RPC, falling back to mock blockhash:', err);
          this.cachedBlockhash = this.generateMockBlockhash();
        }
      }
    }

    return this.cachedBlockhash;
  }
}
