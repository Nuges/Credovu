import https from 'https';
import { NetworkMetrics, AIDecision } from '../types';
import { TipOptimizationLogic } from './tipOptimizationLogic';
import { SubmissionTimingOptimizer } from './submissionTimingOptimizer';

export class DecisionEngine {
  private tipOptimizer: TipOptimizationLogic;
  private timingOptimizer: SubmissionTimingOptimizer;

  constructor(tipOptimizer: TipOptimizationLogic, timingOptimizer: SubmissionTimingOptimizer) {
    this.tipOptimizer = tipOptimizer;
    this.timingOptimizer = timingOptimizer;
  }

  /**
   * Main entry point to get AI decision for a transaction matching the operational schema
   */
  public async getDecision(
    transactionId: string,
    metrics: NetworkMetrics,
    forceFailureType?: string
  ): Promise<AIDecision> {
    const timestamp = new Date().toISOString();
    const apiKey = process.env.GEMINI_API_KEY;

    // First, calculate base optimization parameters using our mathematical models
    let tipLamports = this.tipOptimizer.calculateTip(metrics);
    let delayMs = this.timingOptimizer.calculateDelay(metrics);
    let refreshBlockhash = false;

    // Adjust parameters if simulated failure override is active
    if (forceFailureType === 'BlockhashExpired') {
      refreshBlockhash = true;
      delayMs = 0;
    } else if (forceFailureType === 'FeeTooLow') {
      tipLamports = Math.round(tipLamports * 2.5); // Drastically bump tip
    } else if (forceFailureType === 'ComputeBudgetExceeded') {
      delayMs = 200; // Small delay
    }

    let decision: Omit<AIDecision, 'ai_decision_owner' | 'ai_control' | 'decision_override'> & { refreshBlockhash?: boolean };

    if (apiKey && apiKey.trim().length > 0) {
      try {
        decision = await this.queryGeminiAI(apiKey, metrics, tipLamports, delayMs, refreshBlockhash);
      } catch (err) {
        console.warn(`[DecisionEngine] Gemini API call failed, falling back to local reasoning solver. Error:`, err);
        decision = this.solveLocally(metrics, tipLamports, delayMs, refreshBlockhash);
      }
    } else {
      decision = this.solveLocally(metrics, tipLamports, delayMs, refreshBlockhash);
    }

    // Attach metadata and mandatory owner ID
    return {
      ...decision,
      ai_decision_owner: 'CREDOVU_AGENT',
      ai_control: true,
      decision_override: true,
      transactionId,
      timestamp,
      observedMetrics: metrics
    } as AIDecision;
  }

  /**
   * Queries Google's Gemini API for structured JSON reasoning
   */
  private queryGeminiAI(
    apiKey: string,
    metrics: NetworkMetrics,
    calculatedTip: number,
    calculatedDelay: number,
    refreshBlockhash: boolean
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const model = 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const prompt = `
        You are Credovu, a high-performance Solana transaction timing and Jito bundle fee optimizer.
        Analyze the following real-time network conditions:
        - Current Slot: ${metrics.slot}
        - Leader Type: ${metrics.leaderType} (Jito is Bundle-compatible, Standard is RPC-only)
        - Leader Public Key: ${metrics.leaderIdentity}
        - Network Congestion Rate: ${metrics.congestionRate}%
        - RPC Queue Depth: ${metrics.queueDepth}
        - Recent Transaction Failure Rate: ${metrics.recentFailureRate}%
        - Current Compute Unit Base Price: ${metrics.recentBaseFee} microLamports
        
        Our base algorithms proposed:
        - Jito Tip: ${calculatedTip} lamports
        - Timing Delay: ${calculatedDelay} ms
        - Blockhash Refresh Required: ${refreshBlockhash}

        Output a single, strictly valid JSON matching the schema below.
        DO NOT include any markdown code blocks or additional explanation text outside the JSON.
        
        Schema:
        {
          "delay_ms": integer,
          "tip_lamports": integer,
          "reasoning": "human-readable explanation of why we delay, how much tip we use, and slot-leader compatibility factors"
        }
      `;

      const requestBody = JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      });

      const req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody)
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                return reject(new Error(`API responded with code ${res.statusCode}: ${data}`));
              }
              const responseJson = JSON.parse(data);
              const textResponse = responseJson.candidates[0].content.parts[0].text;
              const cleanJson = JSON.parse(textResponse.trim());
              
              resolve(cleanJson);
            } catch (err) {
              reject(err);
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.write(requestBody);
      req.end();
    });
  }

  /**
   * High-fidelity local solver using advanced probabilistic analysis and semantic generation
   */
  private solveLocally(
    metrics: NetworkMetrics,
    calculatedTip: number,
    calculatedDelay: number,
    refreshBlockhash: boolean
  ): any {
    const riskFactors: string[] = [];
    
    // Identify risk factors
    if (metrics.congestionRate > 50) {
      riskFactors.push(`High network congestion (${metrics.congestionRate}%)`);
    } else if (metrics.congestionRate > 25) {
      riskFactors.push(`Moderate network congestion (${metrics.congestionRate}%)`);
    }

    if (metrics.leaderType === 'Standard') {
      riskFactors.push(`Standard validator leader (fallback to public RPC queue necessary)`);
    }

    if (metrics.recentFailureRate > 15) {
      riskFactors.push(`Elevated validator failure rate (${metrics.recentFailureRate}%)`);
    }

    if (metrics.queueDepth > 200) {
      riskFactors.push(`Large transaction backlog (queue depth: ${metrics.queueDepth})`);
    }

    if (refreshBlockhash) {
      riskFactors.push(`Cached blockhash age exceeded limit`);
    }

    // Adjust parameters depending on congestion levels
    let finalTip = calculatedTip;
    let finalDelay = calculatedDelay;
    
    if (metrics.congestionRate > 80) {
      finalTip = Math.round(calculatedTip * 1.5);
      finalDelay = Math.max(100, calculatedDelay + 150);
    }

    // Compile human-readable reasoning explaining logic
    const slotOffset = metrics.slot % 4;
    const remainingInLeader = 4 - slotOffset;
    
    const reasoningParts = [
      `Slot offset is +${slotOffset} with ${remainingInLeader} slots remaining on active leader ${metrics.leaderIdentity.substring(0, 8)}...`,
      metrics.leaderType === 'Jito' 
        ? `Jito block engine auction is active, allowing direct bundle landing in private pools to bypass public mempool sandwich risks.`
        : `Fallback route scheduled since standard leader does not process bundles.`,
      `Congestion level is ${metrics.congestionRate}% with priority CU fees at ${metrics.recentBaseFee} microLamports.`,
      `Dynamic tip size set to ${finalTip} lamports ($${(finalTip / 1e9).toFixed(5)} SOL) to outcompete competing arb flows.`,
      finalDelay > 0
        ? `EnforcingTimingDelay of ${finalDelay}ms to target validator block ingestion windows.`
        : `Executing transaction instantly.`
    ];

    return {
      delay_ms: finalDelay,
      tip_lamports: finalTip,
      reasoning: reasoningParts.join(' '),
      refreshBlockhash
    };
  }
}
