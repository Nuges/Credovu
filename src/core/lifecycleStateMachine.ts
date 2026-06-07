import { TransactionLog, TransactionState, StateHistoryEntry, FailureClassification, LeaderType } from '../types';

export class LifecycleStateMachine {
  
  /**
   * Initializes a transaction log record with audit fields
   */
  public static createLog(
    id: string,
    recipient: string,
    amount: number,
    aiDecisionId: string | null = null
  ): TransactionLog {
    const now = new Date().toISOString();
    
    const initialHistory: StateHistoryEntry = {
      state: 'CREATED',
      timestamp: now,
      slot: 0,
      latencyDeltaMs: 0
    };

    return {
      id,
      recipient,
      amount,
      signature: null,
      history: [initialHistory],
      currentState: 'CREATED',
      tipAmount: 0,
      
      // Extended Jito & streaming metadata
      slot_at_submission: null,
      leader_type: null,
      bundle_id: null,
      
      // Retry metrics
      retry_attempt_count: 0,
      failure_type: null,
      failureReason: null, // compatibility
      
      // Latency phase deltas
      processed_to_confirmed_delta_ms: null,
      confirmed_to_finalized_delta_ms: null,
      totalLatencyMs: 0,
      
      // Deterministic trace keys
      seed_transaction_id: id,
      deterministic_slot_simulation_seed: 250000000, // starting slot offset seed
      failure_injection_trace_id: null,
      aiDecisionId
    };
  }

  /**
   * Transitions a transaction log to a new state, calculating transition latencies and phase deltas
   */
  public static transitionTo(
    log: TransactionLog,
    newState: TransactionState,
    slot: number,
    failureReason: FailureClassification | null = null
  ): TransactionLog {
    const nowStr = new Date().toISOString();
    const now = new Date(nowStr).getTime();
    
    // Find the timestamp of the last state
    const previousEntry = log.history[log.history.length - 1];
    const previousTime = new Date(previousEntry.timestamp).getTime();
    const delta = now - previousTime;

    const newEntry: StateHistoryEntry = {
      state: newState,
      timestamp: nowStr,
      slot,
      latencyDeltaMs: delta
    };

    const updatedLog: TransactionLog = {
      ...log,
      currentState: newState,
      history: [...log.history, newEntry]
    };

    // Populate slot and timestamp structures
    if (newState === 'SUBMITTED') {
      updatedLog.slot_at_submission = slot;
      updatedLog.submitted_slot = slot;
      updatedLog.slotSubmitted = slot; // compatibility
    } else if (newState === 'PROCESSED') {
      updatedLog.processedAt = nowStr;
      updatedLog.processed_slot = slot;
    } else if (newState === 'CONFIRMED') {
      updatedLog.confirmedAt = nowStr;
      updatedLog.confirmed_slot = slot;
      
      // Calculate processed -> confirmed phase delta
      const processedTime = log.history.find(h => h.state === 'PROCESSED')?.timestamp;
      if (processedTime) {
        updatedLog.processed_to_confirmed_delta_ms = now - new Date(processedTime).getTime();
      }
    } else if (newState === 'FINALIZED') {
      updatedLog.finalizedAt = nowStr;
      updatedLog.finalized_slot = slot;
      
      // Calculate confirmed -> finalized phase delta
      const confirmedTime = log.history.find(h => h.state === 'CONFIRMED')?.timestamp;
      if (confirmedTime) {
        updatedLog.confirmed_to_finalized_delta_ms = now - new Date(confirmedTime).getTime();
      }
      
      // Calculate total execution latency from submission
      const submissionTime = log.history.find(h => h.state === 'SUBMITTED')?.timestamp || log.history[0].timestamp;
      updatedLog.totalLatencyMs = now - new Date(submissionTime).getTime();
    } else if (newState === 'FAILED') {
      updatedLog.failure_type = failureReason;
      updatedLog.failureReason = failureReason; // compatibility
      
      const submissionTime = log.history.find(h => h.state === 'SUBMITTED')?.timestamp || log.history[0].timestamp;
      updatedLog.totalLatencyMs = now - new Date(submissionTime).getTime();
    }

    return updatedLog;
  }
}
