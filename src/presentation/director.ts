import gsap from 'gsap';
import type { GameEvent, Side } from '../logic/game';
import { mulberry32 } from '../logic/rng';
import type { SoundBus, SoundId } from '../audio/soundBus';
import type { MotionProfile } from './motion';
import type { PresentationState, Store } from './store';
import { isLobby, reduceView, viewAt, type TableView } from './view';

/**
 * DOM contract (rendered by ui/Table):
 *   [data-stage]                     root, shaken on big hits
 *   [data-deck] [data-pot]           where cards / chips travel from and to
 *   [data-card="p0|p1|o0|o1|b0..b4"] card wrapper (moves), with data-card-id
 *     .card-inner / .card-back / .card-front / .card-glow
 *   [data-seat=side] [data-avatar=side] [data-hp=side] [data-label=side]
 *   [data-ko=side] [data-dmg=side] [data-gain=side]
 *   [data-banner] [data-flash] [data-projectile] [data-particle]×N [data-chip]×N
 *   [data-arena] > [data-arena-grid] > [data-tile=0..99] (.tile-x)   the 100-player overview
 */
export interface PlayOptions {
  /** Zoom from the 100-player lobby into the player's seat before the first deal (default true). */
  intro?: boolean;
}

export interface Presenter {
  /** Animate events log[from..] starting from the table as it was after log[0..from). */
  play(log: readonly GameEvent[], from: number, opts?: PlayOptions): void;
  /** Jump straight to a view (no animation). */
  show(view: TableView): void;
  skip(): void;
  isPlaying(): boolean;
  reset(): void;
}

export const PARTICLE_POOL = 28;
export const CHIP_POOL = 8;

const TIER_FX = [
  { particles: 0, shake: 0, flash: 0, hold: 0.7 },
  { particles: 8, shake: 0, flash: 0, hold: 0.8 },
  { particles: 14, shake: 4, flash: 0, hold: 0.95 },
  { particles: 20, shake: 7, flash: 0.25, hold: 1.1 },
  { particles: 28, shake: 12, flash: 0.6, hold: 1.4 },
] as const;

const HOLE = ['p0', 'o0', 'p1', 'o1'] as const;
const BOARD = ['b0', 'b1', 'b2', 'b3', 'b4'] as const;
const SLOTS = [...HOLE, ...BOARD];
const other = (s: Side): Side => (s === 'player' ? 'opponent' : 'player');
const hpKey = (s: Side) => (s === 'player' ? 'playerHp' : 'opponentHp') as 'playerHp' | 'opponentHp';

export interface DirectorOptions {
  root: HTMLElement;
  store: Store<PresentationState>;
  sound: SoundBus;
  motion: MotionProfile;
}

type Tl = gsap.core.Timeline;

export class Director implements Presenter {
  private tl: Tl | null = null;
  private arenaTl: Tl | null = null;
  private final: TableView | null = null;
  private motion: MotionProfile;
  /** Deck position relative to each card slot, measured at snap time. */
  private deckOffset = new Map<string, { x: number; y: number }>();
  private rand = Math.random;

  constructor(private readonly opts: DirectorOptions) {
    this.motion = opts.motion;
  }

  setMotion(motion: MotionProfile): void {
    this.motion = motion;
    this.tl?.timeScale(motion.speed);
  }

  isPlaying(): boolean {
    return this.tl !== null;
  }

  /** Stop wherever we are and land on the decided end state. */
  skip(): void {
    if (!this.tl) return;
    this.tl.kill();
    this.tl = null;
    if (this.final) this.snap(this.final);
    this.opts.store.set({ playing: false });
  }

  show(view: TableView): void {
    this.tl?.kill();
    this.tl = null;
    this.final = view;
    this.snap(view);
    this.opts.store.set({ playing: false });
  }

  /** Remove every inline style the Director put on long-lived elements. */
  reset(): void {
    this.tl?.kill();
    this.tl = null;
    this.final = null;
    const els = this.all(
      '[data-seat], [data-avatar], [data-label], [data-ko], [data-dmg], [data-gain], [data-banner], [data-flash], [data-projectile], [data-particle], [data-chip], [data-arena], [data-arena-grid], [data-tile] .tile-x',
    );
    this.arenaTl?.kill();
    this.arenaTl = null;
    if (els.length) gsap.set(els, { clearProps: 'all' });
    gsap.set(this.stage(), { clearProps: 'all' });
  }

