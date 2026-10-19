import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createSoundBus, registerAudioFiles } from './audio/soundBus';
import { SOUND_FILES } from './audio/soundMap';
import { GameController } from './game/controller';
import type { GameState } from './logic/game';
import { Director } from './presentation/director';
import { prefersReducedMotion, watchReducedMotion } from './presentation/motion';
import { createStore, useStore, type PresentationState } from './presentation/store';
import { currentLog, idleView } from './presentation/view';
import { Arena } from './ui/Arena';
import { Controls } from './ui/Controls';
import { Hud } from './ui/Hud';
import { Table } from './ui/Table';

function initialPresentation(g: GameState): PresentationState {
  const v = idleView(g);
  return {
    phase: v.phase,
    playerHp: v.playerHp,
    opponentHp: v.opponentHp,
    pot: 0,
    survivors: v.survivors,
    sayPlayer: '',
    sayOpponent: '',
    round: v.round,
    playing: false,
    arena: 'lobby',
  };
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

export function readSeedFromUrl(): number | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get('seed');
  return v !== null && /^\d+$/.test(v) ? Number(v) >>> 0 : null;
}

export function App({ seed: initialSeed }: { seed?: number }) {
  const [seed, setSeed] = useState(() => initialSeed ?? readSeedFromUrl() ?? randomSeed());
  const controller = useMemo(() => new GameController(seed), []); // eslint-disable-line react-hooks/exhaustive-deps
  const store = useMemo(() => createStore<PresentationState>(initialPresentation(controller.getState())), [controller]);
  const sound = useMemo(() => {
    const bus = createSoundBus();
    if (typeof Audio !== 'undefined') registerAudioFiles(bus, SOUND_FILES);
    return bus;
  }, []);
  const game = useSyncExternalStore(controller.subscribe, controller.getState);
  const bodyRef = useRef<HTMLDivElement>(null);
  const directorRef = useRef<Director | null>(null);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const playing = useStore(store, (s) => s.playing);
  const arena = useStore(store, (s) => s.arena);

  useLayoutEffect(() => {
    const d = new Director({ root: bodyRef.current!, store, sound, motion: { reduced, speed } });
    directorRef.current = d;
    controller.attach(d);
    return () => {
      d.reset();
      controller.attach(null);
      directorRef.current = null;
    };
  }, [controller, store, sound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every logic step is already final in `game`; play just the events it produced.
  useLayoutEffect(() => {
    const d = directorRef.current;
    if (!d) return;
    if (game.lastEvents.length) {
      const log = currentLog(game);
      d.play(log, log.length - game.lastEvents.length);
    } else {
      d.show(idleView(game));
    }
  }, [game]);

  useEffect(() => watchReducedMotion(setReduced), []);
  useEffect(() => directorRef.current?.setMotion({ reduced, speed }), [reduced, speed]);
  useEffect(() => sound.setMuted(muted), [sound, muted]);

  const join = useCallback(() => controller.deal(), [controller]);
  const closeArena = useCallback(() => directorRef.current?.closeArena(controller.getState().roster.you), [controller]);

  const over = game.status !== 'playing' && !playing && arena === 'hidden';
  const mode = over ? 'over' : playing ? 'playing' : game.hand ? 'decide' : 'idle';
  const dealLabel = !game.lastRound ? '▶ 配る' : game.lastRound.eliminated === 'opponent' ? '▶ 次の対戦相手' : '▶ 次のラウンド';

  const restart = () => {
    const s = randomSeed();
    setSeed(s);
    controller.reset(s);
  };

  return (
    <div className={`app${reduced ? ' is-reduced' : ''}`}>
      <Hud
        store={store}
        speed={speed}
        muted={muted}
        onSpeed={() => setSpeed((v) => (v === 1 ? 2 : 1))}
        onMute={() => setMuted((m) => !m)}
        onStandings={() => (arena === 'open' ? directorRef.current?.closeArena(game.roster.you) : directorRef.current?.openArena(game.roster.you))}
      />
      <div className="app-body" ref={bodyRef}>
      <Table game={game} store={store} />
      <Controls
        mode={mode}
        legal={mode === 'decide' ? controller.legal() : []}
        dealLabel={dealLabel}
        canReplay={!game.hand && game.lastLog.length > 0}
        onDeal={() => controller.deal()}
        onSkip={() => controller.skip()}
        onReplay={() => controller.replay()}
        onAct={(a) => controller.act(a)}
      />
      <Arena
        game={game}
        mode={arena}
        onJoin={join}
        onClose={closeArena}
      />
      </div>
      <footer className="seed">seed {seed}</footer>
      {over && (
        <div className="result-overlay" role="dialog" aria-label="結果">
          <div className={`result-card result--${game.status}`}>
            {game.status === 'won' ? (
              <>
                <div className="result-title">WINNER</div>
                <p>100人の頂点に立った！</p>
              </>
            ) : (
              <>
                <div className="result-title">脱落</div>
                <p>
                  最終順位 <b>{game.survivors + 1}</b> 位 / {game.round} ラウンド
                </p>
              </>
            )}
            <button className="btn btn--ghost" onClick={() => directorRef.current?.openArena(game.roster.you)}>
              100人の結果を見る
            </button>
            <button className="btn btn--primary" onClick={restart}>
              もう一度
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
