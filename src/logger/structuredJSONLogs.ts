import fs from 'fs';
import path from 'path';
import { TransactionLog, AIDecision } from '../types';

export class StructuredJSONLogs {
  private logsFilePath: string;
  private decisionsFilePath: string;

  constructor(baseDir: string = path.join(__dirname, '../../')) {
    this.logsFilePath = path.join(baseDir, 'logs.json');
    this.decisionsFilePath = path.join(baseDir, 'decisions.json');
    this.ensureFilesExist();
  }

  private ensureFilesExist(): void {
    if (!fs.existsSync(this.logsFilePath)) {
      fs.writeFileSync(this.logsFilePath, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(this.decisionsFilePath)) {
      fs.writeFileSync(this.decisionsFilePath, JSON.stringify({}, null, 2));
    }
  }

  /**
   * Reads all transaction logs from file
   */
  public getLogs(): TransactionLog[] {
    try {
      this.ensureFilesExist();
      const data = fs.readFileSync(this.logsFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.error('[StructuredJSONLogs] Error reading logs file:', err);
      return [];
    }
  }

  /**
   * Saves or updates a transaction log, injecting compact keys
   */
  public saveLog(log: TransactionLog): void {
    try {
      this.ensureFilesExist();
      const logs = this.getLogs();

      const confirmed_slot = log.history.find(h => h.state === 'CONFIRMED')?.slot || null;
      const finalized_slot = log.history.find(h => h.state === 'FINALIZED')?.slot || null;

      // Enriched payload with mandatory keys
      const enrichedLog = {
        ...log,
        txId: log.id,
        signature: log.signature,
        submitted_slot: log.slot_at_submission,
        confirmed_slot,
        finalized_slot,
        latency_ms: log.totalLatencyMs,
        tip: log.tipAmount,
        failure_type: log.failure_type
      };

      const index = logs.findIndex((l) => l.id === log.id);

      if (index >= 0) {
        logs[index] = enrichedLog as any;
      } else {
        logs.push(enrichedLog as any);
      }

      fs.writeFileSync(this.logsFilePath, JSON.stringify(logs, null, 2));
    } catch (err) {
      console.error('[StructuredJSONLogs] Error writing log:', err);
    }
  }

  /**
   * Fetches a specific transaction log by ID
   */
  public getLogById(id: string): TransactionLog | null {
    const logs = this.getLogs();
    return logs.find((l) => l.id === id) || null;
  }

  /**
   * Saves an AI decision to decisions.json
   */
  public saveDecision(decision: AIDecision): void {
    try {
      this.ensureFilesExist();
      const data = fs.readFileSync(this.decisionsFilePath, 'utf-8');
      const decisions = JSON.parse(data);
      
      const txId = decision.transactionId || 'unknown_tx';
      decisions[txId] = decision;
      
      fs.writeFileSync(this.decisionsFilePath, JSON.stringify(decisions, null, 2));
    } catch (err) {
      console.error('[StructuredJSONLogs] Error writing AI decision:', err);
    }
  }

  /**
   * Fetches decision reasoning by transaction ID
   */
  public getDecisionByTxId(txId: string): AIDecision | null {
    try {
      this.ensureFilesExist();
      const data = fs.readFileSync(this.decisionsFilePath, 'utf-8');
      const decisions = JSON.parse(data);
      return decisions[txId] || null;
    } catch (err) {
      console.error('[StructuredJSONLogs] Error fetching AI decision:', err);
      return null;
    }
  }
}
