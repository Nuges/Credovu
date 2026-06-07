import { NetworkMetrics, LeaderType } from '../types';
import { LeaderScheduleTracker } from './leaderScheduleTracker';

export class CongestionSignalProcessor {
  private leaderTracker: LeaderScheduleTracker;
  private recentFailures: boolean[] = [];
  private baseFeeHistory: number[] = [1000]; // in microlamports

  constructor(leaderTracker: LeaderScheduleTracker) {
    this.leaderTracker = leaderTracker;
  }

  /**
   * Tracks an execution outcome to update the recent failure rate metric
   */
  public recordOutcome(success: boolean): void {
    this.recentFailures.push(!success);
    if (this.recentFailures.length > 50) {
      this.recentFailures.shift();
    }
  }

  /**
   * Calculates recent failure percentage
   */
  private getRecentFailureRate(): number {
    if (this.recentFailures.length === 0) return 0;
    const failures = this.recentFailures.filter(f => f).length;
    return Math.round((failures / this.recentFailures.length) * 100);
  }

  /**
   * Computes modern metrics for the current slot, including simulated noise
   */
  public getMetricsForSlot(slot: number): NetworkMetrics {
    const leaderInfo = this.leaderTracker.getLeaderForSlot(slot);
    
    // Simulate congestion fluctuations.
    // We add a periodic load spike every 100 slots to simulate NFTs, liquidations, or blockspace demand.
    const isSpikeSlot = (Math.floor(slot / 50) % 3 === 0);
    
    let congestionRate = 15 + (slot % 17); // base noise
    let queueDepth = 50 + (slot % 120);

    if (isSpikeSlot) {
      congestionRate += 50; // high congestion spike
      queueDepth += 400;
    }

    // Clamp values
    congestionRate = Math.min(100, Math.max(0, congestionRate));
    
    // Dynamic base fee depending on congestion
    const baseFee = Math.round(1000 + (congestionRate * 250)); // microlamports
    this.baseFeeHistory.push(baseFee);
    if (this.baseFeeHistory.length > 10) this.baseFeeHistory.shift();

    return {
      slot,
      leaderType: leaderInfo.type,
      leaderIdentity: leaderInfo.identity,
      congestionRate,
      queueDepth,
      recentFailureRate: this.getRecentFailureRate(),
      recentBaseFee: baseFee
    };
  }
}
