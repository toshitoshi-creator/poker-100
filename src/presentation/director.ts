import gsap from 'gsap';
import type { RoundResult, Side } from '../logic/game';
import { mulberry32 } from '../logic/rng';
import type { SoundBus, SoundId } from '../audio/soundBus';
import type { MotionProfile } from './motion';
import type { PresentationState, Store } from './store';

/**
 * DOM contract (rendered by ui/Table):
 *   [data-stage]                     root, shaken on big hits
 *   [data-deck]                      where cards fly from
 *   [data-card="p0|p1|o0|o1|b0..b4"] card wrapper (moves), with data-card-id
 *     .card-inner / .card-back / .card-front / .card-glow
 *   [data-seat=side] [data-avatar=side] [data-hp=side] [data-label=side]
 *   [data-ko=side] [data-dmg=side]
 *   [data-banner] [data-flash] [data-projectile] [data-particle]×N
 */
export interface Presenter {
  play(result: RoundResult): void;
  skip(): void;
  isPlaying(): boolean;
  reset(): void;
}

export const PARTICLE_POOL = 28;

const TIER_FX = [
  { particles: 0, shake: 0, flash: 0, hold: 0.7 },
  { particles: 8, shake: 0, flash: 0, hold: 0.8 },
  { particles: 14, shake: 4, flash: 0, hold: 0.95 },
  { particles: 20, shake: 7, flash: 0.25, hold: 1.1 },
  { particles: 28, shake: 12, flash: 0.6, hold: 1.4 },
] as const;

const DEAL_ORDER = ['p0', 'o0', 'p1', 'o1'] as const;

export interface DirectorOptions {
  root: HTMLElement;
  store: Store<PresentationState>;
  sound: SoundBus;
  motion: MotionProfile;
}

export class Director implements Presenter {
  private tl: gsap.core.Timeline | null = null;
  private current: RoundResult | null = null;
  private motion: MotionProfile;

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

  /** Jump to the end: every tween's end state is applied, callbacks are suppressed. */
  skip(): void {
    const tl = this.tl;
    const result = this.current;
    if (!tl || !result) return;
    this.tl = null;
    tl.progress(1, true);
    tl.kill();
    this.finalize(result);
  }

  /** Remove every inline style the Director put on long-lived elements. */
  reset(): void {
    this.tl?.kill();
    this.tl = null;
    this.current = null;
    const els = this.all(
      '[data-stage], [data-seat], [data-avatar], [data-label], [data-ko], [data-dmg], [data-banner], [data-flash], [data-projectile], [data-particle]',
    );
    if (els.length) gsap.set(els, { clearProps: 'all' });
    if (this.opts.root.matches('[data-stage]')) gsap.set(this.opts.root, { clearProps: 'all' });
  }

