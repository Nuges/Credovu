import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RetryHandler } from '../executor/retryHandler';
import { StructuredJSONLogs } from '../logger/structuredJSONLogs';
import { CongestionSignalProcessor } from '../network/congestionSignalProcessor';
import { FailureClassification, GlobalMetrics } from '../types';
import { LifecycleLogger } from '../logger/lifecycleLogger';

export function createRouter(
  retryHandler: RetryHandler,
  jsonLogs: StructuredJSONLogs,
  congestionProcessor: CongestionSignalProcessor
): Router {
  const router = Router();

  /**
   * POST /transaction/submit
   * Submits a transaction with full timing and fee optimizations
   */
  router.post('/transaction/submit', async (req: Request, res: Response) => {
    const { recipient, amount } = req.body;

    if (!recipient || typeof amount !== 'number') {
      res.status(400).json({ error: 'Missing parameters: recipient address or amount' });
      return;
    }

    try {
      const txId = uuidv4();
      console.log(`[API] Received transaction submission ${txId} for ${amount} lamports`);

      // Execute submission with retry logic
      const resultLog = await retryHandler.submitWithRetry(
        txId,
        recipient,
        amount,
        (updatedLog) => {
          jsonLogs.saveLog(updatedLog);
          // Log state changes to stdout
          const lastEntry = updatedLog.history[updatedLog.history.length - 1];
          LifecycleLogger.logStateTransition(updatedLog, lastEntry.state, lastEntry.slot);
        }
      );

      // Cache decision mapping
      const decision = await retryHandler['decisionEngine'].getDecision(txId, congestionProcessor.getMetricsForSlot(0));
      jsonLogs.saveDecision(decision);

      res.status(202).json({
        message: 'Transaction submission sequence completed',
        transactionId: txId,
        currentState: resultLog.currentState,
        signature: resultLog.signature,
        tipAmount: resultLog.tipAmount,
        totalLatencyMs: resultLog.totalLatencyMs,
        history: resultLog.history
      });
    } catch (err: any) {
      console.error('[API] Error submitting transaction:', err);
      res.status(500).json({ error: 'Internal transaction processor failure', details: err.message });
    }
  });

  /**
   * POST /transaction/simulate-failure
   * Triggers a mock pipeline transaction which fails with an injected error
   */
  router.post('/transaction/simulate-failure', async (req: Request, res: Response) => {
    const { failureType, recipient, amount } = req.body;

    if (!failureType) {
      res.status(400).json({ error: 'Missing required body key: failureType' });
      return;
    }

    const testRecipient = (recipient && recipient.trim().length > 0) ? recipient : 'Cw8CFyM99Hi47qcrgHA7dudmK49oAMdghqF76X9bd1yA';
    const testAmount = amount ?? 50000;

    try {
      const txId = uuidv4();
      console.log(`[API] Simulating failure: ${failureType} for transaction ${txId}`);

      const resultLog = await retryHandler.submitWithRetry(
        txId,
        testRecipient,
        testAmount,
        (updatedLog) => {
          jsonLogs.saveLog(updatedLog);
          const lastEntry = updatedLog.history[updatedLog.history.length - 1];
          LifecycleLogger.logStateTransition(updatedLog, lastEntry.state, lastEntry.slot);
        },
        failureType as FailureClassification
      );

      // Save the decision under simulated environment
      const decision = await retryHandler['decisionEngine'].getDecision(txId, congestionProcessor.getMetricsForSlot(0), failureType);
      jsonLogs.saveDecision(decision);

      res.status(202).json({
        message: 'Simulation sequence completed',
        transactionId: txId,
        currentState: resultLog.currentState,
        injectedFailure: failureType,
        settlementStatus: resultLog.currentState === 'FINALIZED' ? 'RESOLVED_WITH_RETRY' : 'UNRESOLVED',
        history: resultLog.history,
        totalLatencyMs: resultLog.totalLatencyMs
      });
    } catch (err: any) {
      console.error('[API] Error in failure simulator:', err);
      res.status(500).json({ error: 'Simulation engine error', details: err.message });
    }
  });

  /**
   * GET /transaction/:id/log
   * Fetches lifecycle log mapping
   */
  router.get('/transaction/:id/log', (req: Request, res: Response) => {
    const { id } = req.params;
    const log = jsonLogs.getLogById(id);

    if (!log) {
      res.status(404).json({ error: `Transaction log with ID ${id} not found` });
      return;
    }

    res.json(log);
  });

  /**
   * GET /ai/decision/:id
   * Fetches structured reasoning JSON for a transaction
   */
  router.get('/ai/decision/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const decision = jsonLogs.getDecisionByTxId(id);

    if (!decision) {
      res.status(404).json({ error: `AI Decision metadata for transaction ID ${id} not found` });
      return;
    }

    res.json(decision);
  });

  /**
   * GET /metrics/dashboard
   * Returns aggregated statistics
   */
  router.get('/metrics/dashboard', (req: Request, res: Response) => {
    const logs = jsonLogs.getLogs();
    const currentMetrics = congestionProcessor.getMetricsForSlot(congestionProcessor.getMetricsForSlot(0).slot);

    const totalSubmitted = logs.length;
    const finalizedLogs = logs.filter(l => l.currentState === 'FINALIZED');
    const failedLogs = logs.filter(l => l.currentState === 'FAILED');

    const successRate = totalSubmitted > 0 ? (finalizedLogs.length / totalSubmitted) * 100 : 0;
    const failureRate = totalSubmitted > 0 ? (failedLogs.length / totalSubmitted) * 100 : 0;

    let totalLatency = 0;
    let latencyCount = 0;
    logs.forEach(l => {
      if (l.totalLatencyMs > 0) {
        totalLatency += l.totalLatencyMs;
        latencyCount++;
      }
    });

    const averageLatencyMs = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;
    const averageTipLamports = totalSubmitted > 0 
      ? Math.round(logs.reduce((sum, l) => sum + l.tipAmount, 0) / totalSubmitted)
      : 0;

    const failuresByType: Record<FailureClassification, number> = {
      BlockhashExpired: 0,
      FeeTooLow: 0,
      ComputeBudgetExceeded: 0,
      BundleDropped: 0,
      LeaderMissedSlot: 0,
      Unknown: 0
    };

    logs.forEach(l => {
      if (l.failureReason && failuresByType[l.failureReason] !== undefined) {
        failuresByType[l.failureReason]++;
      }
    });

    const dashboardMetrics: GlobalMetrics = {
      totalSubmitted,
      successRate: Math.round(successRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      averageLatencyMs,
      averageTipLamports,
      failuresByType,
      networkStatus: {
        currentSlot: currentMetrics.slot,
        leaderType: currentMetrics.leaderType,
        congestionRate: currentMetrics.congestionRate
      }
    };

    res.json(dashboardMetrics);
  });

  /**
   * GET /transactions
   * Returns all processed transaction logs
   */
  router.get('/transactions', (req: Request, res: Response) => {
    res.json(jsonLogs.getLogs());
  });

  return router;
}
