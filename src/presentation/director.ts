import gsap from 'gsap';
import { MAX_TABLE_SIZE, type GameEvent, type RoundResult } from '../logic/game';
import { mulberry32 } from '../logic/rng';
import type { SoundBus, SoundId } from '../audio/soundBus';
import type { MotionProfile } from './motion';
import type { PresentationState, Store } from './store';
import { isLobby, reduceView, viewAt, type TableView } from './view';

/**
 * DOM contract (rendered by ui/Table, seat = table seat 0..5, 0 = you):
 *   [data-stage]                         root, shaken on big hits
 *   [data-deck] [data-pot]               where cards / chips travel from and to
 *   [data-card="h{seat}-{0|1}" | "b0..b4"] card wrapper (moves), with data-card-id
 *     .card-inner / .card-back / .card-front / .card-glow
 *   [data-seat] [data-avatar] [data-hp] [data-bet] [data-label] [data-ko] [data-dmg] [data-gain]  (= seat)
 *   [data-banner] [data-flash] [data-projectile]×N [data-particle]×N [data-chip]×N
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
/** Three chip tokens per seat lane, so simultaneous flights never share a token. */
export const CHIP_POOL = MAX_TABLE_SIZE * 3;
export const PROJECTILE_POOL = MAX_TABLE_SIZE;

const TIER_FX = [
  { particles: 0, shake: 0, flash: 0, hold: 0.7 },
  { particles: 8, shake: 0, flash: 0, hold: 0.8 },
  { particles: 14, shake: 4, flash: 0, hold: 0.95 },
  { particles: 20, shake: 7, flash: 0.25, hold: 1.1 },
  { particles: 28, shake: 12, flash: 0.6, hold: 1.4 },
] as const;

