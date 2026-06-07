# CREDOVU — Credibility Unchained Verification Utility

CREDOVU is a production-quality, AI-driven transaction settlement reliability layer for the Solana blockchain. It acts as an intelligent transaction scheduler and bundle manager that tracks slot boundaries, leader schedule rotations, and network congestion signals to optimize transaction timing and determine dynamic Jito tip sizes.

> [!NOTE]
> **Positioning Statement**: Most systems send transactions. **Credovu decides whether they deserve to be sent.**
> It is an AI-driven *Transaction Execution Layer*, not a blind transaction sender.

---

## Solana Core Infrastructure Q&A (Grounded in Simulation Metrics)

### Q1: What does processed -> confirmed delta mean for network health?
The `processed` state represents the local validator executing a transaction and including it in a block. The `confirmed` state represents the cluster reaching optimistic confirmation (meaning a supermajority of 2/3+ of the validator voting stake has voted on the block containing the transaction).
* **Simulation Metrics Range**: In our deterministic simulation runtime environment, the processed-to-confirmed delta is simulated at **`1ms to 2ms`** (allowing for instant pipeline progression check), while standard Solana Mainnet conditions yield a delta of **`400ms to 800ms`**.
* **Network Health Implications**: A widening of this delta indicates cluster voting stake desynchronization, packet drop spikes, or a high fork rate. Under normal conditions, this delta is under 1 second. If the delta widens, it indicates consensus-level network degradation or severe packet congestion between validator nodes.

### Q2: Why is a finalized blockhash dangerous for time-sensitive transactions?
Solana blockhashes are valid for only 150 slots (approx. 60 seconds). A block hash achieves `finalized` state only after ~31 confirmation blocks are built on top of it, which takes around 12 to 32 seconds depending on network load.
* **Mismatched Lifecycles**: If a client relies on a **finalized blockhash** to sign new time-sensitive transactions, the blockhash is already 30 to 80 slots old by the time it is submitted. If the transaction gets delayed due to a leader miss or RPC pool congestion, it has a very narrow window (less than 70 slots) before it expires, rendering it dead. High-speed trading and settlement systems should always fetch and sign transactions with **confirmed** (optimistic) blockhashes to guarantee a full 150-slot validity lifetime.

### Q3: What happens when a Jito leader skips a slot?
If a scheduled Jito validator skips its block production slot (due to offline state, validator crash, or network desync), any bundle submitted to that Jito block engine for that slot is dropped.
* **No Fallback Mempool**: Jito bundles are slot-pinned and execute via a private sidecar memory pool. They do not default back to standard transaction queues. If a Jito leader skips its slot, the bundle is immediately dropped. The client must detect the skip and re-route the bundle to the next scheduled leader.

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
