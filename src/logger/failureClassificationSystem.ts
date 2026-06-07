import { FailureClassification } from '../types';

export class FailureClassificationSystem {

  /**
   * Translates RPC raw errors or Jito rejection messages to standard Credovu failures
   * @param errorRaw String or error object from RPC/Jito Node
   */
  public static classify(errorRaw: any): FailureClassification {
    if (!errorRaw) return 'Unknown';

    const message = (typeof errorRaw === 'string' 
      ? errorRaw 
      : errorRaw.message || errorRaw.toString()
    ).toLowerCase();

    if (message.includes('blockhash') || message.includes('expired') || message.includes('validity')) {
      return 'BlockhashExpired';
    }

    if (message.includes('fee') || message.includes('tip') || message.includes('payment') || message.includes('insufficient')) {
      return 'FeeTooLow';
    }

    if (message.includes('compute') || message.includes('budget') || message.includes('limit') || message.includes('exceeded')) {
      return 'ComputeBudgetExceeded';
    }

    if (message.includes('dropped') || message.includes('bundle') || message.includes('discarded')) {
      return 'BundleDropped';
    }

    if (message.includes('leader') || message.includes('slot') || message.includes('skipped') || message.includes('missed')) {
      return 'LeaderMissedSlot';
    }

    return 'Unknown';
  }
}
