import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { createGame, playerAct, startHand, type GameState, type PlayerAction } from '../src/logic/game';
import { mulberry32 } from '../src/logic/rng';
import { currentLog, viewAt } from '../src/presentation/view';
import { autoplay } from './helpers/autoplay';

const num = (id: string) => Number(screen.getByTestId(id).textContent);
const visible = (el: Element | null) => !!el && (el as HTMLElement).style.visibility !== 'hidden' && (el as HTMLElement).style.opacity !== '0';
const click = (el: Element) => act(() => fireEvent.click(el));
const primary = () => screen.queryByTestId('primary');
const isPlaying = () => primary()?.textContent?.includes('スキップ') ?? false;

/** Tap through a whole hand, skipping every animation; mirrors the moves on a pure state. */
function playHandWithChecks(state: GameState): GameState {
  click(primary()!); // deal
  let s = startHand(state);
  for (let guard = 0; guard < 10; guard++) {
    if (isPlaying()) click(primary()!);
    if (!s.hand) break;
    const a: PlayerAction = s.hand.facing > 0 ? { type: 'call' } : { type: 'check' };
    click(screen.getByTestId(a.type === 'call' ? 'act-call' : 'act-check'));
    s = playerAct(s, a);
  }
  if (isPlaying()) click(primary()!);
  return s;
}

function expectScreenMatches(s: GameState) {
  const r = s.lastRound!;
  expect(num('hp-player')).toBe(r.player.after.hp);
  expect(num('hp-opponent')).toBe(r.opponent.after.hp);
  expect(num('survivors')).toBe(s.survivors);
  expect(num('pot')).toBe(0);
}

afterEach(cleanup);

describe('view reducer', () => {
  it('replaying any hand log lands on the logic state', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const s of autoplay(seed, 120)) {
        const log = currentLog(s);
        if (!log.length) continue;
        const v = viewAt(log, log.length);
        if (s.hand) {
          expect(v.playerHp).toBe(s.player.hp);
          expect(v.opponentHp).toBe(s.opponent.hp);
          expect(v.pot).toBe(s.hand.committed.player + s.hand.committed.opponent);
        } else {
          expect(v.playerHp).toBe(s.lastRound!.player.after.hp);
          expect(v.survivors).toBe(s.survivors);
          expect(v.pot).toBe(0);
        }
      }
    }
  });
});

