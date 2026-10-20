import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { createGame, legalActions, playerAct, startHand, TABLE_SIZE, type GameState, type PlayerAction } from '../src/logic/game';
import { mulberry32 } from '../src/logic/rng';
import { currentLog, viewAt } from '../src/presentation/view';
import { autoplay } from './helpers/autoplay';

const num = (id: string) => Number(screen.getByTestId(id).textContent);
const visible = (el: Element | null) => !!el && (el as HTMLElement).style.visibility !== 'hidden' && (el as HTMLElement).style.opacity !== '0';
const click = (el: Element) => act(() => fireEvent.click(el));
const primary = () => screen.queryByTestId('primary');
const isPlaying = () => primary()?.textContent?.includes('スキップ') ?? false;
const skipIfPlaying = () => isPlaying() && click(primary()!);

/** Check / call down a hand, skipping every animation; mirrors the moves on a pure state. */
function playHandPassively(state: GameState): GameState {
  click(primary()!); // deal (or join from the lobby)
  let s = startHand(state);
  for (let guard = 0; guard < 20 && s.hand; guard++) {
    skipIfPlaying();
    const a: PlayerAction = legalActions(s).some((l) => l.type === 'check') ? { type: 'check' } : { type: 'call' };
    click(screen.getByTestId(`act-${a.type}`));
    s = playerAct(s, a);
  }
  skipIfPlaying();
  return s;
}

function join(state: GameState): GameState {
  click(screen.getByTestId('join'));
  return startHand(state);
}

/** Everything the screen shows matches the decided state. */
function expectScreenMatches(s: GameState) {
  const r = s.hand ? null : s.lastRound;
  for (let i = 0; i < TABLE_SIZE; i++) {
    const f = r ? r.after[i] : s.seats[i];
    if (!f) continue;
    expect(num(`hp-${i}`)).toBe(f.hp);
    if (s.hand) expect(screen.getByTestId(`bet-${i}`).textContent).toBe(s.hand.streetBet[i] ? String(s.hand.streetBet[i]) : '');
  }
  expect(num('survivors')).toBe(s.survivors);
  const expectedPot = s.hand ? s.hand.committed.reduce((a, b) => a + b, 0) - s.hand.streetBet.reduce((a, b) => a + b, 0) : 0;
  expect(num('pot')).toBe(expectedPot);
}

afterEach(cleanup);

describe('view reducer', () => {
  it('replaying any hand log lands on the logic state', () => {
    for (const seed of [1, 2, 3, 6]) {
      for (const s of autoplay(seed, 150)) {
        const log = currentLog(s);
        if (!log.length) continue;
        const v = viewAt(log, log.length);
        if (s.hand) {
          expect(v.hp).toEqual(s.seats.map((f) => f?.hp ?? 0));
          expect(v.pot + v.bets.reduce((a, b) => a + b, 0)).toBe(s.hand.committed.reduce((a, b) => a + b, 0));
          expect(v.bets).toEqual(s.hand.streetBet);
          expect(v.folded).toEqual(s.hand.inHand.map((on, i) => !on && !!s.hand!.deal.hole[i]));
        } else {
          expect(v.hp).toEqual(s.lastRound!.after.map((f) => f?.hp ?? 0));
          expect(v.survivors).toBe(s.survivors);
          expect(v.pot).toBe(0);
        }
      }
    }
  });
});

