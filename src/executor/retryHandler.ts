import { FailureReasoningModule, RecoveryAction } from '../ai/failureReasoningModule';
import { JitoBundleExecutor } from './jitoBundleExecutor';
import { BundleManager } from '../core/bundleManager';
import { BlockhashRefreshManager } from './blockhashRefreshManager';
import { DecisionEngine } from '../ai/decisionEngine';
import { CongestionSignalProcessor } from '../network/congestionSignalProcessor';
import { TransactionBuilder } from '../core/transactionBuilder';
import { LifecycleStateMachine } from '../core/lifecycleStateMachine';
import { TransactionLog, FailureClassification, TransactionState } from '../types';

export class RetryHandler {
  private txBuilder: TransactionBuilder;
  private bundleManager: BundleManager;
  private blockhashManager: BlockhashRefreshManager;
  private decisionEngine: DecisionEngine;
  private congestionProcessor: CongestionSignalProcessor;
  private executor: JitoBundleExecutor;
  private failureReasoning: FailureReasoningModule;

  private maxRetries = 3;

  constructor(
    txBuilder: TransactionBuilder,
    bundleManager: BundleManager,
    blockhashManager: BlockhashRefreshManager,
    decisionEngine: DecisionEngine,
    congestionProcessor: CongestionSignalProcessor,
    executor: JitoBundleExecutor,
    failureReasoning: FailureReasoningModule
  ) {
    this.txBuilder = txBuilder;
    this.bundleManager = bundleManager;
    this.blockhashManager = blockhashManager;
    this.decisionEngine = decisionEngine;
    this.congestionProcessor = congestionProcessor;
    this.executor = executor;
    this.failureReasoning = failureReasoning;
  }