  play(log: readonly GameEvent[], from: number, opts: PlayOptions = {}): void {
    if (this.tl) this.skip();
    if (from >= log.length) return;
    let view = viewAt(log, from);
    this.final = viewAt(log, log.length);
    const start = log[0] as Extract<GameEvent, { t: 'start' }>;
    this.rand = mulberry32((start.round * 2654435761) ^ from); // cosmetic only
    this.snap(view);

    const tl = gsap.timeline({ onComplete: () => this.complete(tl) });
    tl.timeScale(this.motion.speed);
    this.tl = tl;
    this.opts.store.set({ playing: true });
    if (isLobby(view)) {
      if (opts.intro !== false) this.intro(tl, start.player.seat);
      else this.leaveArenaNow();
    }
    for (let i = from; i < log.length; i++) {
      const next = reduceView(view, log[i]!);
      this.animate(tl, log[i]!, view, next);
      view = next;
    }
    tl.to({}, { duration: 0.15 }); // tail so the last frame is visible
  }

  private complete(tl: Tl) {
    if (this.tl !== tl) return;
    this.tl = null;
    if (this.final) this.snap(this.final);
    this.opts.store.set({ playing: false });
  }

  // ---- static state ----------------------------------------------------

  /** Put every element exactly where `v` says, and sync the store. */
  private snap(v: TableView): void {
    const { store } = this.opts;
    store.set({
      round: v.round,
      phase: v.phase,
      playerHp: v.playerHp,
      opponentHp: v.opponentHp,
      pot: v.pot,
      survivors: v.survivors,
      sayPlayer: v.say.player,
      sayOpponent: v.say.opponent,
    });

    const lobby = isLobby(v);
    this.arenaTl?.kill();
    this.arenaTl = null;
    gsap.set(this.all('[data-arena-grid]'), { x: 0, y: 0, scale: 1, transformOrigin: '0 0' });
    gsap.set(this.all('[data-arena]'), { autoAlpha: lobby ? 1 : 0 });
    gsap.set(this.all('[data-arena] .arena-chrome'), { autoAlpha: 1 });
    this.clearMarks();
    this.opts.store.set({ arena: lobby ? 'lobby' : 'hidden' });
    gsap.set(this.stage(), { x: 0, y: 0, scale: 1, autoAlpha: lobby ? 0 : 1 });
    gsap.set(this.all('[data-seat]'), { x: 0, y: 0 });
    gsap.set(this.all('[data-label], [data-dmg], [data-gain], [data-banner], [data-flash], [data-projectile], [data-particle], [data-chip]'), {
      autoAlpha: 0,
    });

    const cards: [string, HTMLElement][] = [];
    for (const s of SLOTS) {
      const el = this.one(`[data-card="${s}"]`);
      if (el) cards.push([s, el]);
    }
    // Measure with transforms cleared.
    gsap.set(cards.map((c) => c[1]), { x: 0, y: 0, rotation: 0, scale: 1 });
    const deck = this.one('[data-deck]');
    const d = deck ? centerOf(deck) : { x: 0, y: 0 };
    this.deckOffset.clear();
    for (const [slot, el] of cards) {
      const c = centerOf(el);
      this.deckOffset.set(slot, { x: d.x - c.x, y: d.y - c.y });
    }

    const r = v.result?.endedBy === 'showdown' ? v.result : null;
    const featured = new Set(r?.featuredHand?.cards.map((c) => c.id) ?? []);
    for (const [slot, el] of cards) {
      const isBoard = slot.startsWith('b');
      const shown = isBoard ? v.dealt && Number(slot.slice(1)) < v.boardShown : v.dealt;
      const faceUp = shown && (slot.startsWith('o') ? v.oppRevealed : true);
      const off = this.deckOffset.get(slot)!;
      const folded = (slot.startsWith('p') && v.folded === 'player') || (slot.startsWith('o') && v.folded === 'opponent');
      const hi = featured.has(el.dataset.cardId ?? '');
      gsap.set(el, shown ? { autoAlpha: folded || (r && !hi) ? 0.4 : 1, y: hi ? -10 : 0 } : { ...off, autoAlpha: 0 });
      this.setFace(el, faceUp);
      gsap.set(el.querySelector('.card-glow'), { autoAlpha: hi ? 1 : 0 });
    }

    if (r) gsap.set(this.all('[data-label]'), { autoAlpha: 1 });
    for (const side of ['player', 'opponent'] as const) {
      const out = v.result?.eliminated === side;
      gsap.set(this.all(`[data-avatar="${side}"]`), out ? { autoAlpha: 0.3, y: 8, rotation: -8, scale: 1 } : { autoAlpha: 1, y: 0, rotation: 0, scale: 1 });
      gsap.set(this.all(`[data-ko="${side}"]`), out ? { autoAlpha: 1, scale: 1, rotation: -12 } : { autoAlpha: 0 });
    }
  }