describe('presentation', () => {
  it('opens on the 100-player lobby and zooms into the table on join', () => {
    render(<App seed={42} />);
    const arena = document.querySelector('[data-arena]')!;
    expect(arena.classList.contains('is-lobby')).toBe(true);
    expect(visible(arena)).toBe(true);
    expect(document.querySelectorAll('[data-tile]')).toHaveLength(100);
    expect(document.querySelectorAll('[data-tile].is-opp')).toHaveLength(5);
    const s = join(createGame(42));
    expect(isPlaying()).toBe(true);
    click(primary()!); // skip the intro + deal (+ AI actions)
    expect(visible(arena)).toBe(false);
    expect(visible(document.querySelector('[data-stage]'))).toBe(true);
    expectScreenMatches(s);
  });

  it('six seats are dealt; only your cards are face up until showdown', () => {
    render(<App seed={42} />);
    const s = join(createGame(42));
    click(primary()!);
    expect(document.querySelectorAll('[data-seat]')).toHaveLength(TABLE_SIZE);
    if (s.hand) {
      expect(visible(document.querySelector('[data-card="h0-0"] .card-front'))).toBe(true);
      for (let i = 1; i < TABLE_SIZE; i++) {
        if (!s.hand.deal.hole[i]) continue;
        expect(visible(document.querySelector(`[data-card="h${i}-0"]`))).toBe(true);
        expect(visible(document.querySelector(`[data-card="h${i}-0"] .card-front`))).toBe(false);
      }
      expect(screen.queryByTestId('act-fold') ?? screen.queryByTestId('act-check')).not.toBeNull();
    }
  });

  it('a full hand ends with every effect element at rest and the right numbers', () => {
    render(<App seed={3453} />);
    const s = playHandPassively(createGame(3453));
    expectScreenMatches(s);
    expect(visible(document.querySelector('[data-banner]'))).toBe(false);
    document.querySelectorAll('[data-projectile], [data-particle], [data-chip]').forEach((p) => expect(visible(p)).toBe(false));
    const r = s.lastRound!;
    if (r.endedBy === 'showdown') {
      for (const seat of r.showdown) expect(visible(document.querySelector(`[data-card="h${seat}-0"] .card-front`))).toBe(true);
      expect(visible(document.querySelector('[data-card="b4"] .card-front'))).toBe(true);
    }
  });

  it('survives rapid tapping of whatever button is there', () => {
    render(<App seed={77} />);
    const rng = mulberry32(1);
    let s = createGame(77);
    let steps = 0;
    for (let i = 0; i < 250 && s.status === 'playing'; i++) {
      const btns = [...document.querySelectorAll<HTMLButtonElement>('.controls button:not(:disabled), [data-testid="join"]')].filter(
        (b) => b.dataset.testid !== 'join' || s.round === 0,
      );
      if (!btns.length) break;
      const btn = btns[Math.floor(rng() * btns.length)]!;
      const id = btn.dataset.testid ?? '';
      // Mirror only the taps that are real game steps.
      if ((id === 'primary' && !isPlaying()) || id === 'join') s = startHand(s);
      else if (id.startsWith('act-')) {
        const [, type, size] = id.split('-') as [string, PlayerAction['type'], 'half' | 'pot' | 'allin' | undefined];
        s = playerAct(s, type === 'raise' ? { type, size: size! } : ({ type } as PlayerAction));
        steps++;
      }
      click(btn);
      // Sometimes tap again immediately (double tap) on whatever is now under the finger.
      if (rng() < 0.3) {
        const again = document.querySelector<HTMLButtonElement>('.controls button:not(:disabled)');
        if (again?.dataset.testid === 'primary' && isPlaying()) click(again);
      }
    }
    expect(steps).toBeGreaterThan(3);
    skipIfPlaying();
    expectScreenMatches(s);
  });

  it('replay re-runs the last hand without touching the result', () => {
    render(<App seed={5} />);
    const s = playHandPassively(createGame(5));
    click(screen.getByText(/リプレイ/));
    expect(isPlaying()).toBe(true);
    expect(num('pot')).toBe(0); // replay starts before the blinds
    click(primary()!);
    expectScreenMatches(s);
  });

  it('standings view shows who is out, and never changes the game', () => {
    render(<App seed={5} />);
    const s = playHandPassively(createGame(5));
    click(screen.getByTestId('standings'));
    const arena = document.querySelector('[data-arena]')!;
    expect(arena.classList.contains('is-open')).toBe(true);
    expect(num('arena-alive')).toBe(s.survivors);
    expect(document.querySelectorAll('[data-tile].is-out').length).toBe(100 - s.survivors);
    expect(document.querySelectorAll('[data-tile].is-new').length).toBe(s.lastRound!.survivors.fallen.length);
    click(screen.getByTestId('arena-close'));
    expectScreenMatches(s);
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
      expectScreenMatches(playHandPassively(createGame(3453)));
    } finally {
      window.matchMedia = mm;
    }
  });
});
