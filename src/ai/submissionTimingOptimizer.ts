import { NetworkMetrics } from '../types';

export class SubmissionTimingOptimizer {
  private slotDurationMs = 400; // Solana block time

  /**
   * Calculates optimal submission delays in milliseconds
   */
  public calculateDelay(metrics: NetworkMetrics): number {
    const slotOffset = metrics.slot % 4; // Solana validators produce blocks in rounds of 4 slots
    const remainingSlots = 4 - slotOffset;

    // Case 1: Standard leader currently, but Jito leader is up next
    // If we are in the last slot of a standard validator's block (offset 3), 
    // it is highly optimal to wait until the next slot starts so we land on the Jito validator bundle auction.
    if (metrics.leaderType === 'Standard' && slotOffset === 3) {
      // Delay by the remaining time of this slot, plus a small buffer
      return Math.round(remainingSlots * this.slotDurationMs * 0.9); // ~360ms delay
    }

    // Case 2: Extreme Congestion
    // Under extreme congestion (>80%), introduce randomized micro-jitter (20ms to 120ms) 
    // to prevent bundle collision at block boundaries.
    if (metrics.congestionRate > 80) {
      return Math.round(20 + Math.random() * 100);
    }

    // Case 3: Standard conditions, Jito leader is active
    // We want to submit immediately to capitalize on the active Jito block.
    if (metrics.leaderType === 'Jito') {
      return 0; // 0ms delay, submit instantly
    }

    // Default: light pacing delay to allow nodes to sync
    return 10;
  }
}
