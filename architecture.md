# CREDOVU — Solana Transaction Settlement Reliability Layer
## Comprehensive Engineering Architecture & System Design Specification

This document details the system design, communication protocols, dynamic routing policies, and AI-assisted execution controllers of **CREDOVU**, a production-grade transaction reliability middleware for the Solana blockchain.

---

## 1. Executive Summary & Design Philosophy

On Solana, transaction submission is often treated as a simple fire-and-forget RPC call. However, under high network demand, transactions face multiple consensus-level and protocol-level hurdles:
* **TPU Packet Drops**: During heavy congestion, validator transaction queues overflow, dropping packets before they are processed.
* **Block Space Competition**: Standard transactions are frequently front-run or out-bid by high-frequency MEV searcher bundles.
* **Blockhash Expiry**: Standard blockhashes are valid for only 150 slots (~60 seconds), leaving a tight window for landing under congestion.
* **Leader Schedule Drift**: Missed block production slots by validator leaders cause transaction arrays to time out in standard queues.

**Credovu** re-imagines transaction execution from a passive dispatch system into an **active operational controller**. It manages transactions through direct Jito Block Engine integrations, Yellowstone-style slot stream listeners, and an AI decision engine that dynamically determines execution timing, tip bidding, and failure recovery.

---

## 2. System Architecture & Component Diagram

The diagram below represents the modular topology of the Credovu layer, mapping the flow from real-time network telemetry ingestion to transaction execution and observability:

```
+-------------------------------------------------------------------------------------------------+
|                                  NETWORK INTELLIGENCE LAYER                                     |
|                                                                                                 |
|   +------------------------------------+          +-----------------------------------------+   |
|   |   Yellowstone Geyser gRPC Stream   | -------> |   Congestion Signal Processor           |   |
|   |   (Slot broadcasts & timings)      |          |   - Tracks queue depth & base fees      |   |
|   +------------------------------------+          |   - Evaluates slot-leader schedules     |   |
|                                                   +--------------------+--------------------+   |
+------------------------------------------------------------------------|------------------------+
                                                                         | NetworkMetrics
                                                                         v
+-------------------------------------------------------------------------------------------------+
|                                  AI DECISION & POLICY LAYER                                     |
|                                                                                                 |
|                       +---------------------------------------------------------+               |
|                       |   Decision Engine (Owner ID: CREDOVU_AGENT)             |               |
|                       |   - Evaluates landing probability bounds                |               |
|                       |   - Determines execution timing offsets (Timing Opt)     |               |
|                       |   - Sizes auction tip fees dynamically (Fee Opt)        |               |
|                       +----------------------------+----------------------------+               |
+----------------------------------------------------|--------------------------------------------+
                                                     | AIDecision JSON
                                                     v
+-------------------------------------------------------------------------------------------------+
|                                  TRANSACTION EXECUTION LAYER                                    |
|                                                                                                 |
|   +------------------------------------+          +-----------------------------------------+   |
|   |   Transaction Builder              | -------> |   Jito Bundle Manager                   |   |
|   |   - Generates transfer instructions|          |   - Packages instruction arrays         |   |
|   |   - Re-signs with fresh blockhashes|          |   - Attaches target tip instructions    |   |
|   +------------------------------------+          +--------------------+--------------------+   |
|                                                                        |                        |
|                                                                        v                        |
|   +------------------------------------+          +-----------------------------------------+   |
|   |   Blockhash Refresh Manager        | <------- |   Retry Handler & Fallback Router       |   |
|   |   - Actively monitors slot ages    |          |   - Tracks confirmation WebSocket loop  |   |
|   |   - Enforces 30-slot cache limits  |          |   - Executes fallback sendRawTransaction|   |
|   +------------------------------------+          +--------------------+--------------------+   |
+------------------------------------------------------------------------|------------------------+
                                                                         | Verify States
                                                                         v
+-------------------------------------------------------------------------------------------------+
|                                  LIFECYCLE OBSERVABILITY LAYER                                  |
|                                                                                                 |
|                       +---------------------------------------------------------+               |
|                       |   Structured JSON Logger & Metrics Dashboard            |               |
|                       |   - Writes logs.json (telemetry phase deltas)           |               |
|                       |   - Writes decisions.json (agent justifications)        |               |
|                       |   - Serves REST metrics on port 3005                    |               |
|                       +---------------------------------------------------------+               |
+-------------------------------------------------------------------------------------------------+
```

---

## 3. Core Component Specifications

### A. SlotStreamListener & LeaderScheduleTracker
* **Responsibilities**: Listens to real-time slot height increases and parses the upcoming validator leader schedule.
* **Geyser Emulation**: Maps simulated slot broadcasts to the block production schedule. It determines if the upcoming leader is bundle-compatible (e.g., Jito) or standard.

