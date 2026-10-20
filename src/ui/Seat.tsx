import type { Fighter } from '../logic/hp';
import type { RoundResult } from '../logic/game';
import { HAND_INFO } from '../logic/handEvaluator';
import type { Card } from '../logic/types';
import { useStore, type PresentationState, type Store } from '../presentation/store';
import { CardView, EmptySlot } from './CardView';
import { HpBar } from './HpBar';

/** Where a table seat sits on the portrait screen (seat 0 = you, then clockwise). */
export const SEAT_POS = ['hero', 'left', 'top-left', 'top', 'top-right', 'right'] as const;

interface Props {
  seat: number;
  fighter: Fighter | null;
  hole: readonly [Card, Card] | null;
  round: number;
  result: RoundResult | null;
  store: Store<PresentationState>;
  /** It is your turn to act (hero seat only). */
  yourTurn?: boolean;
}

function Bubble({ seat, store }: { seat: number; store: Store<PresentationState> }) {
  const text = useStore(store, (s) => s.say[seat] ?? '');
  if (!text) return null;
  return (
    <span key={text} className="say" data-testid={`say-${seat}`}>
      {text}
    </span>
  );
}

function Bet({ seat, store }: { seat: number; store: Store<PresentationState> }) {
  const bet = useStore(store, (s) => s.bets[seat] ?? 0);
  return (
    <div className={`seat-bet${bet ? '' : ' is-zero'}`} data-bet={seat} data-testid={`bet-${seat}`}>
      <i className="bet-chip" aria-hidden />
      {bet || ''}
    </div>
  );
}

function Marks({ seat, store }: { seat: number; store: Store<PresentationState> }) {
  const dealer = useStore(store, (s) => s.button === seat && s.round > 0);
  const active = useStore(store, (s) => s.active === seat);
  return (
    <>
      {dealer && (
        <span className="dealer-chip" aria-label="ディーラー">
          D
        </span>
      )}
      {active && <span className="active-ring" aria-hidden />}
    </>
  );
}

export function Seat({ seat, fighter, hole, round, result, store, yourTurn }: Props) {
  const pos = SEAT_POS[seat]!;
  const hero = seat === 0;
  if (!fighter) {
    return (
      <section className={`seat seat--${pos} is-empty`} data-seat={seat}>
        <div className="seat-empty">空席</div>
      </section>
    );
  }
  const hand = result?.endedBy === 'showdown' ? result.hands[seat] : null;
  const won = result?.payout[seat] ?? 0;
  const bonus = result?.bonus[seat] ?? 0;
  return (
    <section className={`seat seat--${pos}${hero ? ' seat--hero' : ''}${yourTurn ? ' is-turn' : ''}`} data-seat={seat}>
      <div className="seat-cards" key={round}>
        {hole
          ? hole.map((c, k) => <CardView key={c.id} card={c} slot={`h${seat}-${k}`} small={!hero} />)
          : [<EmptySlot key="a" small={!hero} />, <EmptySlot key="b" small={!hero} />]}
      </div>
      <div className="seat-plate">
        <div className="avatar" data-avatar={seat}>
          <span className="avatar-icon" aria-hidden>
            {hero ? '★' : fighter.name.slice(-2)}
          </span>
          <span className="avatar-name">{fighter.name}</span>
          <Marks seat={seat} store={store} />
          <Bubble seat={seat} store={store} />
        </div>
        <HpBar seat={seat} max={fighter.maxHp} store={store} />
      </div>
      <Bet seat={seat} store={store} />
      <div className={`hand-label${won ? ' is-winner' : ''}`} data-label={seat}>
        {hand ? HAND_INFO[hand.category].ja : ''}
      </div>
      <div className="dmg-pop" data-dmg={seat}>
        {bonus ? `-${bonus}` : ''}
      </div>
      <div className="gain-pop" data-gain={seat}>
        {won ? `+${won}` : ''}
      </div>
      <div className="ko-stamp" data-ko={seat}>
        脱落
      </div>
    </section>
  );
}
