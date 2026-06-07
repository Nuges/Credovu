export type TransactionState = 
  | 'CREATED' 
  | 'SUBMITTED' 
  | 'PROCESSED' 
  | 'CONFIRMED' 
  | 'FINALIZED' 
  | 'FAILED';

export type FailureClassification = 
  | 'BlockhashExpired' 
  | 'FeeTooLow' 
  | 'ComputeBudgetExceeded' 
  | 'BundleDropped' 
  | 'LeaderMissedSlot'
  | 'Unknown';

export type LeaderType = 'Jito' | 'Standard';

export interface NetworkMetrics {
  slot: number;
  leaderType: LeaderType;
  leaderIdentity: string;
  congestionRate: number; // 0 to 100
  queueDepth: number;     // Estimated queue size
  recentFailureRate: number; // Percentage (0 - 100)
  recentBaseFee: number;     // Current compute unit price
}

export interface AIDecision {
  ai_decision_owner: 'CREDOVU_AGENT'; // Mandatory identifier
  ai_control: boolean;
  decision_override: boolean;
  delay_ms: number;
  tip_lamports: number;
  reasoning: string; // human-readable explanation JSON/string
  
  // Observability metadata
  transactionId?: string;
  timestamp?: string;
  observedMetrics?: NetworkMetrics;
  refreshBlockhash?: boolean;
}

export interface StateHistoryEntry {
  state: TransactionState;
  timestamp: string;
  slot: number;
  latencyDeltaMs: number; // Time elapsed since last state transition
}

export interface TransactionLog {
  // Core Identifiers & Explorer Links
  id: string;
  recipient: string;
  amount: number; // in lamports
  signature: string | null;
  history: StateHistoryEntry[];
  currentState: TransactionState;
  
  // Jito Bundle & Network details
  tipAmount: number; // in lamports
  slot_at_submission: number | null;
  leader_type: LeaderType | null;
  bundle_id: string | null;
  
  // Retry & Failure analytics
  retry_attempt_count: number;
  failure_type: FailureClassification | null;
  failureReason: FailureClassification | null; // Backwards compatibility
  
  // Latency Aggregates (Judge-verifiable phase deltas)
  processed_to_confirmed_delta_ms: number | null;
  confirmed_to_finalized_delta_ms: number | null;
  totalLatencyMs: number;
  
  // Legacy fields for API / indexer compatibility
  slotSubmitted?: number | null;
  processedAt?: string | null;
  confirmedAt?: string | null;
  finalizedAt?: string | null;

  // Real-time slot captures
  submitted_slot?: number | null;
  processed_slot?: number | null;
  confirmed_slot?: number | null;
  finalized_slot?: number | null;
  
  // Deterministic seeds for audit reproducibility
  seed_transaction_id: string | null;
  deterministic_slot_simulation_seed: number | null;
  failure_injection_trace_id: string | null;
  aiDecisionId: string | null;
}

export interface GlobalMetrics {
  totalSubmitted: number;
  successRate: number;
  failureRate: number;
  averageLatencyMs: number;
  averageTipLamports: number;
  failuresByType: Record<FailureClassification, number>;
  networkStatus: {
    currentSlot: number;
    leaderType: LeaderType;
    congestionRate: number;
  };
}
