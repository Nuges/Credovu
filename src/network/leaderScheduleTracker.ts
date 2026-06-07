import { LeaderType } from '../types';

export interface LeaderInfo {
  identity: string;
  type: LeaderType;
  remainingSlotsInEpoch: number;
}

export class LeaderScheduleTracker {
  // Mock list of validators
  private validators = [
    { identity: 'Jito111111111111111111111111111111111111111', type: 'Jito' as LeaderType },
    { identity: 'StdVal2222222222222222222222222222222222222', type: 'Standard' as LeaderType },
    { identity: 'Jito333333333333333333333333333333333333333', type: 'Jito' as LeaderType },
    { identity: 'StdVal4444444444444444444444444444444444444', type: 'Standard' as LeaderType },
    { identity: 'Jito555555555555555555555555555555555555555', type: 'Jito' as LeaderType },
    { identity: 'StdVal6666666666666666666666666666666666666', type: 'Standard' as LeaderType }
  ];

  /**
   * Resolves the leader identity and compatibility for a given slot.
   * In Solana, leaders are assigned in blocks of 4 slots.
   */
  public getLeaderForSlot(slot: number): LeaderInfo {
    // 4 slots per leader block
    const leaderIndex = Math.floor(slot / 4) % this.validators.length;
    const validator = this.validators[leaderIndex];
    const remaining = 4 - (slot % 4);

    return {
      identity: validator.identity,
      type: validator.type,
      remainingSlotsInEpoch: remaining
    };
  }

  /**
   * Finds the next Jito leader slot start relative to a current slot
   */
  public getNextJitoLeaderSlot(currentSlot: number): number {
    let checkSlot = currentSlot;
    // Iterate slots up to a limit to avoid loops
    for (let i = 0; i < 100; i++) {
      const info = this.getLeaderForSlot(checkSlot);
      if (info.type === 'Jito') {
        return checkSlot;
      }
      checkSlot += 4 - (checkSlot % 4); // Skip to next leader boundary
    }
    return currentSlot; // Fallback
  }
}