  private setFace(el: Element, up: boolean) {
    gsap.set(el.querySelector('.card-inner'), { rotationY: up ? 180 : 0 });
    gsap.set(el.querySelector('.card-back'), { autoAlpha: up ? 0 : 1 });
    gsap.set(el.querySelector('.card-front'), { autoAlpha: up ? 1 : 0 });
  }

  // ---- animation -------------------------------------------------------

  private animate(tl: Tl, e: GameEvent, before: TableView, after: TableView) {
    const R = this.motion.reduced;
    const say = () => this.set(tl, { sayPlayer: after.say.player, sayOpponent: after.say.opponent });
    switch (e.t) {
      case 'start': {
        this.set(tl, { phase: 'deal', round: e.round, survivors: e.survivors });
        tl.addLabel('ante');
        this.chips(tl, 'player', 'pot', 'ante');
        this.chips(tl, 'opponent', 'pot', 'ante');
        this.num(tl, 'playerHp', before.playerHp, after.playerHp, 0.4, 'ante+=0.2');
        this.num(tl, 'opponentHp', before.opponentHp, after.opponentHp, 0.4, 'ante+=0.2');
        this.num(tl, 'pot', before.pot, after.pot, 0.4, 'ante+=0.2');
        HOLE.forEach((s, i) => this.fly(tl, s, `ante+=${0.3 + i * 0.14}`));
        tl.addLabel('holeFlip', '+=0.15');
        this.flip(tl, 'p0', 'holeFlip');
        this.flip(tl, 'p1', 'holeFlip+=0.12');
        this.set(tl, { phase: 'preflop' });
        return;
      }
      case 'check':
        say();
        this.cue(tl, 'check');
        tl.to({}, { duration: R ? 0.15 : 0.45 });
        return;
      case 'bet': {
        say();
        tl.addLabel(`bet`);
        this.chips(tl, e.side, 'pot', 'bet');
        this.num(tl, hpKey(e.side), before[hpKey(e.side)], after[hpKey(e.side)], 0.35, 'bet+=0.15');
        this.num(tl, 'pot', before.pot, after.pot, 0.35, 'bet+=0.15');
        if (e.allIn && !R) {
          this.shake(tl, this.one(`[data-seat="${e.side}"]`), 6, 'bet+=0.2');
          this.flash(tl, 0.12, 'bet+=0.2');
        }
        tl.to({}, { duration: R ? 0.1 : 0.3 });
        return;
      }
      case 'fold': {
        say();
        this.cue(tl, 'fold');
        const prefix = e.side === 'player' ? 'p' : 'o';
        const els = [0, 1].map((i) => this.one(`[data-card="${prefix}${i}"]`)).filter(Boolean);
        tl.to(els, { autoAlpha: 0.4, y: R ? 0 : e.side === 'player' ? 8 : -8, duration: 0.3 });
        tl.to(els, { y: 0, duration: 0.2 });
        tl.to({}, { duration: 0.25 });
        return;
      }
      case 'street':
        tl.addLabel('flop', '+=0.2');
        this.set(tl, { phase: 'flop', sayPlayer: '', sayOpponent: '' }, 'flop');
        ['b0', 'b1', 'b2'].forEach((s, i) => this.fly(tl, s, `flop+=${i * 0.12}`));
        tl.addLabel('flopFlip', '+=0.1');
        ['b0', 'b1', 'b2'].forEach((s, i) => this.flip(tl, s, `flopFlip+=${i * 0.12}`));
        return;
      case 'runout': {
        tl.addLabel('runout', '+=0.25');
        this.set(tl, { sayPlayer: '', sayOpponent: '' }, 'runout');
        if (e.from === 0) {
          this.set(tl, { phase: 'flop' }, 'runout');
          ['b0', 'b1', 'b2'].forEach((s, i) => this.fly(tl, s, `runout+=${i * 0.12}`));
          tl.addLabel('rflip', '+=0.1');
          ['b0', 'b1', 'b2'].forEach((s, i) => this.flip(tl, s, `rflip+=${i * 0.12}`));
        }
        tl.addLabel('turn', '+=0.45');
        this.set(tl, { phase: 'turn' }, 'turn');
        this.fly(tl, 'b3', 'turn');
        this.flip(tl, 'b3', '+=0.08');
        tl.addLabel('river', '+=0.6'); // a beat longer for suspense
        this.set(tl, { phase: 'river' }, 'river');
        this.fly(tl, 'b4', 'river');
        this.flip(tl, 'b4', '+=0.15');
        return;
      }
      case 'showdown':
        tl.addLabel('showdown', '+=0.5');
        this.set(tl, { phase: 'showdown' }, 'showdown');
        this.cue(tl, 'reveal', 'showdown');
        this.flip(tl, 'o0', 'showdown');
        this.flip(tl, 'o1', 'showdown+=0.1');
        tl.to(this.all('[data-label]'), { autoAlpha: 1, duration: 0.25 }, '+=0.1');
        return;
      case 'award':
        this.award(tl, e.result, before);
        return;
    }
  }

