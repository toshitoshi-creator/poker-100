import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createSoundBus, registerAudioFiles } from './audio/soundBus';
import { SOUND_FILES } from './audio/soundMap';
import { GameController } from './game/controller';
import { DEFAULT_TABLE_SIZE, TABLE_SIZES, type GameState, type TableSize } from './logic/game';
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
    hp: v.hp,
    bets: v.bets,
    say: v.say,
    pot: 0,
    survivors: v.survivors,
    button: v.button,
    active: -1,
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

const TABLE_KEY = 'poker100.tableSize';

/** ?table=6 in the URL, else the last choice on this device, else heads-up. */
export function readTableSize(): TableSize {
  const parse = (v: string | null) => TABLE_SIZES.find((t) => String(t) === v) ?? null;
  const fromUrl = typeof location === 'undefined' ? null : parse(new URLSearchParams(location.search).get('table'));
  if (fromUrl) return fromUrl;
  try {
    return parse(localStorage.getItem(TABLE_KEY)) ?? DEFAULT_TABLE_SIZE;
  } catch {
    return DEFAULT_TABLE_SIZE;
  }
}

function saveTableSize(t: TableSize) {
  try {
    localStorage.setItem(TABLE_KEY, String(t));
  } catch {
    // Storage may be unavailable (private mode); the choice just isn't remembered.
  }
}

export function App({ seed: initialSeed, tableSize: initialTable }: { seed?: number; tableSize?: TableSize }) {
  const [seed, setSeed] = useState(() => initialSeed ?? readSeedFromUrl() ?? randomSeed());
  const [tableSize, setTableSize] = useState<TableSize>(() => initialTable ?? readTableSize());
  const controller = useMemo(() => new GameController(seed, tableSize), []); // eslint-disable-line react-hooks/exhaustive-deps
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
  const dealLabel = !game.lastRound ? '▶ 配る' : '▶ 次のハンド';

  const restart = () => {
    const s = randomSeed();
    setSeed(s);
    controller.reset(s, tableSize);
  };
  // Only offered in the lobby, before the first hand.
  const changeTable = useCallback(
    (t: TableSize) => {
      setTableSize(t);
      saveTableSize(t);
      controller.reset(seed, t);
    },
    [controller, seed],
  );

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
      <Table game={game} store={store} yourTurn={mode === 'decide'} />
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
        tableSize={tableSize}
        onTableSize={changeTable}
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
