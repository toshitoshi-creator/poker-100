import { GameController } from '../src/game/controller';
import { createGame, resolveRound, type RoundResult } from '../src/logic/game';
import type { Presenter } from '../src/presentation/director';

/** Records calls; "plays" until skipped. */
class FakePresenter implements Presenter {
  log: string[] = [];
  playing = false;
  play(r: RoundResult) {
    if (this.playing) this.skip();
    this.log.push(`play:${r.round}`);
    this.playing = true;
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

describe('GameController', () => {
  it('resolves logic immediately, independent of the presenter', () => {
    const c = new GameController(42);
    const r = c.deal()!;
    expect(c.getState()).toEqual(resolveRound(createGame(42)));
    expect(r.round).toBe(1);
  });

  it('skips a running presentation before dealing the next round', () => {
    const c = new GameController(42);
    const p = new FakePresenter();
    c.attach(p);
    p.play(c.deal()!);
    c.deal();
    expect(p.log).toEqual(['play:1', 'skip']);
    expect(c.getState().round).toBe(2);
  });

  it('rapid deals produce exactly the same state as sequential ones', () => {
    const c = new GameController(7);
    const p = new FakePresenter();
    c.attach(p);
    for (let i = 0; i < 20; i++) {
      const r = c.deal();
      if (r) p.play(r);
    }
    let expected = createGame(7);
    for (let i = 0; i < 20; i++) expected = resolveRound(expected);
    expect(c.getState()).toEqual(expected);
  });

  it('replay and skip never change game state', () => {
    const c = new GameController(5);
    const p = new FakePresenter();
    c.attach(p);
    c.deal();
    const before = c.getState();
    c.replay();
    c.replay();
    c.skip();
    c.skip();
    expect(c.getState()).toBe(before);
    expect(p.log).toEqual(['play:1', 'skip', 'play:1', 'skip']);
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
