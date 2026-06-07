import { JitoBundle, callJitoRpc } from '../core/bundleManager';
import { TransactionState, FailureClassification } from '../types';
import { solanaConnection } from '../network/solanaConnection';
import { FailureClassificationSystem } from '../logger/failureClassificationSystem';
import bs58 from 'bs58';

export interface ExecutionResult {
  signature: string;
  state: TransactionState;
  slot: number;
  processed_slot?: number;
  confirmed_slot?: number;
  finalized_slot?: number;
  error?: FailureClassification;
}

export class JitoBundleExecutor {
  private mockMode: boolean;

  constructor(mockMode: boolean = true) {
    this.mockMode = mockMode;
  }

  /**
   * Executes a bundle by sending it to the Solana network (or Jito block engine)
   * @param bundle JitoBundle structure
   * @param targetSlot Slot we aim to land in
   * @param forceFailure Optional failure to inject for simulations
   */
  public async executeBundle(
    bundle: JitoBundle,
    targetSlot: number,
    forceFailure?: FailureClassification
  ): Promise<ExecutionResult> {
    const mainSignature = bundle.signatures[0] || 'mock_sig_' + Math.random().toString(36).substring(7);

    if (this.mockMode) {
      // Simulate async execution lifecycle delays
      return new Promise((resolve) => {
        const delay = forceFailure ? 200 : 400; // Fast failure simulation vs standard confirmation path

        setTimeout(() => {
          if (forceFailure) {
            console.warn(`[JitoExecutor] Injected mock failure triggered: ${forceFailure} on signature: ${mainSignature}`);
            resolve({
              signature: mainSignature,
              state: 'FAILED',
              slot: targetSlot + 1,
              error: forceFailure,
            });
            return;
          }

          // Standard happy path
          resolve({
            signature: mainSignature,
            state: 'FINALIZED',
            slot: targetSlot + 2,
            processed_slot: targetSlot + 1,
            confirmed_slot: targetSlot + 2,
            finalized_slot: targetSlot + 3
          });
        }, delay);
      });
    }

    // Real Execution Path
    console.log(`[JitoExecutor] REAL MODE: Preparing Jito bundle routing...`);
    let signature = '';
    try {
      try {
        console.log(`[JitoExecutor] Submitting Jito bundle (transactions: ${bundle.transactions.length}) directly to Block Engine...`);
        // Serialize all transactions in the bundle to base64
        const serializedTxs = bundle.transactions.map((tx) => tx.serialize().toString('base64'));
        
        // Dispatch to Jito Block Engine endpoint
        const bundleId = await callJitoRpc('sendBundle', [serializedTxs, { encoding: 'base64' }]);
        console.log(`[JitoExecutor] Bundle successfully accepted by Jito. Bundle ID/Signature: ${bundleId}`);
        signature = bundleId;
      } catch (jitoErr: any) {
        console.warn(`[JitoExecutor] Jito Block Engine submission failed, falling back to standard Solana RPC mempool. Error:`, jitoErr.message || jitoErr);
        
        // Fallback: Submit only the user transaction to Solana RPC node
        const userTx = bundle.transactions[0];
        const rawTx = userTx.serialize();
        
        signature = await solanaConnection.sendRawTransaction(rawTx, {
          skipPreflight: true,
          preflightCommitment: 'processed',
        });
        console.log(`[JitoExecutor] Standard Solana RPC fallback submission complete. Signature: ${signature}`);
      }

      // We wait for optimistic confirmation (processed or confirmed) to resolve the slot
      let processedSlot = targetSlot;
      let confirmedSlot = targetSlot;
      let finalizedSlot = targetSlot;

      // 1. Confirm processed
      try {
        console.log(`[JitoExecutor] Confirming processed status for signature ${signature}...`);
        await solanaConnection.confirmTransaction(signature, 'processed');
        const statuses = await solanaConnection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        const status = statuses && statuses.value && statuses.value[0];
        if (status) {
          processedSlot = status.slot;
          if (status.err) {
            console.warn(`[JitoExecutor] Solana RPC returned execution error at processed:`, status.err);
            return {
              signature,
              state: 'FAILED',
              slot: processedSlot,
              processed_slot: processedSlot,
              error: 'Unknown'
            };
          }
        }
      } catch (err) {
        console.warn(`[JitoExecutor] Processed confirmation failed or timed out:`, err);
        throw err;
      }

      // 2. Confirm confirmed
      try {
        console.log(`[JitoExecutor] Confirming confirmed status for signature ${signature}...`);
        await solanaConnection.confirmTransaction(signature, 'confirmed');
        const statuses = await solanaConnection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        const status = statuses && statuses.value && statuses.value[0];
        if (status) {
          confirmedSlot = status.slot;
          if (status.err) {
            console.warn(`[JitoExecutor] Solana RPC returned execution error at confirmed:`, status.err);
            return {
              signature,
              state: 'FAILED',
              slot: confirmedSlot,
              processed_slot: processedSlot,
              confirmed_slot: confirmedSlot,
              error: 'Unknown'
            };
          }
        }
      } catch (err) {
        console.warn(`[JitoExecutor] Confirmed confirmation failed or timed out:`, err);
        confirmedSlot = processedSlot;
      }

      // 3. Confirm finalized
      try {
        console.log(`[JitoExecutor] Confirming finalized status for signature ${signature}...`);
        await solanaConnection.confirmTransaction(signature, 'finalized');
        const statuses = await solanaConnection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        const status = statuses && statuses.value && statuses.value[0];
        if (status) {
          finalizedSlot = status.slot;
          if (status.err) {
            console.warn(`[JitoExecutor] Solana RPC returned execution error at finalized:`, status.err);
            return {
              signature,
              state: 'FAILED',
              slot: finalizedSlot,
              processed_slot: processedSlot,
              confirmed_slot: confirmedSlot,
              finalized_slot: finalizedSlot,
              error: 'Unknown'
            };
          }
        }
      } catch (err) {
        console.warn(`[JitoExecutor] Finalized confirmation failed or timed out:`, err);
        finalizedSlot = confirmedSlot;
      }

      return {
        signature,
        state: 'FINALIZED',
        slot: processedSlot,
        processed_slot: processedSlot,
        confirmed_slot: confirmedSlot,
        finalized_slot: finalizedSlot
      };
    } catch (err: any) {
      console.error('[JitoExecutor] Failed real transaction submission:', err);
      
      // Classify error type from exception message using robust classification system
      const failureType = FailureClassificationSystem.classify(err);

      return {
        signature: signature || 'failed_transaction_signature',
        state: 'FAILED',
        slot: targetSlot,
        error: failureType
      };
    }
  }
}