  private award(tl: Tl, r: Extract<GameEvent, { t: 'award' }>['result'], before: TableView) {
    const R = this.motion.reduced;
    const fx = TIER_FX[r.tier];
    const stage = this.stage();
    tl.addLabel('hand', '+=0.25');
    this.set(tl, { phase: 'result' }, 'hand');

    // Emphasise the featured five, dim the rest.
    if (r.featuredHand) {
      const featured = new Set(r.featuredHand.cards.map((c) => c.id));
      const cards = this.all('[data-card]');
      const hi = cards.filter((el) => featured.has(el.dataset.cardId ?? ''));
      const lo = cards.filter((el) => !featured.has(el.dataset.cardId ?? ''));
      tl.to(lo, { autoAlpha: 0.4, duration: 0.3 }, 'hand');
      tl.to(hi, { y: R ? 0 : -10, duration: 0.3, ease: 'back.out(2)', stagger: 0.05 }, 'hand');
      tl.to(hi.map((el) => el.querySelector('.card-glow')).filter(Boolean), { autoAlpha: 1, duration: 0.3, stagger: 0.05 }, 'hand');
      this.cue(tl, r.tier >= 4 ? 'handLegendary' : r.tier >= 2 ? 'handMajor' : 'handMinor', 'hand');
    }
    const banner = this.one('[data-banner]');
    if (banner) {
      tl.set(banner, { scale: R ? 1 : 0.6 + r.tier * 0.05 }, 'hand+=0.15');
      tl.to(banner, { autoAlpha: 1, scale: 1, duration: R ? 0.15 : 0.4, ease: 'back.out(2.2)' }, '<');
    }
    if (!R) {
      if (fx.flash > 0) this.flash(tl, fx.flash, 'hand+=0.15');
      if (fx.shake > 0) this.shake(tl, stage, fx.shake, 'hand+=0.15');
      if (fx.particles > 0) this.burst(tl, fx.particles, banner ?? stage, r.tier, 'hand+=0.15');
    }
    tl.addLabel('handEnd', `hand+=${0.4 + (r.featuredHand ? fx.hold : 0.5)}`);
    if (banner) tl.to(banner, { autoAlpha: 0, scale: R ? 1 : 1.1, duration: 0.25 }, 'handEnd');

    // Pot → winner(s)
    tl.addLabel('pay', 'handEnd+=0.15');
    this.cue(tl, 'chips', 'pay');
    const winners: Side[] = r.winner === 'tie' ? ['player', 'opponent'] : [r.winner];
    const gain = (s: Side) => (r.winner === 'tie' ? r.committed[s] : r.pot);
    for (const s of winners) {
      this.chips(tl, 'pot', s, 'pay');
      this.num(tl, hpKey(s), before[hpKey(s)], before[hpKey(s)] + gain(s), 0.5, 'pay+=0.25');
      const pop = this.one(`[data-gain="${s}"]`);
      if (pop) {
        tl.set(pop, { y: 0, autoAlpha: 1, scale: R ? 1 : 1.4 }, 'pay+=0.3');
        tl.to(pop, { scale: 1, duration: 0.2 }, 'pay+=0.3');
        tl.to(pop, { y: R ? 0 : -20, autoAlpha: 0, duration: 0.5 }, 'pay+=1');
      }
    }
    this.num(tl, 'pot', before.pot, 0, 0.5, 'pay+=0.25');

    // Hand bonus: attack the loser
    if (r.winner !== 'tie' && r.bonus > 0) {
      const target = other(r.winner);
      tl.addLabel('attack', 'pay+=0.8');
      this.cue(tl, 'attack', 'attack');
      const hpEl = this.one(`[data-hp="${target}"]`);
      const proj = this.one('[data-projectile]');
      const from = this.one(`[data-avatar="${r.winner}"]`);
      if (!R && proj && hpEl && from) {
        const a = centerOf(from, stage);
        const b = centerOf(hpEl, stage);
        const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        tl.set(proj, { x: a.x, y: a.y, rotation: angle, scale: 0.6 + r.tier * 0.15, autoAlpha: 1 }, 'attack');
        tl.to(proj, { x: b.x, y: b.y, duration: 0.45, ease: 'power2.in' }, '>');
        tl.set(proj, { autoAlpha: 0 }, '>');
      }
      tl.addLabel('hit', '>');
      this.cue(tl, 'hit', 'hit');
      const seat = this.one(`[data-seat="${target}"]`);
      if (!R && seat) this.shake(tl, seat, 6 + r.tier * 2, 'hit');
      if (!R) this.flash(tl, 0.15, 'hit');
      const dmg = this.one(`[data-dmg="${target}"]`);
      if (dmg) {
        tl.set(dmg, { y: 0, scale: R ? 1 : 1.6, autoAlpha: 1 }, 'hit');
        tl.to(dmg, { scale: 1, duration: 0.2, ease: 'power2.out' }, 'hit');
        tl.to(dmg, { y: R ? 0 : -24, autoAlpha: 0, duration: 0.5, ease: 'power1.in' }, 'hit+=0.7');
      }
      const tgtAfter = r[target].after.hp;
      this.num(tl, hpKey(target), tgtAfter + r.bonus, tgtAfter, R ? 0.3 : 0.7, 'hit');
    }

    if (r.eliminated) {
      const side = r.eliminated;
      tl.addLabel('ko', '+=0.25');
      this.cue(tl, 'ko', 'ko');
      const avatar = this.one(`[data-avatar="${side}"]`);
      const stamp = this.one(`[data-ko="${side}"]`);
      if (avatar) tl.to(avatar, { autoAlpha: 0.3, y: R ? 0 : 8, rotation: R ? 0 : -8, duration: 0.5, ease: 'power2.in' }, 'ko');
      if (stamp) {
        tl.set(stamp, { scale: R ? 1 : 2.4, rotation: -12 }, 'ko');
        tl.to(stamp, { autoAlpha: 1, scale: 1, duration: R ? 0.15 : 0.35, ease: 'power4.in' }, 'ko+=0.2');
      }
      if (!R) this.shake(tl, stage, 10, 'ko+=0.55');
    }

    if (r.survivors.after !== r.survivors.before) {
      this.num(tl, 'survivors', r.survivors.before, r.survivors.after, R ? 0.2 : 0.6, '+=0.1');
    }
    if (r.statusAfter === 'won') this.cue(tl, 'win');
    if (r.statusAfter === 'lost') this.cue(tl, 'lose');
  }

