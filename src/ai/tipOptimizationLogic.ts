import { NetworkMetrics } from '../types';
import { callJitoRpc } from '../core/bundleManager';

export class TipOptimizationLogic {
  private baseTipLamports = 10_000; // 0.00001 SOL
  private maxTipLamports = 5_000_000; // 0.005 SOL
  private dynamicBaseTipLamports: number | null = null;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.fetchTipFloor();
    // Refresh tip floor baseline every 30 seconds
    this.intervalId = setInterval(() => this.fetchTipFloor(), 30000);
  }

  public destroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  private async fetchTipFloor(): Promise<void> {
    try {
      // Query recent bundle tip floors from Jito Block Engine
      const stats = await callJitoRpc('getTipFloor');
      if (Array.isArray(stats) && stats.length > 0) {
        // Grab latest block statistics
        const latest = stats[stats.length - 1];
        const floorVal = latest.landed_tips_25th_percentile || latest.landed_tips_50th_percentile;
        if (typeof floorVal === 'number' && floorVal > 0) {
          this.dynamicBaseTipLamports = floorVal;
          console.log(`[TipOptimizationLogic] Dynamic tip floor baseline updated: ${floorVal} lamports`);
        }
      }
    } catch (err: any) {
      console.warn(`[TipOptimizationLogic] Dynamic tip floor query failed, using fallback. Error:`, err.message || err);
    }
  }

  /**
   * Dynamically calculates Jito tip based on network load and metrics
   */
  public calculateTip(metrics: NetworkMetrics): number {
    const baseline = this.dynamicBaseTipLamports || this.baseTipLamports;

    // 1. Congestion multiplier
    // As congestion goes from 0 to 100%, we scale the tip exponentially
    const congestionFactor = metrics.congestionRate / 100;
    const congestionMultiplier = 1 + Math.pow(congestionFactor, 2) * 50; // up to 51x multiplier

    // 2. Queue depth impact
    // Large queue depths represent competitive block space
    const queueMultiplier = 1 + Math.min(10, metrics.queueDepth / 100); // up to 10x multiplier

    // 3. Historical failure rate impact
    // If failures are high, we must pay a premium to guarantee inclusion
    const failureMultiplier = 1 + (metrics.recentFailureRate / 100) * 5; // up to 6x multiplier

    // Calculate preliminary tip scaling from the dynamic baseline
    let tip = baseline * congestionMultiplier * queueMultiplier * failureMultiplier;

    // Standard leaders don't accept Jito tips, but we calculate it anyway for analytics.
    if (metrics.leaderType === 'Standard') {
      tip = tip * 0.8; // Minor discount since standard doesn't process bundles directly
    }

    // Clamp between base and maximum values
    const finalTip = Math.min(this.maxTipLamports, Math.max(baseline, Math.round(tip)));

    return finalTip;
  }
}
