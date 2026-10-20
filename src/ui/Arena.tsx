import { memo } from 'react';
import logoUrl from '../assets/logo.webp';
import { aliveSeats, seatName, TOTAL_PLAYERS, type GameState } from '../logic/game';

interface Props {
  game: GameState;
  mode: 'hidden' | 'lobby' | 'open';
  onJoin(): void;
  onClose(): void;
}

const COLS = 10;

/** Ring distance from the grid centre, for the lobby's outward pop-in. */
function ring(i: number): number {
  const x = i % COLS;
  const y = Math.floor(i / COLS);
  return Math.max(Math.abs(x - 4.5), Math.abs(y - 4.5));
}

/**
 * All 100 players' screens. Pure layout from the (already decided) roster;
 * the Director zooms it in and out.
 */
export const Arena = memo(function Arena({ game, mode, onJoin, onClose }: Props) {
  const { roster } = game;
  const alive = aliveSeats(roster).length;
  const lastRound = game.hand ? null : game.lastRound?.round ?? null;
  const fresh = lastRound === null ? 0 : roster.out.filter((o) => o === lastRound).length;
  const oppSeat = game.status === 'playing' ? game.opponent.seat : -1;
  const youOut = roster.out[roster.you] !== null;

  return (
    <div className={`arena is-${mode}`} data-arena aria-hidden={mode === 'hidden'}>
      <header className="arena-chrome arena-head">
        <img className="arena-logo" src={logoUrl} alt="Poker Survival" width={640} height={301} draggable={false} />
        <div className="arena-stats">
          <span>
            残り <b data-testid="arena-alive">{alive}</b>人
          </span>
          <span>脱落 {TOTAL_PLAYERS - alive}人</span>
          {fresh > 0 && <span className="arena-fresh">今回の脱落 {fresh}人</span>}
        </div>
      </header>

      <div className="arena-grid" data-arena-grid>
        {roster.out.map((out, i) => {
          const cls = [
            'tile',
            i === roster.you && 'is-you',
            i === oppSeat && out === null && 'is-opp',
            out !== null && 'is-out',
            out !== null && out === lastRound && 'is-new',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={i} className={cls} data-tile={i} style={{ ['--d' as string]: ring(i) }} aria-label={seatName(i)}>
              <span className="tile-cards" aria-hidden />
              <span className="tile-no">{i === roster.you ? 'YOU' : i + 1}</span>
              <span className="tile-x" aria-hidden>
                ×
              </span>
            </div>
          );
        })}
      </div>

      <footer className="arena-chrome arena-foot">
        {mode === 'lobby' ? (
          <>
            <p>
              あなたの席は <b>{seatName(roster.you)}</b>。最後の1人まで生き残れ。
            </p>
            <button className="btn btn--primary btn--wide" data-testid="join" onClick={onJoin}>
              ▶ 参加する
            </button>
          </>
        ) : (
          <>
            <p className="arena-legend">
              <i className="lg lg-you" />
              あなた{youOut ? '（脱落）' : ''}
              <i className="lg lg-opp" />
              対戦中
              <i className="lg lg-out" />
              脱落
            </p>
            <button className="btn btn--ghost btn--wide" data-testid="arena-close" onClick={onClose}>
              テーブルに戻る
            </button>
          </>
        )}
      </footer>
    </div>
  );
});