  // ---- 100-player arena -------------------------------------------------

  /** Transform that makes `seat`'s tile fill the stage (grid uses transform-origin 0 0). */
  private seatZoom(seat: number): { x: number; y: number; scale: number } | null {
    const grid = this.one('[data-arena-grid]');
    const tile = this.one(`[data-tile="${seat}"]`);
    const arena = this.one('[data-arena]');
    if (!grid || !tile || !arena) return null;
    const prev = { x: gsap.getProperty(grid, 'x'), y: gsap.getProperty(grid, 'y'), scale: gsap.getProperty(grid, 'scale') };
    gsap.set(grid, { x: 0, y: 0, scale: 1, transformOrigin: '0 0' });
    const g = grid.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    const a = arena.getBoundingClientRect();
    gsap.set(grid, prev);
    if (!t.width) return null;
    const scale = (a.width * 0.92) / t.width;
    const tcx = t.left + t.width / 2 - g.left;
    const tcy = t.top + t.height / 2 - g.top;
    return { scale, x: a.left + a.width / 2 - g.left - scale * tcx, y: a.top + a.height / 2 - g.top - scale * tcy };
  }

  /** Lobby → zoom into the player's own screen → the table. */
  private intro(tl: Tl, seat: number) {
    const arena = this.one('[data-arena]');
    const grid = this.one('[data-arena-grid]');
    const tile = this.one(`[data-tile="${seat}"]`);
    const stage = this.stage();
    const z = this.seatZoom(seat);
    this.set(tl, { arena: 'lobby' });
    if (this.motion.reduced || !arena || !grid || !z) {
      tl.to(arena, { autoAlpha: 0, duration: 0.25 });
      tl.to(stage, { autoAlpha: 1, duration: 0.25 }, '<');
    } else {
      tl.addLabel('intro');
      tl.to(this.all('[data-arena] .arena-chrome'), { autoAlpha: 0, duration: 0.25 }, 'intro');
      tl.to(tile, { scale: 1.3, duration: 0.18, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 'intro');
      this.cue(tl, 'reveal', 'intro');
      tl.to(grid, { ...z, duration: 1.1, ease: 'power3.inOut' }, 'intro+=0.5');
      tl.to(arena, { autoAlpha: 0, duration: 0.35 }, 'intro+=1.25');
      tl.set(stage, { scale: 0.9 }, 'intro+=1.25');
      tl.to(stage, { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'power2.out' }, 'intro+=1.25');
    }
    tl.set(grid, { x: 0, y: 0, scale: 1 });
    tl.set(this.all('[data-arena] .arena-chrome'), { autoAlpha: 1 });
    this.set(tl, { arena: 'hidden' });
  }

  /** Undo the × stamp-in tweens (only eliminated tiles have a visible mark). */
  private clearMarks() {
    const marks = this.all('[data-tile].is-out .tile-x');
    if (marks.length) gsap.set(marks, { clearProps: 'all' });
  }

  private leaveArenaNow() {
    gsap.set(this.all('[data-arena]'), { autoAlpha: 0 });
    gsap.set(this.stage(), { autoAlpha: 1 });
    this.opts.store.set({ arena: 'hidden' });
  }

  /** Zoom out from the player's seat to all 100 screens (standings). Display only. */
  openArena(seat: number): void {
    if (this.tl) this.skip();
    if (this.opts.store.get().arena !== 'hidden') return;
    this.arenaTl?.kill();
    const arena = this.one('[data-arena]');
    const grid = this.one('[data-arena-grid]');
    const stage = this.stage();
    const fresh = this.all('[data-tile].is-new .tile-x');
    this.opts.store.set({ arena: 'open' });
    const tl = gsap.timeline();
    this.arenaTl = tl;
    const z = this.seatZoom(seat);
    if (this.motion.reduced || !z || !grid) {
      tl.to(stage, { autoAlpha: 0, duration: 0.2 }).to(arena, { autoAlpha: 1, duration: 0.2 }, '<');
      return;
    }
    const chrome = this.all('[data-arena] .arena-chrome');
    tl.set(grid, { ...z, transformOrigin: '0 0' });
    tl.set(chrome, { autoAlpha: 0 });
    if (fresh.length) tl.set(fresh, { autoAlpha: 0, scale: 2.4 });
    tl.to(stage, { autoAlpha: 0, scale: 0.92, duration: 0.3 });
    tl.to(arena, { autoAlpha: 1, duration: 0.25 }, '<0.05');
    tl.to(grid, { x: 0, y: 0, scale: 1, duration: 0.9, ease: 'power3.inOut' }, '<');
    tl.to(chrome, { autoAlpha: 1, duration: 0.25 }, '>-0.15');
    if (fresh.length) {
      tl.to(fresh, { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'power4.in', stagger: 0.12 }, '>-0.05');
      this.cue(tl, 'ko', '<');
    }
  }

  /** Back from the standings to the table. */
  closeArena(seat: number): void {
    if (this.opts.store.get().arena !== 'open') return;
    this.arenaTl?.kill();
    const arena = this.one('[data-arena]');
    const grid = this.one('[data-arena-grid]');
    const stage = this.stage();
    const tl = gsap.timeline({ onComplete: () => this.opts.store.set({ arena: 'hidden' }) });
    this.arenaTl = tl;
    const z = this.seatZoom(seat);
    this.clearMarks();
    if (this.motion.reduced || !z || !grid) {
      tl.to(arena, { autoAlpha: 0, duration: 0.2 }).to(stage, { autoAlpha: 1, scale: 1, duration: 0.2 }, '<');
      return;
    }
    tl.to(this.all('[data-arena] .arena-chrome'), { autoAlpha: 0, duration: 0.15 });
    tl.to(grid, { ...z, duration: 0.7, ease: 'power3.in' }, '<');
    tl.to(arena, { autoAlpha: 0, duration: 0.25 }, '>-0.2');
    tl.to(stage, { autoAlpha: 1, scale: 1, duration: 0.3 }, '<');
    tl.set(grid, { x: 0, y: 0, scale: 1 });
    tl.set(this.all('[data-arena] .arena-chrome'), { autoAlpha: 1 });
  }

  // ---- helpers ---------------------------------------------------------

  private set(tl: Tl, patch: Partial<PresentationState>, at?: gsap.Position) {
    tl.call(() => this.opts.store.set(patch), undefined, at);
  }

  private cue(tl: Tl, id: SoundId, at?: gsap.Position) {
    tl.call(() => this.opts.sound.play(id), undefined, at);
  }

  /** Tween a number in the store (HP, pot, survivors) so text and bars stay in sync. */
  private num(tl: Tl, key: 'playerHp' | 'opponentHp' | 'pot' | 'survivors', from: number, to: number, duration: number, at: gsap.Position) {
    if (from === to) return;
    const o = { v: from };
    const { store } = this.opts;
    tl.to(
      o,
      {
        v: to,
        duration: this.motion.reduced ? Math.min(duration, 0.25) : duration,
        ease: 'power2.out',
        onStart: () => store.set({ [key]: from } as Partial<PresentationState>),
        onUpdate: () => store.set({ [key]: Math.round(o.v) } as Partial<PresentationState>),
      },
      at,
    );
  }

  private fly(tl: Tl, slot: string, at: gsap.Position) {
    const el = this.one(`[data-card="${slot}"]`);
    const off = this.deckOffset.get(slot);
    if (!el || !off) return;
    if (this.motion.reduced) {
      tl.set(el, { x: 0, y: 0, rotation: 0 }, at).to(el, { autoAlpha: 1, duration: 0.15 }, '<');
    } else {
      tl.set(el, { ...off, rotation: (this.rand() - 0.5) * 30, autoAlpha: 1 }, at).to(
        el,
        { x: 0, y: 0, rotation: 0, duration: 0.45, ease: 'power3.out' },
        '<',
      );
    }
    this.cue(tl, 'deal', '<');
  }

  /**
   * Two halves so front and back are never visible together, even where
   * backface-visibility is flaky: swap faces exactly at 90°.
   */
  private flip(tl: Tl, slot: string, at: gsap.Position) {
    const el = this.one(`[data-card="${slot}"]`);
    if (!el) return;
    const half = this.motion.reduced ? 0.001 : 0.18;
    const sub = gsap.timeline();
    sub
      .to(el.querySelector('.card-inner'), { rotationY: 90, duration: half, ease: 'power2.in' })
      .set(el.querySelector('.card-back'), { autoAlpha: 0 })
      .set(el.querySelector('.card-front'), { autoAlpha: 1 })
      .to(el.querySelector('.card-inner'), { rotationY: 180, duration: half, ease: 'power2.out' });
    if (!this.motion.reduced) sub.to(el, { scale: 1.08, duration: half, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 0);
    sub.call(() => this.opts.sound.play('flip', 0.7), undefined, 0);
    tl.add(sub, at);
  }

  /** A few chip tokens travelling between a seat and the pot. */
  private chips(tl: Tl, from: Side | 'pot', to: Side | 'pot', at: string) {
    const anchor = (s: Side | 'pot') => this.one(s === 'pot' ? '[data-pot]' : `[data-avatar="${s}"]`);
    const a = anchor(from);
    const b = anchor(to);
    const stage = this.stage();
    if (!a || !b) return;
    const p = centerOf(a, stage);
    const q = centerOf(b, stage);
    const pool = this.all('[data-chip]');
    const n = this.motion.reduced ? 1 : 3;
    // Use a different slice of the pool for each direction so overlapping flights don't fight.
    const offset = from === 'opponent' || to === 'opponent' ? 4 : 0;
    for (let i = 0; i < n; i++) {
      const chip = pool[(offset + i) % pool.length];
      if (!chip) continue;
      const jx = (this.rand() - 0.5) * 16;
      const jy = (this.rand() - 0.5) * 10;
      tl.set(chip, { x: p.x + jx, y: p.y + jy, scale: 1, autoAlpha: 1 }, `${at}+=${i * 0.06}`);
      tl.to(chip, { x: q.x + jx, y: q.y + jy, duration: this.motion.reduced ? 0.15 : 0.4, ease: 'power2.inOut' }, '<');
      tl.to(chip, { autoAlpha: 0, scale: 0.6, duration: 0.12 }, '>');
    }
    this.cue(tl, 'chips', at);
  }

  private shake(tl: Tl, el: Element | null, amp: number, at: gsap.Position) {
    if (!el) return;
    tl.to(
      el,
      {
        keyframes: [
          { x: -amp, y: amp * 0.3, duration: 0.06 },
          { x: amp, y: -amp * 0.3, duration: 0.06 },
          { x: -amp * 0.5, y: amp * 0.2, duration: 0.06 },
          { x: amp * 0.5, y: 0, duration: 0.06 },
          { x: 0, y: 0, duration: 0.06 },
        ],
        ease: 'none',
      },
      at,
    );
  }

  private flash(tl: Tl, strength: number, at: gsap.Position) {
    const el = this.one('[data-flash]');
    if (!el) return;
    tl.set(el, { autoAlpha: strength }, at).to(el, { autoAlpha: 0, duration: 0.35, ease: 'power2.out' }, '>');
  }

  private burst(tl: Tl, count: number, origin: Element, tier: number, at: gsap.Position) {
    const c = centerOf(origin, this.stage());
    const ps = this.all('[data-particle]').slice(0, count);
    ps.forEach((p, i) => {
      const angle = (i / ps.length) * Math.PI * 2 + this.rand() * 0.5;
      const dist = 60 + this.rand() * (50 + tier * 25);
      tl.set(p, { x: c.x, y: c.y, scale: 0.5 + this.rand() * (0.6 + tier * 0.2), autoAlpha: 1 }, at);
      tl.to(
        p,
        { x: c.x + Math.cos(angle) * dist, y: c.y + Math.sin(angle) * dist, autoAlpha: 0, duration: 0.6 + this.rand() * 0.4, ease: 'power2.out' },
        '<',
      );
    });
  }

  private stage(): HTMLElement {
    return this.opts.root.matches('[data-stage]') ? this.opts.root : (this.one('[data-stage]') ?? this.opts.root);
  }
  private one(sel: string): HTMLElement | null {
    return this.opts.root.querySelector<HTMLElement>(sel);
  }
  private all(sel: string): HTMLElement[] {
    return [...this.opts.root.querySelectorAll<HTMLElement>(sel)];
  }
}

/** Center of an element, in viewport coords or relative to `relativeTo`. */
function centerOf(el: Element, relativeTo?: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const o = relativeTo?.getBoundingClientRect();
  return { x: r.left + r.width / 2 - (o?.left ?? 0), y: r.top + r.height / 2 - (o?.top ?? 0) };
}
