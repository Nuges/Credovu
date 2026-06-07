import { FailureClassification, NetworkMetrics } from '../types';

export interface RecoveryAction {
  failureType: FailureClassification;
  reason: string;
  actionRequired: 'REFRESH_BLOCKHASH' | 'BOOST_TIP' | 'RE_ESTIMATE_CU' | 'WAIT_LEADER_ROTATION' | 'WAIT_NEXT_SLOT';
  description: string;
  tipMultiplier: number;
  delayOverrideMs: number;
}

export class FailureReasoningModule {

  /**
   * Evaluates a failed transaction and generates a recovery roadmap
   */
  public reasonAboutFailure(
    failureType: FailureClassification,
    metrics: NetworkMetrics
  ): RecoveryAction {
    switch (failureType) {
      case 'BlockhashExpired':
        return {
          failureType,
          reason: 'Transaction remained in RPC pools longer than 150 slots (approx 60s), rendering blockhash invalid.',
          actionRequired: 'REFRESH_BLOCKHASH',
          description: 'Refresh blockhash immediately from Solana RPC node, rebuild transaction payload, sign, and resubmit.',
          tipMultiplier: 1.0,
          delayOverrideMs: 0
        };

      case 'FeeTooLow':
        return {
          failureType,
          reason: 'Jito block engine dropped the bundle because competing bundles submitted higher tip fees.',
          actionRequired: 'BOOST_TIP',
          description: 'Increase Jito tip by 50% to outcompete standard network tip streams under congestion.',
          tipMultiplier: 1.5,
          delayOverrideMs: 50
        };

      case 'ComputeBudgetExceeded':
        return {
          failureType,
          reason: 'Simulated execution hit transaction Compute Unit limit (e.g., exceeded 200,000 CUs).',
          actionRequired: 'RE_ESTIMATE_CU',
          description: 'Attach ComputeBudgetProgram instructions adding +50,000 Compute Units and bump priority fee.',
          tipMultiplier: 1.1,
          delayOverrideMs: 100
        };

      case 'BundleDropped':
        return {
          failureType,
          reason: 'Bundle received by block engine but dropped before slot finalization (reorg or slot skip).',
          actionRequired: 'WAIT_LEADER_ROTATION',
          description: 'Wait for next Jito validator block start to avoid double spend or sub-optimal execution window.',
          tipMultiplier: 1.2,
          delayOverrideMs: 400 // Wait 1 slot duration
        };

      case 'LeaderMissedSlot':
        return {
          failureType,
          reason: 'Assigned validator did not produce a block in its scheduled slots (skipped slot).',
          actionRequired: 'WAIT_NEXT_SLOT',
          description: 'Validator offline or desynchronized. Delay transaction until leader schedule shifts to next active node.',
          tipMultiplier: 1.0,
          delayOverrideMs: 800 // Wait 2 slots duration
        };

      default:
        return {
          failureType: 'Unknown',
          reason: 'An unclassified RPC or execution error occurred.',
          actionRequired: 'REFRESH_BLOCKHASH',
          description: 'Re-fetch blockhash and attempt generic retry under defensive network assumptions.',
          tipMultiplier: 1.2,
          delayOverrideMs: 200
        };
    }
  }
}
