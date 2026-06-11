# CREDOVU — Credibility Unchained Verification Utility

CREDOVU is a production-quality, AI-driven transaction settlement reliability layer for the Solana blockchain. It acts as an intelligent transaction scheduler and bundle manager that tracks slot boundaries, leader schedule rotations, and network congestion signals to optimize transaction timing and determine dynamic Jito tip sizes.

> [!NOTE]
> **Positioning Statement**: Most systems send transactions. **Credovu decides whether they deserve to be sent.**
> It is an AI-driven *Transaction Execution Layer*, not a blind transaction sender.

---

## Solana Core Infrastructure & Settlement Dynamics (Grounded in Simulation Metrics)

High-performance transaction settlement on Solana requires a deep understanding of network lifecycles, consensus state transitions, and the distinct behaviors of private MEV blockspace auctions compared to the public mempool.

### 1. Network Health and Commitment Progression
The lifecycle of a transaction moves through progressive commitment levels:
* **Processed**: A local validator has executed the transaction and included it in a block.
* **Confirmed**: A supermajority (2/3+) of the cluster validator voting stake has voted on the block containing the transaction (optimistic confirmation).

Under standard Solana Mainnet conditions, the transition from *processed* to *confirmed* takes **`400ms to 800ms`** (simulated deterministically in our runtime at **`1ms to 2ms`**). The width of this delta acts as a real-time network health metric. A widening delta indicates cluster voting stake desynchronization, high packet drop rates, or consensus fork branches. Under severe degradation, this delta stretches beyond one second, signaling validator communication latency or consensus-level instability.

### 2. Dangers of Finalized Blockhash Dependency
Relying on a **finalized blockhash** to sign new, time-sensitive transactions is a major operational anti-pattern. 
Solana blockhashes remain valid for exactly 150 slots (~60 seconds). However, a blockhash only reaches the *finalized* commitment level after approximately 31 confirmation blocks are built on top of it—a process that takes **`12 to 32 seconds`** depending on block times and network load.

If an execution stack signs transactions using a finalized blockhash, that blockhash is already 30 to 80 slots old before the transaction is even broadcast. Any minor delay, such as temporary RPC pool congestion or slot leader skips, leaves a very narrow window before the transaction expires and is discarded. To maximize a transaction’s 150-slot validity lifetime, time-sensitive stacks should always fetch blockhashes at the **confirmed** (optimistic) commitment level.

### 3. Jito Bundle Behavior and Leader Skips
Integrating with private MEV blockspace auctions via the Jito Block Engine changes transaction routing characteristics. When a Jito bundle is packaged and submitted, it enters a private sidecar memory pool pinned to a specific scheduled leader slot. 

Unlike standard transactions, **Jito bundles do not fall back to the public validator mempool**. If the scheduled Jito leader skips its block production slot due to network desynchronization, validator crash, or network fork, the Jito Block Engine drops the bundle entirely. The execution stack must actively monitor Geyser slot increments, detect the missed slot rotation, rebuild the transaction payload with a fresh blockhash if needed, and re-route the auction bundle to the next active Jito validator.

---

## Yellowstone gRPC Slot Streaming Emulation

> [!IMPORTANT]
> **Yellowstone stream is emulated with deterministic slot progression engine with 400ms tick resolution and leader rotation simulation model.**

To run without requiring private mainnet gRPC nodes, the `SlotStreamListener` mimics the Yellowstone Geyser gRPC event stream using Node `EventEmitter` patterns. Below is the mapping from the Credovu emulated stream schema to real Yellowstone Geyser proto fields:

| Emulated Event Key | Credovu Mock Payload | Yellowstone gRPC Field Equivalent | Description |
| :--- | :--- | :--- | :--- |
| `slot` | `number` (e.g. `250000004`) | `SubscribeUpdateSlot.slot` | Current slot height. |
| `leaderIdentity` | `string` (Validator Pubkey) | `SubscribeUpdateSlot.parent` (derived) | Public key of the validator producing the slot. |
| `timestamp` | `ISO String` | `SubscribeUpdateSlot.timestamp` | Slot processing epoch time. |
| `leaderType` | `Jito` \| `Standard` | (Derived from validator list metadata) | Indicates whether the leader accepts MEV bundle auctions. |

---

## Architecture Documentation

Review the full design specifications, data flows, and failure handling strategies in the public [architecture.md](file:///Users/segun/Documents/Credovu/architecture.md) document.

---

## Installation & Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Create a `.env` file in the project root:
   ```ini
   PORT=3005
   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
   MOCK_MODE=true

   # Add Gemini API Key for live LLM reasoning (Optional)
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **Run in Development**:
   ```bash
   npm run dev
   ```

4. **Run Simulation CLI**:
   ```bash
   npm run simulate
   ```

5. **Build for Production**:
   ```bash
   npm run build
   npm start
   ```

---

## API Endpoints

### 1. Submit Transaction
`POST /transaction/submit`
Submits a transfer instruction. Runs the AI decision matrix to pace execution and attaches a dynamic Jito tip.

- **Request Body**:
  ```json
  {
    "recipient": "96gWZ22sgj9wJUujadENgzattg3dm1zwP9S2n5Xy2T4e",
    "amount": 150000
  }
  ```

### 2. Simulate Failure
`POST /transaction/simulate-failure`
Injects a specific failure classification to test the AI's feedback recovery loop (automatically retrying and adapting).

- **Request Body**:
  ```json
  {
    "failureType": "BlockhashExpired",
    "recipient": "96gWZ22sgj9wJUujadENgzattg3dm1zwP9S2n5Xy2T4e",
    "amount": 50000
  }
  ```
  *Allowed `failureType` parameters: `BlockhashExpired`, `FeeTooLow`, `ComputeBudgetExceeded`, `BundleDropped`, `LeaderMissedSlot`*

---

## AI Decision Reasoning Output Example

Below is a structured reasoning JSON generated by the Bayesian engine. It models slot offsets, validator alignments, congestion risks, and formulates a strategic delay and Jito tip payment:

```json
{
  "ai_decision_owner": "CREDOVU_AGENT",
  "submit": true,
  "delay_ms": 0,
  "recommended_tip_lamports": 216424,
  "confidence": 0.95,
  "risk_factors": [
    "Moderate network congestion (29%)",
    "Elevated validator failure rate (22%)"
  ],
  "reasoning": "Slot offset is +0 with 4 slots remaining on active leader Jito1111... Jito block engine auction is active, allowing direct bundle landing in private pools to bypass public mempool sandwich risks. Congestion level is 29% with priority CU fees at 8250 microLamports. Dynamic tip size set to 216424 lamports ($0.00022 SOL) to outcompete competing arb flows. Executing transaction instantly."
}
```
