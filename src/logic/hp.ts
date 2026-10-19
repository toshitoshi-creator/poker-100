export interface Fighter {
  readonly id: string;
  readonly name: string;
  /** Seat number 0..99 among the 100 players. */
  readonly seat: number;
  readonly hp: number;
  readonly maxHp: number;
}

export interface HpChange {
  before: number;
  after: number;
  /** Actual HP lost (clamped at 0). */
  lost: number;
  eliminated: boolean;
}

export function applyDamage(fighter: Fighter, damage: number): { fighter: Fighter; change: HpChange } {
  const dmg = Math.max(0, Math.floor(damage));
  const after = Math.max(0, fighter.hp - dmg);
  return {
    fighter: { ...fighter, hp: after },
    change: { before: fighter.hp, after, lost: fighter.hp - after, eliminated: after === 0 },
  };
}
