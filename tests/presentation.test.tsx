import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { createGame, resolveRound, type GameState } from '../src/logic/game';

const SEED = 3453; // round 1: straight flush → KO

function expectedAfter(seed: number, rounds: number): GameState {
  let s = createGame(seed);
  for (let i = 0; i < rounds; i++) s = resolveRound(s);
  return s;
}

const primary = () => document.querySelector<HTMLButtonElement>('.controls .btn--primary')!;
const hp = (side: 'player' | 'opponent') => Number(screen.getByTestId(`hp-${side}`).textContent);
const survivors = () => Number(screen.getByTestId('survivors').textContent);
const visible = (el: Element | null) => !!el && (el as HTMLElement).style.visibility !== 'hidden' && (el as HTMLElement).style.opacity !== '0';

afterEach(cleanup);

describe('presentation', () => {
  it('shows the pre-round values while playing, and the decided result after skip', () => {
    render(<App seed={SEED} />);
    const r1 = expectedAfter(SEED, 1).lastRound!;

    act(() => fireEvent.click(primary())); // deal
    expect(primary().textContent).toContain('スキップ');
    // Logic is final, but the screen still shows the "before" numbers.
    expect(hp('opponent')).toBe(r1.opponent.before.hp);
    // Cards are rendered face down until revealed.
    const front = document.querySelector('[data-card="o0"] .card-front')!;
    expect(visible(front)).toBe(false);

    act(() => fireEvent.click(primary())); // skip
    expect(primary().textContent).toContain('次');
    expect(hp('opponent')).toBe(r1.opponent.after.hp);
    expect(hp('player')).toBe(r1.player.after.hp);
    expect(survivors()).toBe(r1.survivors.after);

    // End state of every visual is applied.
    for (const slot of ['p0', 'p1', 'o0', 'o1', 'b0', 'b1', 'b2', 'b3', 'b4']) {
      expect(visible(document.querySelector(`[data-card="${slot}"] .card-front`))).toBe(true);
      expect(visible(document.querySelector(`[data-card="${slot}"] .card-back`))).toBe(false);
    }
    expect(visible(document.querySelector('[data-banner]'))).toBe(false);
    expect(visible(document.querySelector('[data-projectile]'))).toBe(false);
    expect(visible(document.querySelector('[data-ko="opponent"]'))).toBe(true);
    document.querySelectorAll('[data-particle]').forEach((p) => expect(visible(p)).toBe(false));
  });

  it('survives rapid tapping: state equals the logic-only result', () => {
    render(<App seed={77} />);
    let dealt = 0;
    for (let i = 0; i < 40; i++) {
      const isDeal = !primary().textContent!.includes('スキップ');
      if (isDeal && primary().disabled) break;
      act(() => fireEvent.click(primary()));
      if (isDeal) dealt++;
    }
    // Make sure the last round is settled.
    if (primary().textContent!.includes('スキップ')) act(() => fireEvent.click(primary()));
    const expected = expectedAfter(77, dealt);
    expect(hp('player')).toBe(expected.lastRound!.player.after.hp);
    expect(hp('opponent')).toBe(expected.lastRound!.opponent.after.hp);
    expect(survivors()).toBe(expected.survivors);
  });

  it('a new deal mid-animation fast-forwards the previous round without breaking it', () => {
    render(<App seed={SEED} />);
    act(() => fireEvent.click(primary())); // deal round 1 (playing)
    const replay = screen.getByText(/リプレイ/);
    expect((replay as HTMLButtonElement).disabled).toBe(true);
    act(() => fireEvent.click(primary())); // skip
    act(() => fireEvent.click(replay)); // replay round 1
    expect(hp('opponent')).toBe(expectedAfter(SEED, 1).lastRound!.opponent.before.hp);
    act(() => fireEvent.click(primary())); // skip replay
    act(() => fireEvent.click(primary())); // deal round 2 → playing
    act(() => fireEvent.click(primary())); // skip
    const s2 = expectedAfter(SEED, 2);
    expect(hp('player')).toBe(s2.lastRound!.player.after.hp);
    expect(hp('opponent')).toBe(s2.lastRound!.opponent.after.hp);
    // Round 2 is against the next challenger, whose KO stamp must be hidden again.
    if (!s2.lastRound!.attack?.hp.eliminated) {
      expect(visible(document.querySelector('[data-ko="opponent"]'))).toBe(false);
    }
  });

  it('honours prefers-reduced-motion and still lands on the same result', () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    try {
      render(<App seed={SEED} />);
      expect(document.querySelector('.app')!.classList.contains('is-reduced')).toBe(true);
      act(() => fireEvent.click(primary()));
      act(() => fireEvent.click(primary()));
      expect(hp('opponent')).toBe(expectedAfter(SEED, 1).lastRound!.opponent.after.hp);
    } finally {
      window.matchMedia = mm;
    }
  });
});