describe('presentation', () => {
  it('bets move HP into the pot; skip lands on the decided numbers', () => {
    render(<App seed={42} />);
    click(primary()!); // deal → antes posted (animating)
    expect(isPlaying()).toBe(true);
    click(primary()!); // skip
    const s1 = startHand(createGame(42));
    expect(num('hp-player')).toBe(s1.player.hp);
    expect(num('pot')).toBe(4);
    // Player cards face up, opponent face down, board hidden.
    expect(visible(document.querySelector('[data-card="p0"] .card-front'))).toBe(true);
    expect(visible(document.querySelector('[data-card="o0"] .card-front'))).toBe(false);
    expect(visible(document.querySelector('[data-card="b0"]'))).toBe(false);

    click(screen.getByTestId('act-bet-half'));
    click(primary()!); // skip
    const s2 = playerAct(s1, { type: 'bet', size: 'half' });
    if (s2.hand) {
      expect(num('hp-player')).toBe(s2.player.hp);
      expect(num('pot')).toBe(s2.hand.committed.player + s2.hand.committed.opponent);
      expect(visible(document.querySelector('[data-card="b2"]'))).toBe(true); // flop is out
      expect(visible(document.querySelector('[data-card="b3"]'))).toBe(false);
    } else {
      expectScreenMatches(s2);
    }
  });

  it('a full hand ends with every effect element at rest and the right numbers', () => {
    render(<App seed={3453} />);
    const s = playHandWithChecks(createGame(3453));
    expectScreenMatches(s);
    expect(visible(document.querySelector('[data-banner]'))).toBe(false);
    expect(visible(document.querySelector('[data-projectile]'))).toBe(false);
    document.querySelectorAll('[data-particle], [data-chip]').forEach((p) => expect(visible(p)).toBe(false));
    if (s.lastRound!.endedBy === 'showdown') {
      for (const slot of ['o0', 'o1', 'b4']) expect(visible(document.querySelector(`[data-card="${slot}"] .card-front`))).toBe(true);
    }
  });

  it('survives rapid tapping of whatever button is there', () => {
    render(<App seed={77} />);
    const rng = mulberry32(1);
    let s = createGame(77);
    let steps = 0;
    for (let i = 0; i < 300 && s.status === 'playing'; i++) {
      const btns = [...document.querySelectorAll<HTMLButtonElement>('.controls button:not(:disabled)')];
      if (!btns.length) break;
      const btn = btns[Math.floor(rng() * btns.length)]!;
      const id = btn.dataset.testid ?? '';
      // Mirror only the taps that are real game steps.
      if (id === 'primary' && !isPlaying()) s = startHand(s);
      else if (id.startsWith('act-')) {
        const [, type, size] = id.split('-') as [string, PlayerAction['type'], 'half' | 'pot' | 'allin' | undefined];
        s = playerAct(s, type === 'bet' ? { type, size: size! } : ({ type } as PlayerAction));
        steps++;
      }
      click(btn);
      // Sometimes tap again immediately (double tap) on whatever is now under the finger.
      if (rng() < 0.3) {
        const again = document.querySelector<HTMLButtonElement>('.controls button:not(:disabled)');
        if (again?.dataset.testid === 'primary' && isPlaying()) click(again);
      }
    }
    expect(steps).toBeGreaterThan(5);
    if (isPlaying()) click(primary()!);
    if (!s.hand && s.lastRound) expectScreenMatches(s);
    else {
      expect(num('hp-player')).toBe(s.player.hp);
      expect(num('pot')).toBe(s.hand!.committed.player + s.hand!.committed.opponent);
    }
  });

  it('replay re-runs the last hand without touching the result', () => {
    render(<App seed={5} />);
    const s = playHandWithChecks(createGame(5));
    click(screen.getByText(/リプレイ/));
    expect(isPlaying()).toBe(true);
    expect(num('pot')).toBe(0); // replay starts before the antes
    click(primary()!);
    expectScreenMatches(s);
  });

  it('opens on the 100-player lobby and zooms into the table on join', () => {
    render(<App seed={42} />);
    const arena = document.querySelector('[data-arena]')!;
    expect(arena.classList.contains('is-lobby')).toBe(true);
    expect(visible(arena)).toBe(true);
    expect(document.querySelectorAll('[data-tile]')).toHaveLength(100);
    expect(document.querySelector(`[data-tile="${createGame(42).roster.you}"]`)!.classList.contains('is-you')).toBe(true);
    click(screen.getByTestId('join'));
    expect(isPlaying()).toBe(true);
    click(primary()!); // skip the intro + deal
    expect(visible(arena)).toBe(false);
    expect(visible(document.querySelector('[data-stage]'))).toBe(true);
    expect(num('pot')).toBe(4);
  });

  it('standings view shows who is out, and never changes the game', () => {
    render(<App seed={5} />);
    const s = playHandWithChecks(createGame(5));
    click(screen.getByTestId('standings'));
    const arena = document.querySelector('[data-arena]')!;
    expect(arena.classList.contains('is-open')).toBe(true);
    expect(num('arena-alive')).toBe(s.survivors);
    const out = document.querySelectorAll('[data-tile].is-out');
    expect(out.length).toBe(100 - s.survivors);
    expect(document.querySelectorAll('[data-tile].is-new').length).toBe(s.lastRound!.survivors.fallen.length);
    click(screen.getByTestId('arena-close'));
    expectScreenMatches(s);
    // Next deal still works and closes nothing it shouldn't.
    click(primary()!);
    expect(isPlaying()).toBe(true);
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
      render(<App seed={3453} />);
      expect(document.querySelector('.app')!.classList.contains('is-reduced')).toBe(true);
      expectScreenMatches(playHandWithChecks(createGame(3453)));
    } finally {
      window.matchMedia = mm;
    }
  });
});