### B. CongestionSignalProcessor
* **Responsibilities**: Processes block-space queues and transaction base priority fees to create a unified network metrics load score.
* **Outputs**: Computes real-time queue depth indicators and base priority fees in microLamports.

### C. DecisionEngine
* **Responsibilities**: The core policy manager of transaction execution.
* **Execution Pathways**:
  * **Primary**: Queries the Google Gemini API (`gemini-2.0-flash`) using a JSON-constrained schema.
  * **Secondary (Fallback)**: Leverages a local Bayesian Context Engine to estimate fee floor statistics and schedule delays when API quotas are exceeded.

### D. JitoBundleExecutor & Fallback Router
* **Responsibilities**: Assembles target transaction instructions and Jito tip instructions, serializes the bundle payload, and submits it to Jito Block Engines.
* **Defensive Failover**: If Jito endpoints fail or return DNS errors (common on Devnet), it automatically splits the bundle, discards the tip instruction, and dispatches the primary transaction via standard Solana RPC `sendRawTransaction`.

---

## 4. Protocol & Direct Jito Integrations

CREDOVU bypasses public transaction mempools by integrating directly with the Jito Block Engine JSON-RPC HTTP API. It performs three critical operations:

### A. Dynamic Tip Account Resolution (`getTipAccounts`)
At startup and periodically, the system retrieves the list of active validator tip accounts directly from the Block Engine:
```json
// POST https://ny.mainnet-beta.jito.wtf/api/v1/bundles
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTipAccounts",
  "params": []
}
```
* **Response Handling**: Returns a list of base58 public keys. The `BundleManager` caches these keys and selects one at random for each transaction to avoid hotspots on specific validators.
* **Safety Fallback**: If the query fails, the system falls back to a statically configured list of verified Jito tip accounts.

### B. Live Tip Floor Estimation (`getTipFloor`)
Every 30 seconds, the fee optimizer polls the Block Engine's historical tip auctions:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTipFloor",
  "params": []
}
```
* **Stat Extraction**: Parses the response array to locate the `landed_tips_25th_percentile` and `landed_tips_50th_percentile` values. These values represent the minimum lamports required to land bundles in recent blocks.
* **Pricing Metric**: Establishes a dynamic fee baseline, eliminating hardcoded tips.

### C. Direct Bundle Dispatch (`sendBundle`)
Packages the user's transfer transaction and the tip payment transaction into a single atomic bundle:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "sendBundle",
  "params": [
    [
      "base64_serialized_user_transaction_data",
      "base64_serialized_tip_transaction_data"
    ]
  ]
}
```
* **Execution Gating**: If the Block Engine accepts the bundle, it returns a bundle signature. The executor then listens to the confirmation loop for block inclusion.
* **Standard Failover**: If the Block Engine is unreachable or throws DNS errors, the executor routes the user's primary transaction directly to standard Solana nodes, ensuring high availability.

---

## 5. Yellowstone gRPC Geyser Integration Mapping

To run without requiring private mainnet gRPC nodes, the `SlotStreamListener` simulates Geyser slot emissions using Node `EventEmitter` loops. The table below maps these simulated updates to real Yellowstone Geyser protobuf fields:

| Simulated Event Field | Credovu Mock Payload | Yellowstone gRPC Protobuf Equivalent | Description |
| :--- | :--- | :--- | :--- |
| `slot` | `number` (e.g., `250000004`) | `SubscribeUpdateSlot.slot` | Current slot height. |
| `leaderIdentity` | `string` (Validator Pubkey) | `SubscribeUpdateSlot.parent` (derived) | Public key of the validator producing the slot. |
| `timestamp` | `ISO String` | `SubscribeUpdateSlot.timestamp` | Slot processing epoch time. |
| `leaderType` | `Jito` \| `Standard` | (Derived from validator list metadata) | Indicates whether the leader accepts MEV bundle auctions. |

---

## 6. Failure Recovery Strategies

### A. Blockhash Expiration (Immediate Refresh)
* **Risk**: Transactions signed with a blockhash that is too old (e.g., during congestion) are discarded by validators.
* **Mitigation**: The `BlockhashRefreshManager` actively tracks the slot height at the time the blockhash is fetched. If the cache age exceeds 30 slots (approx. 12 seconds), or if a `BlockhashExpired` error is thrown by the validator, the system invalidates the cache, requests a new blockhash, re-signs the transaction, and bypasses any scheduled delays to guarantee immediate submission.

### B. Fee Underbidding (Dynamic Multipliers)
* **Risk**: During high-activity spikes, bundles are dropped from block engine queues due to competing searchers submitting higher tips.
* **Mitigation**: When the `FailureReasoningModule` classifies a drop as a `FeeTooLow` error, the `RetryHandler` escalates the bid by applying a `1.5x` fee multiplier to the recommended Jito tip. The transaction is re-packaged and re-submitted to capture the next block engine slot.

