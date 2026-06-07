import { TransactionLog, TransactionState } from '../types';

export class LifecycleLogger {

  /**
   * Emits structured JSON logs representing state updates
   */
  public static logStateTransition(log: TransactionLog, newState: TransactionState, slot: number): void {
    const entry = log.history.find(h => h.state === newState) ?? log.history[log.history.length - 1];
    
    const structuredLog = {
      timestamp: entry.timestamp,
      level: 'INFO',
      event: 'state_transition',
      transaction: {
        id: log.id,
        recipient: log.recipient,
        amount: log.amount,
        signature: log.signature,
        currentState: newState,
        tipAmount: log.tipAmount
      },
      network: {
        slot,
        latencyDeltaMs: entry.latencyDeltaMs,
        totalLatencyMs: log.totalLatencyMs
      }
    };

    if (newState === 'FAILED') {
      const errorLog = {
        ...structuredLog,
        level: 'ERROR',
        event: 'execution_failure',
        failureClassification: log.failureReason
      };
      console.log(JSON.stringify(errorLog));
    } else {
      console.log(JSON.stringify(structuredLog));
    }
  }

  /**
   * Helper to print active metrics summary
   */
  public static logSystemMetrics(metrics: any): void {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      event: 'system_metrics_update',
      metrics
    }));
  }
}
