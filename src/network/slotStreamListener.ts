import { EventEmitter } from 'events';
import { solanaConnection } from './solanaConnection';

export class SlotStreamListener extends EventEmitter {
  private currentSlot: number;
  private intervalId: NodeJS.Timeout | null = null;
  private subId: number | null = null;
  private mockMode: boolean;

  constructor(initialSlot: number = 250000000, mockMode: boolean = true) {
    super();
    this.currentSlot = initialSlot;
    this.mockMode = mockMode;
  }

  /**
   * Starts listening to slots.
   * In Mock Mode, it simulates the 400ms slot tick.
   * In Real Mode, it subscribes to the Solana cluster via RPC WebSocket onSlotChange.
   */
  public async start(): Promise<void> {
    if (this.mockMode) {
      if (this.intervalId) return;
      console.log(`[SlotStreamListener] Starting mock slot stream simulation... Initial slot: ${this.currentSlot}`);
      this.intervalId = setInterval(() => {
        this.currentSlot += 1;
        this.emit('slot', this.currentSlot);
      }, 400); // 400ms block time
    } else {
      if (this.subId !== null) return;
      console.log(`[SlotStreamListener] Real Mode: Subscribing to Solana WebSocket onSlotChange...`);
      
      try {
        // Fetch current slot height first to initialize
        this.currentSlot = await solanaConnection.getSlot('processed');
        this.emit('slot', this.currentSlot);
        console.log(`[SlotStreamListener] Initial real slot height resolved: ${this.currentSlot}`);

        // Establish real-time WebSocket slot stream
        this.subId = solanaConnection.onSlotChange((slotInfo) => {
          this.currentSlot = slotInfo.slot;
          this.emit('slot', slotInfo.slot);
        });
      } catch (err) {
        console.error('[SlotStreamListener] WebSocket subscription failed, falling back to polling:', err);
        // Polling fallback
        this.intervalId = setInterval(async () => {
          try {
            const slot = await solanaConnection.getSlot('processed');
            if (slot > this.currentSlot) {
              this.currentSlot = slot;
              this.emit('slot', this.currentSlot);
            }
          } catch (pollErr) {
            console.error('[SlotStreamListener] Slot polling error:', pollErr);
          }
        }, 400);
      }
    }
  }

  public async stop(): Promise<void> {
    if (this.mockMode && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[SlotStreamListener] Stopped mock slot stream.');
    } else if (!this.mockMode) {
      if (this.subId !== null) {
        await solanaConnection.removeSlotChangeListener(this.subId);
        this.subId = null;
        console.log('[SlotStreamListener] Unsubscribed from Solana WebSocket slot updates.');
      }
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }
  }

  public getCurrentSlot(): number {
    return this.currentSlot;
  }
}