### C. Leader Misses (Consensus Forks)
* **Risk**: Validator nodes sometimes skip slot production blocks, causing pending bundles to expire.
* **Mitigation**: The `RetryHandler` detects missed slots by monitoring slot height jumps. When a miss occurs, the system pauses execution for `400ms - 800ms` until validator rotations shift to the next online validator.

---

## 7. AI Agent Execution Policy & Decision Schemas

The AI agent (`CREDOVU_AGENT`) has complete control over execution policies, deciding whether a transaction should be allowed into the blockspace and optimizing its landing conditions.

### A. LLM Schema Format (`gemini-2.0-flash`)
When querying the Gemini API, the system enforces a strict JSON schema via `generationConfig.responseMimeType = "application/json"`. The prompt receives real-time metrics (slot, leader, congestion rate, queue depth, recent failures, and base priority fees) and calculates the optimal parameters:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AIDecision",
  "type": "object",
  "properties": {
    "delay_ms": {
      "type": "integer",
      "description": "Milliseconds to delay submission to align with block space boundaries."
    },
    "tip_lamports": {
      "type": "integer",
      "description": "Recommended Jito validator tip payment in lamports."
    },
    "reasoning": {
      "type": "string",
      "description": "Human-readable explanation of slot-leader details, fee optimizer metrics, and congestion offsets."
    }
  },
  "required": ["delay_ms", "tip_lamports", "reasoning"]
}
```

### B. Local Bayesian Context Engine (Dynamic Fallback)
If the LLM API is rate-limited or offline, the local solver calculates execution variables mathematically:

$$\text{Congestion Factor } (C) = \frac{\text{congestionRate}}{100}$$

$$\text{Jito Tip } (T) = \max\left(\text{Baseline Tip}, \text{Dynamic Jito Floor} \times (1 + C)\right)$$

$$\text{Timing Delay } (D) = \begin{cases} 
0 & \text{if leaderType} = \text{Jito} \text{ and slotOffset} \le 1 \\
\max(50, 100 \times C) & \text{if leaderType} = \text{Standard} 
\end{cases}$$

---

## 8. Telemetry & Observability Verification

All operations write structured telemetry records to facilitate auditing:

### A. Transaction Log Schema (`logs.json`)
Tracks the lifetime of each transaction:
```json
{
  "id": "cdb1c731-069b-44e5-90fe-1706ec2bc5e8",
  "recipient": "Cw8CFyM99Hi47qcrgHA7dudmK49oAMdghqF76X9bd1yA",
  "amount": 1000000,
  "signature": "8e13990357c52f81f940429f5a7948bae42f16f0677e7bf73f2b6483bfc03a31635c327e7b2c6125fb4de50c2495c931a48c22a09664654b39633c509cfa670c",
  "currentState": "FINALIZED",
  "tipAmount": 1216875,
  "slot_at_submission": 250000000,
  "leader_type": "Jito",
  "bundle_id": "8e13990357c52f81f940429f5a7948...",
  "retry_attempt_count": 0,
  "failureReason": null,
  "totalLatencyMs": 424,
  "history": [
    { "state": "CREATED", "timestamp": "2026-06-07T02:59:04.619Z", "slot": 250000000, "latencyDeltaMs": 0 },
    { "state": "SUBMITTED", "timestamp": "2026-06-07T02:59:05.643Z", "slot": 250000000, "latencyDeltaMs": 1024 },
    { "state": "PROCESSED", "timestamp": "2026-06-07T02:59:06.064Z", "slot": 250000001, "latencyDeltaMs": 421 },
    { "state": "CONFIRMED", "timestamp": "2026-06-07T02:59:06.066Z", "slot": 250000002, "latencyDeltaMs": 2 },
    { "state": "FINALIZED", "timestamp": "2026-06-07T02:59:06.067Z", "slot": 250000003, "latencyDeltaMs": 1 }
  ]
}
```

### B. Decision Log Schema (`decisions.json`)
Preserves the justification metrics behind each decision:
```json
{
  "transactionId": "cdb1c731-069b-44e5-90fe-1706ec2bc5e8",
  "timestamp": "2026-06-07T02:59:04.619Z",
  "ai_decision_owner": "CREDOVU_AGENT",
  "ai_control": true,
  "decision_override": true,
  "delay_ms": 0,
  "tip_lamports": 1216875,
  "reasoning": "Slot offset is +0 with 4 slots remaining on active leader Jito5555... Jito block engine auction is active, allowing direct bundle landing in private pools to bypass public mempool sandwich risks.",
  "observedMetrics": {
    "slot": 250000000,
    "leaderType": "Jito",
    "leaderIdentity": "Jito5555555555555555555555555555555555555",
    "congestionRate": 21,
    "queueDepth": 102,
    "recentFailureRate": 8,
    "recentBaseFee": 6250
  }
}
```
