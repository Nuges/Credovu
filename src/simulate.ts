import dotenv from 'dotenv';
// Load config first
dotenv.config();

// Parse --real CLI flag before creating DI containers
const isRealMode = process.argv.includes('--real');
if (isRealMode) {
  process.env.MOCK_MODE = 'false';
}

import { SlotStreamListener } from './network/slotStreamListener';
import { LeaderScheduleTracker } from './network/leaderScheduleTracker';
import { CongestionSignalProcessor } from './network/congestionSignalProcessor';
import { TransactionBuilder } from './core/transactionBuilder';
import { BundleManager } from './core/bundleManager';
import { BlockhashRefreshManager } from './executor/blockhashRefreshManager';
import { TipOptimizationLogic } from './ai/tipOptimizationLogic';
import { SubmissionTimingOptimizer } from './ai/submissionTimingOptimizer';
import { DecisionEngine } from './ai/decisionEngine';
import { JitoBundleExecutor } from './executor/jitoBundleExecutor';
import { FailureReasoningModule } from './ai/failureReasoningModule';
import { RetryHandler } from './executor/retryHandler';
import { StructuredJSONLogs } from './logger/structuredJSONLogs';
import { FailureClassification, TransactionLog } from './types';

const MOCK_MODE = process.env.MOCK_MODE !== 'false';

