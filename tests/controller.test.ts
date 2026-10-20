import { GameController } from '../src/game/controller';
import { createGame, legalActions, playerAct, startHand, type GameEvent } from '../src/logic/game';
import type { Presenter } from '../src/presentation/director';
import type { TableView } from '../src/presentation/view';
import { randomPolicy } from './helpers/autoplay';

/** Records calls; "plays" until skipped. */
class FakePresenter implements Presenter {
  log: string[] = [];
  playing = false;
  play(log: readonly GameEvent[], from: number) {
    if (this.playing) this.skip();
    this.log.push(`play:${log[from]?.t}`);
    this.playing = true;
  }
  show(_v: TableView) {
    this.log.push('show');
  }
  skip() {
    if (!this.playing) return;
    this.log.push('skip');
    this.playing = false;
  }
  isPlaying() {
    return this.playing;
  }
  reset() {
    this.log.push('reset');
    this.playing = false;
  }
}

/** First seed whose opening hand waits for your decision. */
function seedWithDecision(): number {
  for (let seed = 1; ; seed++) if (startHand(createGame(seed)).hand) return seed;
}

describe('GameController', () => {
  it('resolves logic immediately, independent of the presenter', () => {
    const seed = seedWithDecision();
    const c = new GameController(seed);
    c.deal();
    expect(c.getState()).toEqual(startHand(createGame(seed)));
    const a = legalActions(c.getState())[0]!;
    const action = a.type === 'raise' ? { type: 'raise' as const, size: a.size } : { type: a.type };
    c.act(action as never);
    expect(c.getState()).toEqual(playerAct(startHand(createGame(seed)), action as never));
  });

  it('skips a running presentation before the next step', () => {
    const c = new GameController(seedWithDecision());
    const p = new FakePresenter();
    c.attach(p);
    c.deal();
    p.play(c.getState().hand!.log, 0);
    c.act(c.legal().some((l) => l.type === 'check') ? { type: 'check' } : { type: 'call' });
    expect(p.log).toEqual(['play:start', 'skip']);
  });

  it('ignores double taps: a stale action is a no-op', () => {
    const seed = seedWithDecision();
    const c = new GameController(seed);
    c.deal();
    expect(c.deal()).toBe(false); // hand already running
    const illegal = c.legal().some((l) => l.type === 'check') ? ({ type: 'call' } as const) : ({ type: 'check' } as const);
    expect(c.act(illegal)).toBe(false);
    expect(c.getState()).toEqual(startHand(createGame(seed)));
  });

  it('rapid mixed input produces exactly the same state as pure logic', () => {
    const c = new GameController(7);
    const p = new FakePresenter();
    c.attach(p);
    const policy = randomPolicy(7);
    let expected = createGame(7);
    for (let i = 0; i < 60 && expected.status === 'playing'; i++) {
      if (expected.hand) {
        const a = policy(expected);
        expected = playerAct(expected, a);
        c.act(a);
      } else {
        expected = startHand(expected);
        c.deal();
      }
      p.play(c.getState().hand?.log ?? c.getState().lastLog, 0);
    }
    expect(c.getState()).toEqual(expected);
  });

  it('replay and skip never change game state', () => {
    const c = new GameController(5);
    const p = new FakePresenter();
    c.attach(p);
    c.deal();
    c.replay(); // ignored mid-hand
    while (c.getState().hand) c.act(c.legal().some((l) => l.type === 'check') ? { type: 'check' } : { type: 'call' });
    const before = c.getState();
    c.replay();
    c.replay();
    c.skip();
    c.skip();
    expect(c.getState()).toBe(before);
    expect(p.log.filter((l) => l === 'play:start')).toHaveLength(2);
  });

  it('notifies subscribers and resets cleanly', () => {
    const c = new GameController(1);
    const p = new FakePresenter();
    c.attach(p);
    const fn = vi.fn();
    c.subscribe(fn);
    c.deal();
    c.reset(99);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(p.log).toContain('reset');
    expect(c.getState()).toEqual(createGame(99));
  });
});