/** Seat indices of a view (2 or 6 seats). */
const seatsOf = (v: { hp: number[] }) => v.hp.map((_, i) => i);
const hole = (seat: number, k: number) => `h${seat}-${k}`;

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
  private label = 0;

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
    this.opts.store.set({ playing: false, active: -1 });
  }

  show(view: TableView): void {
    this.tl?.kill();
    this.tl = null;
    this.final = view;
    this.snap(view);
    this.opts.store.set({ playing: false, active: -1 });
  }

  /** Remove every inline style the Director put on long-lived elements. */
  reset(): void {
    this.tl?.kill();
    this.tl = null;
    this.final = null;
    this.arenaTl?.kill();
    this.arenaTl = null;
    const els = this.all(
      '[data-seat], [data-avatar], [data-label], [data-ko], [data-dmg], [data-gain], [data-banner], [data-flash], [data-projectile], [data-particle], [data-chip], [data-arena], [data-arena-grid], [data-tile] .tile-x',
    );
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
      if (opts.intro !== false) this.intro(tl, start.seats[0]!.seat);
      else this.leaveArenaNow();
    }
    for (let i = from; i < log.length; i++) {
      const next = reduceView(view, log[i]!);
      this.animate(tl, log[i]!, view, next);
      view = next;
    }
    this.set(tl, { active: -1 });
    tl.to({}, { duration: 0.15 }); // tail so the last frame is visible
  }

  private complete(tl: Tl) {
    if (this.tl !== tl) return;
    this.tl = null;
    if (this.final) this.snap(this.final);
    this.opts.store.set({ playing: false, active: -1 });
  }

  // ---- static state ----------------------------------------------------

  /** Put every element exactly where `v` says, and sync the store. */
  private snap(v: TableView): void {
    const { store } = this.opts;
    store.set({
      round: v.round,
      phase: v.phase,
      hp: v.hp,
      bets: v.bets,
      say: v.say,
      pot: v.pot,
      survivors: v.survivors,
      button: v.button,
    });

    const lobby = isLobby(v);
    this.arenaTl?.kill();
    this.arenaTl = null;
    gsap.set(this.all('[data-arena-grid]'), { x: 0, y: 0, scale: 1, transformOrigin: '0 0' });
    gsap.set(this.all('[data-arena]'), { autoAlpha: lobby ? 1 : 0 });
    gsap.set(this.all('[data-arena] .arena-chrome'), { autoAlpha: 1 });
    this.clearMarks();
    store.set({ arena: lobby ? 'lobby' : 'hidden' });
    gsap.set(this.stage(), { x: 0, y: 0, scale: 1, autoAlpha: lobby ? 0 : 1 });
    gsap.set(this.all('[data-seat]'), { x: 0, y: 0, scale: 1, autoAlpha: 1 });
    gsap.set(this.all('[data-label], [data-dmg], [data-gain], [data-banner], [data-flash], [data-projectile], [data-particle], [data-chip]'), {
      autoAlpha: 0,
    });

    const cards: [string, HTMLElement][] = [];
    for (const el of this.all('[data-card]')) cards.push([el.dataset.card!, el]);
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
      const seat = isBoard ? -1 : Number(slot.slice(1, slot.indexOf('-')));
      const shown = v.dealt && (isBoard ? Number(slot.slice(1)) < v.boardShown : true);
      const faceUp = shown && (isBoard || v.revealed[seat]!);
      const off = this.deckOffset.get(slot)!;
      const folded = seat >= 0 && v.folded[seat]!;
      const hi = featured.has(el.dataset.cardId ?? '');
      gsap.set(el, shown ? { autoAlpha: folded || (r && !hi) ? 0.35 : 1, y: hi ? -8 : 0 } : { ...off, autoAlpha: 0 });
      this.setFace(el, faceUp);
      gsap.set(el.querySelector('.card-glow'), { autoAlpha: hi ? 1 : 0 });
    }

    if (r) for (const s of r.showdown) gsap.set(this.all(`[data-label="${s}"]`), { autoAlpha: 1 });
    for (const seat of seatsOf(v)) {
      const out = !!v.result?.eliminated.includes(seat);
      gsap.set(this.all(`[data-avatar="${seat}"]`), out ? { autoAlpha: 0.35, y: 4, rotation: -6, scale: 1 } : { autoAlpha: 1, y: 0, rotation: 0, scale: 1 });
      gsap.set(this.all(`[data-ko="${seat}"]`), out ? { autoAlpha: 1, scale: 1, rotation: -12 } : { autoAlpha: 0 });
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
    const L = (name: string) => `${name}${++this.label}`;
    switch (e.t) {
      case 'start': {
        const at = L('start');
        tl.addLabel(at);
        this.set(tl, { phase: 'deal', round: e.round, survivors: e.survivors, button: e.button }, at);
        // Newcomers take their seats.
        for (const s of e.joined) {
          const el = this.one(`[data-seat="${s}"]`);
          if (el && !R) {
            tl.set(el, { autoAlpha: 0, scale: 0.7 }, at);
            tl.to(el, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }, `${at}+=0.05`);
          }
        }
        // Blinds
        for (const b of e.blinds) {
          this.chips(tl, b.seat, `bet:${b.seat}`, `${at}+=0.2`);
          this.numAt(tl, 'hp', b.seat, before.hp[b.seat]!, after.hp[b.seat]!, 0.3, `${at}+=0.3`);
        }
        this.set(tl, { bets: after.bets, say: after.say }, `${at}+=0.3`);
        // Deal two rounds, one card at a time, starting left of the button.
        const order = e.seats.map((_, k) => (e.button + 1 + k) % e.seats.length).filter((s) => e.seats[s] && e.seats[s]!.hp > 0);
        let n = 0;
        for (const k of [0, 1]) for (const s of order) this.fly(tl, hole(s, k), `${at}+=${0.5 + n++ * 0.08}`, 0.35);
        const flipAt = L('holeFlip');
        tl.addLabel(flipAt, '+=0.1');
        this.flip(tl, hole(0, 0), flipAt);
        this.flip(tl, hole(0, 1), `${flipAt}+=0.12`);
        this.set(tl, { phase: 'preflop' });
        return;
      }
      case 'act': {
        const at = L('act');
        tl.addLabel(at, '+=0.05');
        this.set(tl, { active: e.seat, say: after.say }, at);
        if (e.kind === 'fold') {
          this.cue(tl, 'fold', at);
          const els = [0, 1].map((k) => this.one(`[data-card="${hole(e.seat, k)}"]`)).filter(Boolean);
          tl.to(els, { autoAlpha: 0.35, y: R ? 0 : 6, duration: 0.25 }, at);
          tl.to(els, { y: 0, duration: 0.15 });
          if (e.penalty) {
            // Folding hurts: the fold penalty comes straight off HP.
            this.cue(tl, 'hit', at);
            this.numAt(tl, 'hp', e.seat, before.hp[e.seat]!, after.hp[e.seat]!, 0.4, `${at}+=0.1`);
            if (!R) this.shake(tl, this.one(`[data-seat="${e.seat}"]`), 4, `${at}+=0.1`);
            tl.to({}, { duration: R ? 0.1 : 0.3 });
          }
        } else if (e.kind === 'check') {
          this.cue(tl, 'check', at);
          tl.to({}, { duration: R ? 0.1 : 0.3 }, at);
        } else {
          this.chips(tl, e.seat, `bet:${e.seat}`, at);
          this.numAt(tl, 'hp', e.seat, before.hp[e.seat]!, after.hp[e.seat]!, 0.3, `${at}+=0.1`);
          this.numAt(tl, 'bets', e.seat, before.bets[e.seat]!, after.bets[e.seat]!, 0.3, `${at}+=0.1`);
          if (e.allIn && !R) {
            this.shake(tl, this.one(`[data-seat="${e.seat}"]`), 5, `${at}+=0.15`);
            this.flash(tl, 0.1, `${at}+=0.15`);
          }
          tl.to({}, { duration: R ? 0.1 : 0.25 });
        }
        return;
      }
      case 'street': {
        const at = L('street');
        tl.addLabel(at, '+=0.2');
        this.sweep(tl, before, after, at);
        this.set(tl, { phase: e.street, active: -1 }, at);
        const slots = e.street === 'flop' ? ['b0', 'b1', 'b2'] : e.street === 'turn' ? ['b3'] : ['b4'];
        const dealAt = `${at}+=0.45`;
        slots.forEach((s, i) => this.fly(tl, s, `${dealAt}+=${i * 0.12}`));
        const flipAt = L('flip');
        tl.addLabel(flipAt, `${dealAt}+=${slots.length * 0.12 + 0.35}`);
        slots.forEach((s, i) => this.flip(tl, s, `${flipAt}+=${i * 0.12}`));
        if (e.street === 'river') tl.to({}, { duration: 0.2 }); // a beat for suspense
        return;
      }
      case 'showdown': {
        const at = L('showdown');
        tl.addLabel(at, '+=0.35');
        this.sweep(tl, before, after, at);
        this.set(tl, { phase: 'showdown', active: -1 }, at);
        this.cue(tl, 'reveal', at);
        e.seats.filter((s) => s !== 0).forEach((s, i) => {
          this.flip(tl, hole(s, 0), `${at}+=${0.4 + i * 0.18}`);
          this.flip(tl, hole(s, 1), `${at}+=${0.48 + i * 0.18}`);
        });
        tl.to(e.seats.flatMap((s) => this.all(`[data-label="${s}"]`)), { autoAlpha: 1, duration: 0.25 }, '+=0.1');
        return;
      }
      case 'award':
        this.award(tl, e.result, before);
        return;
    }
  }

  /** Bets in front of the seats slide into the middle. */
  private sweep(tl: Tl, before: TableView, after: TableView, at: string) {
    const betting = seatsOf(before).filter((s) => before.bets[s]! > 0);
    if (!betting.length) return;
    for (const s of betting) this.chips(tl, `bet:${s}`, 'pot', at, s);
    this.set(tl, { bets: after.bets, say: after.say }, `${at}+=0.3`);
    this.num(tl, 'pot', before.pot, after.pot, 0.35, `${at}+=0.25`);
  }

  private award(tl: Tl, r: RoundResult, before: TableView) {
    const R = this.motion.reduced;
    const fx = TIER_FX[r.tier];
    const stage = this.stage();
    const hand = `hand${++this.label}`;
    tl.addLabel(hand, '+=0.25');
    this.set(tl, { phase: 'result', active: -1 }, hand);
    // Uncalled bets (everyone folded) still sit in front of seats: gather them first.
    this.sweep(tl, before, { ...before, bets: before.bets.map(() => 0), pot: before.pot + before.bets.reduce((a, b) => a + b, 0) }, hand);

    if (r.featuredHand) {
      const featured = new Set(r.featuredHand.cards.map((c) => c.id));
      const cards = this.all('[data-card]');
      const hi = cards.filter((el) => featured.has(el.dataset.cardId ?? ''));
      const lo = cards.filter((el) => !featured.has(el.dataset.cardId ?? ''));
      tl.to(lo, { autoAlpha: 0.35, duration: 0.3 }, `${hand}+=0.3`);
      tl.to(hi, { y: R ? 0 : -8, duration: 0.3, ease: 'back.out(2)', stagger: 0.05 }, `${hand}+=0.3`);
      tl.to(hi.map((el) => el.querySelector('.card-glow')).filter(Boolean), { autoAlpha: 1, duration: 0.3, stagger: 0.05 }, `${hand}+=0.3`);
      this.cue(tl, r.tier >= 4 ? 'handLegendary' : r.tier >= 2 ? 'handMajor' : 'handMinor', `${hand}+=0.3`);
    }
    const banner = this.one('[data-banner]');
    if (banner) {
      tl.set(banner, { scale: R ? 1 : 0.6 + r.tier * 0.05 }, `${hand}+=0.45`);
      tl.to(banner, { autoAlpha: 1, scale: 1, duration: R ? 0.15 : 0.4, ease: 'back.out(2.2)' }, '<');
    }
    if (!R) {
      if (fx.flash > 0) this.flash(tl, fx.flash, `${hand}+=0.45`);
      if (fx.shake > 0) this.shake(tl, stage, fx.shake, `${hand}+=0.45`);
      if (fx.particles > 0) this.burst(tl, fx.particles, banner ?? stage, r.tier, `${hand}+=0.45`);
    }
    const handEnd = `handEnd${++this.label}`;
    tl.addLabel(handEnd, `${hand}+=${0.7 + (r.featuredHand ? fx.hold : 0.4)}`);
    if (banner) tl.to(banner, { autoAlpha: 0, scale: R ? 1 : 1.1, duration: 0.25 }, handEnd);

    // Pots → winners
    const pay = `pay${++this.label}`;
    tl.addLabel(pay, `${handEnd}+=0.15`);
    this.cue(tl, 'chips', pay);
    const hp = [...before.hp];
    for (const s of seatsOf(before)) {
      const won = r.payout[s]!;
      if (!won) continue;
      this.chips(tl, 'pot', s, pay, s);
      this.numAt(tl, 'hp', s, hp[s]!, hp[s]! + won, 0.5, `${pay}+=0.3`);
      hp[s]! += won;
      const pop = this.one(`[data-gain="${s}"]`);
      if (pop) {
        tl.set(pop, { y: 0, autoAlpha: 1, scale: R ? 1 : 1.4 }, `${pay}+=0.35`);
        tl.to(pop, { scale: 1, duration: 0.2 }, `${pay}+=0.35`);
        tl.to(pop, { y: R ? 0 : -18, autoAlpha: 0, duration: 0.5 }, `${pay}+=1.05`);
      }
    }
    this.num(tl, 'pot', before.pot + before.bets.reduce((a, b) => a + b, 0), 0, 0.5, `${pay}+=0.3`);

    // Hand bonus: the best hand strikes everyone else who showed down.
    const targets = seatsOf(before).filter((s) => r.bonus[s]! > 0);
    if (targets.length) {
      const atk = `attack${++this.label}`;
      tl.addLabel(atk, `${pay}+=0.9`);
      this.cue(tl, 'attack', atk);
      const from = this.one(`[data-avatar="${r.featuredSeat}"]`);
      const projectiles = this.all('[data-projectile]');
      const hit = `hit${++this.label}`;
      tl.addLabel(hit, `${atk}+=${R ? 0 : 0.45}`);
      targets.forEach((s, i) => {
        const hpEl = this.one(`[data-hp="${s}"]`);
        const proj = projectiles[i];
        if (!R && proj && hpEl && from) {
          const a = centerOf(from, stage);
          const b = centerOf(hpEl, stage);
          const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          tl.set(proj, { x: a.x, y: a.y, rotation: angle, scale: 0.6 + r.tier * 0.12, autoAlpha: 1 }, `${atk}+=${i * 0.06}`);
          tl.to(proj, { x: b.x, y: b.y, duration: 0.4, ease: 'power2.in' }, '<');
          tl.set(proj, { autoAlpha: 0 }, '>');
        }
        const seat = this.one(`[data-seat="${s}"]`);
        if (!R && seat) this.shake(tl, seat, 5 + r.tier * 2, `${hit}+=${i * 0.06}`);
        const dmg = this.one(`[data-dmg="${s}"]`);
        if (dmg) {
          tl.set(dmg, { y: 0, scale: R ? 1 : 1.6, autoAlpha: 1 }, `${hit}+=${i * 0.06}`);
          tl.to(dmg, { scale: 1, duration: 0.2, ease: 'power2.out' }, '<');
          tl.to(dmg, { y: R ? 0 : -20, autoAlpha: 0, duration: 0.5, ease: 'power1.in' }, `${hit}+=${0.7 + i * 0.06}`);
        }
        this.numAt(tl, 'hp', s, hp[s]!, hp[s]! - r.bonus[s]!, R ? 0.3 : 0.6, `${hit}+=${i * 0.06}`);
      });
      this.cue(tl, 'hit', hit);
      if (!R) this.flash(tl, 0.15, hit);
    }

    if (r.eliminated.length) {
      const ko = `ko${++this.label}`;
      tl.addLabel(ko, '+=0.25');
      this.cue(tl, 'ko', ko);
      r.eliminated.forEach((s, i) => {
        const avatar = this.one(`[data-avatar="${s}"]`);
        const stamp = this.one(`[data-ko="${s}"]`);
        const at = `${ko}+=${i * 0.2}`;
        if (avatar) tl.to(avatar, { autoAlpha: 0.35, y: R ? 0 : 4, rotation: R ? 0 : -6, duration: 0.45, ease: 'power2.in' }, at);
        if (stamp) {
          tl.set(stamp, { scale: R ? 1 : 2.4, rotation: -12 }, at);
          tl.to(stamp, { autoAlpha: 1, scale: 1, duration: R ? 0.15 : 0.35, ease: 'power4.in' }, `${at}+=0.2`);
        }
      });
      if (!R) this.shake(tl, stage, 8, `${ko}+=0.5`);
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

  /** Tween a number in the store (pot, survivors) so text and bars stay in sync. */
  private num(tl: Tl, key: 'pot' | 'survivors', from: number, to: number, duration: number, at: gsap.Position) {
    if (from === to) return;
    const o = { v: from };
    const { store } = this.opts;
    tl.to(
      o,
      {
        v: to,
        duration: this.motion.reduced ? Math.min(duration, 0.25) : duration,
        ease: 'power2.out',
        onStart: () => store.set({ [key]: from }),
        onUpdate: () => store.set({ [key]: Math.round(o.v) }),
      },
      at,
    );
  }

  /** Same, for one seat of a per-seat array (HP, bets). */
  private numAt(tl: Tl, key: 'hp' | 'bets', seat: number, from: number, to: number, duration: number, at: gsap.Position) {
    if (from === to) return;
    const o = { v: from };
    const { store } = this.opts;
    const put = (v: number) => {
      const arr = [...store.get()[key]];
      arr[seat] = v;
      store.set({ [key]: arr });
    };
    tl.to(
      o,
      {
        v: to,
        duration: this.motion.reduced ? Math.min(duration, 0.25) : duration,
        ease: 'power2.out',
        onStart: () => put(from),
        onUpdate: () => put(Math.round(o.v)),
      },
      at,
    );
  }

  private fly(tl: Tl, slot: string, at: gsap.Position, duration = 0.45) {
    const el = this.one(`[data-card="${slot}"]`);
    const off = this.deckOffset.get(slot);
    if (!el || !off) return;
    if (this.motion.reduced) {
      tl.set(el, { x: 0, y: 0, rotation: 0 }, at).to(el, { autoAlpha: 1, duration: 0.15 }, '<');
    } else {
      tl.set(el, { ...off, rotation: (this.rand() - 0.5) * 30, autoAlpha: 1 }, at).to(
        el,
        { x: 0, y: 0, rotation: 0, duration, ease: 'power3.out' },
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

  /**
   * A few chip tokens travelling between anchors: a seat number is its avatar,
   * `bet:N` the chips in front of seat N, `pot` the middle.
   */
  private chips(tl: Tl, from: number | string, to: number | string, at: string, lane?: number) {
    const anchor = (s: number | string) =>
      this.one(typeof s === 'number' ? `[data-avatar="${s}"]` : s === 'pot' ? '[data-pot]' : `[data-bet="${s.slice(4)}"]`);
    const a = anchor(from);
    const b = anchor(to);
    const stage = this.stage();
    if (!a || !b) return;
    const p = centerOf(a, stage);
    const q = centerOf(b, stage);
    const pool = this.all('[data-chip]');
    const seat = lane ?? (typeof from === 'number' ? from : typeof to === 'number' ? to : Number(String(from).slice(4)));
    const n = this.motion.reduced ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const chip = pool[(seat * 3 + i) % pool.length];
      if (!chip) continue;
      const jx = (this.rand() - 0.5) * 12;
      const jy = (this.rand() - 0.5) * 8;
      tl.set(chip, { x: p.x + jx, y: p.y + jy, scale: 1, autoAlpha: 1 }, `${at}+=${i * 0.05}`);
      tl.to(chip, { x: q.x + jx, y: q.y + jy, duration: this.motion.reduced ? 0.15 : 0.35, ease: 'power2.inOut' }, '<');
      tl.to(chip, { autoAlpha: 0, scale: 0.6, duration: 0.1 }, '>');
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