async function simulate() {
  console.log(`====================================================================`);
  console.log(`  CREDOVU — Settlement Reliability Layer Simulation Demo`);
  console.log(`  Execution Mode: ${MOCK_MODE ? 'SIMULATION (MOCK)' : 'REAL SOLANA DEVNET'}`);
  console.log(`====================================================================\n`);

  // 1. Setup DI containers
  const txBuilder = new TransactionBuilder(process.env.PAYER_PRIVATE_KEY);
  const bundleManager = new BundleManager(process.env.TIP_PAYER_PRIVATE_KEY || process.env.PAYER_PRIVATE_KEY);
  const blockhashManager = new BlockhashRefreshManager(MOCK_MODE);
  
  const slotStreamListener = new SlotStreamListener(250000000, MOCK_MODE);
  const leaderTracker = new LeaderScheduleTracker();
  const congestionProcessor = new CongestionSignalProcessor(leaderTracker);

  // Bind slot ticks
  slotStreamListener.on('slot', (slotNum: number) => {
    congestionProcessor.getMetricsForSlot(slotNum);
  });
  
  await slotStreamListener.start();

  const tipOptimizer = new TipOptimizationLogic();
  const timingOptimizer = new SubmissionTimingOptimizer();
  const decisionEngine = new DecisionEngine(tipOptimizer, timingOptimizer);
  const failureReasoning = new FailureReasoningModule();

  const executor = new JitoBundleExecutor(MOCK_MODE);
  const retryHandler = new RetryHandler(
    txBuilder,
    bundleManager,
    blockhashManager,
    decisionEngine,
    congestionProcessor,
    executor,
    failureReasoning
  );

  const jsonLogs = new StructuredJSONLogs();

  // Define 10 test transactions
  // In real mode, we use valid base58 recipient keys and send small SOL transfers (e.g. 50,000 lamports = 0.00005 SOL)
  const testTxs = [
    { recipient: '96gWZ22sgj9wJUujadENgzattg3dm1zwP9S2n5Xy2T4e', amount: 1000000, failure: undefined },
    { recipient: 'HFqU5x63VT4K51mxeRSR2a6VBMmSL4DxJsiQEui12tFn', amount: 1000000, failure: undefined },
    { recipient: 'Cw8CFyM99Hi47qcrgHA7dudmK49oAMdghqF76X9bd1yA', amount: 1000000, failure: 'BlockhashExpired' as FailureClassification }, // Injected failure 1
    { recipient: 'Hi5Z6cRsrknjEQCGn1KHz72o29tZ2Yp6B4gDss3W13d', amount: 1000000, failure: undefined },
    { recipient: 'ADuUkR4m1XXmJ2Pn6FgbZ2bXXdBJyNavH4f5fDE4fbN9', amount: 1000000, failure: undefined },
    { recipient: 'Df15Z6cRsrknjEQCGn1KHz72o29tZ2Yp6B4gDss3W13d', amount: 1000000, failure: 'FeeTooLow' as FailureClassification }, // Injected failure 2
    { recipient: 'DttWaRJcPjg3YNuA21zxkt54F15X93mJ66h46985w29a', amount: 1000000, failure: undefined },
    { recipient: '3AVa972MptmgHnUb485125u1gP92617w543169824u1d', amount: 1000000, failure: undefined },
    { recipient: '96gWZ22sgj9wJUujadENgzattg3dm1zwP9S2n5Xy2T4e', amount: 1000000, failure: undefined },
    { recipient: 'Cw8CFyM99Hi47qcrgHA7dudmK49oAMdghqF76X9bd1yA', amount: 1000000, failure: undefined }
  ];

  // Run transactions sequentially to print clean logs
  for (let i = 0; i < testTxs.length; i++) {
    const seed = testTxs[i];
    const txId = `sim-transaction-000000000000000${i + 1}`;
    
    console.log(`\n--------------------------------------------------------------------`);
    console.log(`[SIM] Starting Transaction ${i + 1}/10: ${txId}`);
    console.log(`[SIM] Recipient: ${seed.recipient} | Amount: ${seed.amount} lamports`);
    if (seed.failure) {
      console.log(`[SIM] Injected Failure Target: ${seed.failure}`);
    }
    console.log(`--------------------------------------------------------------------`);

    // Fetch metrics before submission to display AI observation context
    const currentSlot = slotStreamListener.getCurrentSlot();
    const metrics = congestionProcessor.getMetricsForSlot(currentSlot);

    // Get the AI Decision using our optimized engine
    const aiDecision = await decisionEngine.getDecision(txId, metrics, seed.failure);
    
    console.log(`\n[AI Decision Engine Output]:`);
    console.log(JSON.stringify({
      ai_control: aiDecision.ai_control,
      decision_override: aiDecision.decision_override,
      delay_ms: aiDecision.delay_ms,
      tip_lamports: aiDecision.tip_lamports,
      reasoning: aiDecision.reasoning
    }, null, 2));

    // Persist AI decision
    jsonLogs.saveDecision(aiDecision);

    // Execute with RetryHandler and log lifecycle progressions
    const finalizedLog = await retryHandler.submitWithRetry(
      txId,
      seed.recipient,
      seed.amount,
      (updatedLog: TransactionLog) => {
        // Persist to logs.json
        jsonLogs.saveLog(updatedLog);

        // Print lifecycle progressions to console
        const lastTransition = updatedLog.history[updatedLog.history.length - 1];
        console.log(`  └─> [Lifecycle State] ${lastTransition.state} | slot: ${lastTransition.slot} | delta: ${lastTransition.latencyDeltaMs}ms`);
      },
      seed.failure
    );

    console.log(`\n[SIM] Transaction ${i + 1}/10 Completed. Settlement State: ${finalizedLog.currentState}`);
  }

  // Shut down slot updates
  await slotStreamListener.stop();

  // Print ending dashboard metrics
  const finalLogs = jsonLogs.getLogs();
  const total = finalLogs.length;
  const finalized = finalLogs.filter(l => l.currentState === 'FINALIZED').length;
  const failed = finalLogs.filter(l => l.currentState === 'FAILED').length;
  const averageTip = total > 0 ? Math.round(finalLogs.reduce((s, l) => s + l.tipAmount, 0) / total) : 0;
  
  console.log(`\n====================================================================`);
  console.log(`  SIMULATION DASHBOARD METRICS SUMMARY`);
  console.log(`====================================================================`);
  console.log(`  Total Transactions Processed : ${total}`);
  console.log(`  Settlement Success Rate      : ${((finalized / total) * 100).toFixed(2)}%`);
  console.log(`  Settlement Failure Rate      : ${((failed / total) * 100).toFixed(2)}%`);
  console.log(`  Average Jito Tip Applied     : ${averageTip} lamports`);
  console.log(`  Failures Classifications     : BlockhashExpired=1, FeeTooLow=1`);
  console.log(`====================================================================\n`);
  
  process.exit(0);
}

simulate().catch((err) => {
  console.error('[SIM ERROR] Simulation crashed:', err);
  process.exit(1);
});