  /**
   * Submits a transaction with full end-to-end AI optimization and failure handling retries
   */
  public async submitWithRetry(
    txId: string,
    recipient: string,
    amount: number,
    logStateCallback: (log: TransactionLog) => void,
    forceFailureType?: FailureClassification
  ): Promise<TransactionLog> {
    let currentLog = LifecycleStateMachine.createLog(txId, recipient, amount);
    logStateCallback(currentLog);

    let attempt = 0;
    let activeFailure = forceFailureType;
    let forceRefreshBlockhash = false;
    let tipOverrideLamports: number | null = null;
    let delayOverrideMs: number | null = null;

    while (attempt <= this.maxRetries) {
      if (attempt > 0) {
        console.log(`[RetryHandler] Retry attempt ${attempt}/${this.maxRetries} for transaction ${txId}`);
      }

      // 1. Fetch current network metrics
      const currentSlot = this.congestionProcessor.getMetricsForSlot(this.congestionProcessor.getMetricsForSlot(0).slot);
      const metrics = this.congestionProcessor.getMetricsForSlot(currentSlot.slot);

      // 2. Fetch blockhash
      const recentBlockhash = await this.blockhashManager.getRecentBlockhash(metrics.slot, forceRefreshBlockhash);
      forceRefreshBlockhash = false; // Reset refresh flag

      // 3. Consult AI Decision Engine
      const decision = await this.decisionEngine.getDecision(txId, metrics, activeFailure);
      currentLog.aiDecisionId = txId + `_decision_attempt_${attempt}`;
      
      // Update tip amount and schedule delays from AI schema
      let targetTip = tipOverrideLamports ?? decision.tip_lamports;
      let targetDelay = delayOverrideMs ?? decision.delay_ms;

      // Apply action plan
      if (decision.refreshBlockhash) {
        forceRefreshBlockhash = true;
      }

      // Save decision metadata to logger state or callbacks
      currentLog.tipAmount = targetTip;
      currentLog.leader_type = metrics.leaderType;
      currentLog.retry_attempt_count = attempt;
      currentLog.deterministic_slot_simulation_seed = metrics.slot;
      if (activeFailure) {
        currentLog.failure_injection_trace_id = `trace-inject-${activeFailure}-${txId}`;
      }

      // Transition to SUBMITTED state
      currentLog = LifecycleStateMachine.transitionTo(currentLog, 'SUBMITTED', metrics.slot);
      logStateCallback(currentLog);

      // Execute delay if recommended by AI
      if (targetDelay > 0) {
        console.log(`[RetryHandler] AI recommended timing delay: Waiting ${targetDelay}ms before executor launch...`);
        await new Promise(resolve => setTimeout(resolve, targetDelay));
      }

      // Determine priority fee (escalates on retry)
      let microLamports = metrics.recentBaseFee * 2;
      if (activeFailure === 'FeeTooLow') {
        microLamports = 1; // force minimal priority fee
      } else if (attempt > 0) {
        microLamports = Math.round(microLamports * 2.5); // escalate priority fee on retry
      }

      // Real Mode Failure Injection: Sleep to age the blockhash
      if (activeFailure === 'BlockhashExpired' && !this.executor['mockMode'] && attempt === 0) {
        console.warn(`[RetryHandler] REAL MODE: Delaying submission by 75 seconds to age blockhash and force expiration...`);
        await new Promise(resolve => setTimeout(resolve, 75000));
      }

      // 4. Build transaction & bundle
      const userTx = this.txBuilder.buildTransferTx(recipient, amount, recentBlockhash, 200000, microLamports);
      const bundle = this.bundleManager.createBundle([userTx], targetTip, recentBlockhash);
      currentLog.signature = bundle.signatures[0];
      currentLog.bundle_id = bundle.signatures[0];

      // 5. Execute Jito Bundle (or raw Solana transaction in Real Mode)
      console.log(`[RetryHandler] Executing transaction with signature ${currentLog.signature} at slot ${metrics.slot}`);
      
      const executionResult = await this.executor.executeBundle(
        bundle,
        metrics.slot,
        attempt === 0 ? activeFailure : undefined // trigger injected failure only on attempt 0
      );

      // 6. Evaluate execution outcome
      if (executionResult.state === 'FINALIZED' || executionResult.state === 'PROCESSED') {
        // Happy Path!
        this.congestionProcessor.recordOutcome(true);
        
        const procSlot = executionResult.processed_slot ?? executionResult.slot;
        const confSlot = executionResult.confirmed_slot ?? (procSlot + 1);
        const finSlot = executionResult.finalized_slot ?? (confSlot + 1);

        currentLog = LifecycleStateMachine.transitionTo(currentLog, 'PROCESSED', procSlot);
        logStateCallback(currentLog);
        
        currentLog = LifecycleStateMachine.transitionTo(currentLog, 'CONFIRMED', confSlot);
        logStateCallback(currentLog);

        currentLog = LifecycleStateMachine.transitionTo(currentLog, 'FINALIZED', finSlot);
        logStateCallback(currentLog);

        console.log(`[RetryHandler] Transaction ${txId} successfully settled in slot ${finSlot}!`);
        return currentLog;
      } else {
        // Transaction Failed
        const failureType = executionResult.error ?? 'Unknown';
        this.congestionProcessor.recordOutcome(false);
        
        currentLog = LifecycleStateMachine.transitionTo(currentLog, 'FAILED', executionResult.slot, failureType);
        logStateCallback(currentLog);

        attempt += 1;
        if (attempt > this.maxRetries) {
          console.error(`[RetryHandler] Max retries reached for transaction ${txId}. Settlement failed.`);
          return currentLog;
        }

        // Consult failure reasoning module to set overrides for next attempt
        const recovery: RecoveryAction = this.failureReasoning.reasonAboutFailure(failureType, metrics);
        console.warn(`[RetryHandler] AI Failure Recovery plan: ${recovery.description}`);
        
        if (recovery.actionRequired === 'REFRESH_BLOCKHASH') {
          forceRefreshBlockhash = true;
        } else if (recovery.actionRequired === 'BOOST_TIP') {
          tipOverrideLamports = Math.round(targetTip * recovery.tipMultiplier);
        } else if (recovery.actionRequired === 'RE_ESTIMATE_CU') {
          tipOverrideLamports = Math.round(targetTip * recovery.tipMultiplier);
        }
        
        // Apply recovery delay
        delayOverrideMs = recovery.delayOverrideMs;
        
        // Clear active failure trigger so retry succeeds
        activeFailure = undefined;
      }
    }

    return currentLog;
  }
}
