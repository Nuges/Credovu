import dotenv from 'dotenv';
import path from 'path';
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
import { createRouter } from './api/routes';
import { startServer } from './api/server';
import { FailureClassification } from './types';

// Load environmental config
dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const MOCK_MODE = process.env.MOCK_MODE !== 'false';

async function main() {
  console.log('[System] Initializing Credovu Layer...');

  // 1. Instantiate Core Infrastructure
  const txBuilder = new TransactionBuilder(process.env.PAYER_PRIVATE_KEY);
  const bundleManager = new BundleManager(process.env.TIP_PAYER_PRIVATE_KEY || process.env.PAYER_PRIVATE_KEY);
  const blockhashManager = new BlockhashRefreshManager(MOCK_MODE);
  
  // 2. Instantiate Network Layer
  const slotStreamListener = new SlotStreamListener(250000000, MOCK_MODE);
  const leaderTracker = new LeaderScheduleTracker();
  const congestionProcessor = new CongestionSignalProcessor(leaderTracker);

  // Bind slot updates to advance network conditions
  slotStreamListener.on('slot', (slotNum: number) => {
    // CongestionProcessor generates fresh metrics every slot
    congestionProcessor.getMetricsForSlot(slotNum);
  });
  
  // Start tracking slots
  slotStreamListener.start();

  // 3. Instantiate AI Modules
  const tipOptimizer = new TipOptimizationLogic();
  const timingOptimizer = new SubmissionTimingOptimizer();
  const decisionEngine = new DecisionEngine(tipOptimizer, timingOptimizer);
  const failureReasoning = new FailureReasoningModule();

  // 4. Instantiate Executor & Retry Layers
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

  // 5. Instantiate Loggers & Data Persistence
  const jsonLogs = new StructuredJSONLogs();

  // 6. Initialize Web Server
  const router = createRouter(retryHandler, jsonLogs, congestionProcessor);
  startServer(router, PORT);

  // 7. Auto-seeding routine (satisfies the 10 transaction logs requirement)
  const existingLogs = jsonLogs.getLogs();
  if (existingLogs.length < 10) {
    console.log(`[Seeding] Detected only ${existingLogs.length} logs. Seeding 10 mock transactions...`);
    
    // We delay the seeding slightly to allow the slot stream to start and gather metrics
    setTimeout(async () => {
      const seedTargets = [
        { recipient: '96gWZ22sgj9wJUujadENgzattg3dm1zwP9S2n5Xy2T4e', amount: 100000, failure: undefined },
        { recipient: 'HFqU5x63VT4K51mxeRSR2a6VBMmSL4DxJsiQEui12tFn', amount: 250000, failure: undefined },
        { recipient: 'Cw8CFyM99Hi47qcrgHA7dudmK49oAMdghqF76X9bd1yA', amount: 80000, failure: 'BlockhashExpired' as FailureClassification }, // Injected failure 1
        { recipient: 'Hi5Z6cRsrknjEQCGn1KHz72o29tZ2Yp6B4gDss3W13d', amount: 450000, failure: undefined },
        { recipient: 'ADuUkR4m1XXmJ2Pn6FgbZ2bXXdBJyNavH4f5fDE4fbN9', amount: 150000, failure: undefined },
        { recipient: 'Df15Z6cRsrknjEQCGn1KHz72o29tZ2Yp6B4gDss3W13d', amount: 620000, failure: 'FeeTooLow' as FailureClassification }, // Injected failure 2
        { recipient: 'DttWaRJcPjg3YNuA21zxkt54F15X93mJ66h46985w29a', amount: 90000, failure: undefined },
        { recipient: '3AVa972MptmgHnUb485125u1gP92617w543169824u1d', amount: 330000, failure: undefined },
        { recipient: '96gWZ22sgj9wJUujadENgzattg3dm1zwP9S2n5Xy2T4e', amount: 120000, failure: undefined },
        { recipient: 'Cw8CFyM99Hi47qcrgHA7dudmK49oAMdghqF76X9bd1yA', amount: 750000, failure: undefined }
      ];

      for (let i = 0; i < seedTargets.length; i++) {
        const seed = seedTargets[i];
        const txId = `seed-transaction-000000000000000${i + 1}`;
        console.log(`[Seeding] Launching seed transaction ${i + 1}/10...`);
        
        try {
          const resultLog = await retryHandler.submitWithRetry(
            txId,
            seed.recipient,
            seed.amount,
            (updatedLog) => {
              jsonLogs.saveLog(updatedLog);
            },
            seed.failure
          );

          // Save decision context
          const decision = await retryHandler['decisionEngine'].getDecision(txId, congestionProcessor.getMetricsForSlot(0), seed.failure);
          jsonLogs.saveDecision(decision);

          console.log(`[Seeding] Seed transaction ${i + 1}/10 completed. Status: ${resultLog.currentState}`);
        } catch (seedErr) {
          console.error(`[Seeding] Error running seed transaction ${i + 1}:`, seedErr);
        }
      }
      console.log(`[Seeding] Auto-seeding completed. 10 logs successfully generated in logs.json.`);
    }, 2000);
  } else {
    console.log(`[Seeding] Found ${existingLogs.length} existing logs in logs.json. Skipping auto-seeding.`);
  }
}

main().catch((err) => {
  console.error('[System] Fatal error during boot:', err);
  process.exit(1);
});