  play(result: RoundResult): void {
    if (this.tl) this.skip();
    this.current = result;
    const { store, sound } = this.opts;
    const R = this.motion.reduced;
    const rand = mulberry32(result.seed ^ 0x5eed); // cosmetic only
    const fx = TIER_FX[result.tier];

    store.set({
      round: result.round,
      phase: 'deal',
      playing: true,
      settled: false,
      playerHp: result.player.before.hp,
      opponentHp: result.opponent.before.hp,
      survivors: result.survivors.before,
    });

    // ---- initial state -------------------------------------------------
    const stage = this.stage();
    const deck = this.one('[data-deck]');
    const slots = [...DEAL_ORDER, 'b0', 'b1', 'b2', 'b3', 'b4'];
    const cards = new Map(slots.map((s) => [s, this.one(`[data-card="${s}"]`)]));
    const cardEls = [...cards.values()].filter(Boolean) as HTMLElement[];

    gsap.set(stage, { x: 0, y: 0 });
    gsap.set(this.all('[data-seat]'), { x: 0, y: 0 });
    gsap.set(cardEls, { x: 0, y: 0, rotation: 0, scale: 1, autoAlpha: 1 });
    gsap.set(this.all('[data-card] .card-inner'), { rotationY: 0 });
    gsap.set(this.all('[data-card] .card-back'), { autoAlpha: 1 });
    gsap.set(this.all('[data-card] .card-front'), { autoAlpha: 0 });
    gsap.set(this.all('[data-card] .card-glow'), { autoAlpha: 0 });
    gsap.set(this.all('[data-avatar]'), { autoAlpha: 1, y: 0, rotation: 0, scale: 1 });
    gsap.set(this.all('[data-label], [data-ko], [data-dmg], [data-projectile], [data-particle], [data-banner]'), {
      autoAlpha: 0,
    });
    gsap.set(this.all('[data-flash]'), { autoAlpha: 0 });

    // Measure deck → slot offsets after transforms are reset.
    const deckC = deck ? centerOf(deck) : { x: 0, y: 0 };
    for (const el of cardEls) {
      const c = centerOf(el);
      gsap.set(el, {
        x: deckC.x - c.x,
        y: deckC.y - c.y,
        rotation: R ? 0 : (rand() - 0.5) * 30,
        autoAlpha: 0,
      });
    }

    // ---- timeline ------------------------------------------------------
    const tl = gsap.timeline({ onComplete: () => this.complete(tl, result) });
    tl.timeScale(this.motion.speed);
    this.tl = tl;
    const cue = (id: SoundId, at?: gsap.Position, vol = 1) => tl.call(() => sound.play(id, vol), undefined, at);
    const phase = (p: PresentationState['phase'], at?: gsap.Position) =>
      tl.call(() => store.set({ phase: p }), undefined, at);

    const fly = (slot: string, at: gsap.Position) => {
      const el = cards.get(slot);
      if (!el) return;
      if (R) {
        tl.set(el, { x: 0, y: 0, rotation: 0 }, at).to(el, { autoAlpha: 1, duration: 0.15 }, '<');
      } else {
        tl.set(el, { autoAlpha: 1 }, at).to(el, { x: 0, y: 0, rotation: 0, duration: 0.45, ease: 'power3.out' }, '<');
      }
      cue('deal', '<');
    };

    // Two halves so front and back are never visible together, even where
    // backface-visibility is flaky: swap faces exactly at 90°.
    const flip = (slot: string, at: gsap.Position) => {
      const el = cards.get(slot);
      if (!el) return;
      const inner = el.querySelector('.card-inner');
      const back = el.querySelector('.card-back');
      const front = el.querySelector('.card-front');
      const half = R ? 0.001 : 0.18;
      const sub = gsap.timeline();
      sub
        .to(inner, { rotationY: 90, duration: half, ease: 'power2.in' })
        .set(back, { autoAlpha: 0 })
        .set(front, { autoAlpha: 1 })
        .to(inner, { rotationY: 180, duration: half, ease: 'power2.out' });
      if (!R) sub.to(el, { scale: 1.08, duration: half, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 0);
      sub.call(() => sound.play('flip', 0.7), undefined, 0);
      tl.add(sub, at);
    };

    // Deal hole cards one by one
    DEAL_ORDER.forEach((s, i) => fly(s, 0.1 + i * 0.14));
    tl.addLabel('holeFlip', '+=0.15');
    flip('p0', 'holeFlip');
    flip('p1', 'holeFlip+=0.12');

    // Flop
    tl.addLabel('flop', '+=0.35');
    phase('flop', 'flop');
    ['b0', 'b1', 'b2'].forEach((s, i) => fly(s, `flop+=${i * 0.12}`));
    tl.addLabel('flopFlip', '+=0.1');
    ['b0', 'b1', 'b2'].forEach((s, i) => flip(s, `flopFlip+=${i * 0.12}`));

    // Turn
    tl.addLabel('turn', '+=0.45');
    phase('turn', 'turn');
    fly('b3', 'turn');
    flip('b3', '+=0.08');

    // River (a beat longer for suspense)
    tl.addLabel('river', '+=0.6');
    phase('river', 'river');
    fly('b4', 'river');
    flip('b4', '+=0.15');

    // Showdown
    tl.addLabel('showdown', '+=0.5');
    phase('showdown', 'showdown');
    cue('reveal', 'showdown');
    flip('o0', 'showdown');
    flip('o1', 'showdown+=0.1');
    tl.to(this.all('[data-label]'), { autoAlpha: 1, duration: 0.25 }, '+=0.1');

    // Hand complete: emphasise the featured five, dim the rest
    tl.addLabel('hand', '+=0.25');
    const featured = new Set(result.featuredHand.cards.map((c) => c.id));
    const hi = cardEls.filter((el) => featured.has(el.dataset.cardId ?? ''));
    const lo = cardEls.filter((el) => !featured.has(el.dataset.cardId ?? ''));
    tl.to(lo, { autoAlpha: 0.4, duration: 0.3 }, 'hand');
    tl.to(hi, { y: R ? 0 : -10, duration: 0.3, ease: 'back.out(2)', stagger: 0.05 }, 'hand');
    tl.to(hi.map((el) => el.querySelector('.card-glow')).filter(Boolean), { autoAlpha: 1, duration: 0.3, stagger: 0.05 }, 'hand');
    cue(result.tier >= 4 ? 'handLegendary' : result.tier >= 2 ? 'handMajor' : 'handMinor', 'hand');

    const banner = this.one('[data-banner]');
    if (banner) {
      tl.set(banner, { scale: R ? 1 : 0.6 + result.tier * 0.05 }, 'hand+=0.15');
      tl.to(banner, { autoAlpha: 1, scale: 1, duration: R ? 0.15 : 0.4, ease: 'back.out(2.2)' }, '<');
    }
    if (!R) {
      if (fx.flash > 0) this.flash(tl, fx.flash, 'hand+=0.15');
      if (fx.shake > 0) this.shake(tl, stage, fx.shake, 'hand+=0.15');
      if (fx.particles > 0) this.burst(tl, fx.particles, banner ?? stage, rand, result.tier, 'hand+=0.15');
    }
    tl.addLabel('handEnd', `hand+=${0.4 + fx.hold}`);
    if (banner) tl.to(banner, { autoAlpha: 0, scale: R ? 1 : 1.1, duration: 0.25 }, 'handEnd');

    // Attack → hit → HP → KO
    const atk = result.attack;
    if (atk) {
      tl.addLabel('attack', 'handEnd+=0.1');
      phase('attack', 'attack');
      cue('attack', 'attack');
      const hpEl = this.one(`[data-hp="${atk.target}"]`);
      const proj = this.one('[data-projectile]');
      const from = this.one(`[data-avatar="${atk.attacker}"]`);
      if (!R && proj && hpEl && from) {
        const a = centerOf(from, stage);
        const b = centerOf(hpEl, stage);
        const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        tl.set(proj, { x: a.x, y: a.y, rotation: angle, scale: 0.6 + result.tier * 0.15, autoAlpha: 1 }, 'attack');
        tl.to(proj, { x: b.x, y: b.y, duration: 0.45, ease: 'power2.in' }, '>');
        tl.set(proj, { autoAlpha: 0 }, '>');
      }
      tl.addLabel('hit', '>');
      cue('hit', 'hit');
      const seat = this.one(`[data-seat="${atk.target}"]`);
      if (!R && seat) this.shake(tl, seat, 6 + result.tier * 2, 'hit');
      if (!R) this.flash(tl, 0.15, 'hit');
      const dmg = this.one(`[data-dmg="${atk.target}"]`);
      if (dmg) {
        tl.set(dmg, { y: 0, scale: R ? 1 : 1.6, autoAlpha: 1 }, 'hit');
        tl.to(dmg, { scale: 1, duration: 0.2, ease: 'power2.out' }, 'hit');
        tl.to(dmg, { y: R ? 0 : -24, autoAlpha: 0, duration: 0.5, ease: 'power1.in' }, 'hit+=0.7');
      }
      const key = atk.target === 'player' ? 'playerHp' : 'opponentHp';
      const hp = { v: atk.hp.before };
      tl.to(
        hp,
        {
          v: atk.hp.after,
          duration: R ? 0.3 : 0.7,
          ease: 'power2.out',
          onUpdate: () => store.set({ [key]: Math.round(hp.v) } as Partial<PresentationState>),
        },
        'hit',
      );

      if (atk.hp.eliminated) this.knockOut(tl, atk.target, cue, R);
    }

    // Survivors counter
    if (result.survivors.after !== result.survivors.before) {
      const sv = { v: result.survivors.before };
      tl.to(sv, {
        v: result.survivors.after,
        duration: R ? 0.2 : 0.6,
        ease: 'power1.out',
        onUpdate: () => store.set({ survivors: Math.round(sv.v) }),
      }, '+=0.1');
    }
    if (result.statusAfter === 'won') cue('win');
    if (result.statusAfter === 'lost') cue('lose');
    tl.to({}, { duration: 0.2 }); // tail so the last frame is visible
  }

  // ---- helpers ---------------------------------------------------------

  private knockOut(
    tl: gsap.core.Timeline,
    side: Side,
    cue: (id: SoundId, at?: gsap.Position) => gsap.core.Timeline,
    R: boolean,
  ) {
    tl.addLabel('ko', '+=0.25');
    cue('ko', 'ko');
    const avatar = this.one(`[data-avatar="${side}"]`);
    const stamp = this.one(`[data-ko="${side}"]`);
    if (avatar) tl.to(avatar, { autoAlpha: 0.3, y: R ? 0 : 8, rotation: R ? 0 : -8, duration: 0.5, ease: 'power2.in' }, 'ko');
    if (stamp) {
      tl.set(stamp, { scale: R ? 1 : 2.4, rotation: -12 }, 'ko');
      tl.to(stamp, { autoAlpha: 1, scale: 1, duration: R ? 0.15 : 0.35, ease: 'power4.in' }, 'ko+=0.2');
    }
    if (!R) this.shake(tl, this.stage(), 10, 'ko+=0.55');
  }

  private shake(tl: gsap.core.Timeline, el: Element, amp: number, at: gsap.Position) {
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

  private flash(tl: gsap.core.Timeline, strength: number, at: gsap.Position) {
    const el = this.one('[data-flash]');
    if (!el) return;
    tl.set(el, { autoAlpha: strength }, at).to(el, { autoAlpha: 0, duration: 0.35, ease: 'power2.out' }, '>');
  }

  private burst(tl: gsap.core.Timeline, count: number, origin: Element, rand: () => number, tier: number, at: gsap.Position) {
    const stage = this.stage();
    const c = centerOf(origin, stage);
    const ps = this.all('[data-particle]').slice(0, count);
    ps.forEach((p, i) => {
      const angle = (i / ps.length) * Math.PI * 2 + rand() * 0.5;
      const dist = 60 + rand() * (50 + tier * 25);
      tl.set(p, { x: c.x, y: c.y, scale: 0.5 + rand() * (0.6 + tier * 0.2), autoAlpha: 1 }, at);
      tl.to(
        p,
        { x: c.x + Math.cos(angle) * dist, y: c.y + Math.sin(angle) * dist, autoAlpha: 0, duration: 0.6 + rand() * 0.4, ease: 'power2.out' },
        '<',
      );
    });
  }

  private complete(tl: gsap.core.Timeline, result: RoundResult) {
    if (this.tl !== tl) return;
    this.tl = null;
    this.finalize(result);
  }

  /** Make the store match the decided result regardless of how playback ended. */
  private finalize(result: RoundResult) {
    this.opts.store.set({
      round: result.round,
      phase: 'result',
      playing: false,
      settled: true,
      playerHp: result.player.after.hp,
      opponentHp: result.opponent.after.hp,
      survivors: result.survivors.after,
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
