import { SUIT_SYMBOL, isRed, rankLabel, type Card } from '../logic/types';

interface Props {
  card: Card;
  /** Slot key used by the Director, e.g. "p0", "b3". */
  slot: string;
}

/** Wrapper moves; .card-inner rotates on Y; the two faces never show together. */
export function CardView({ card, slot }: Props) {
  const r = rankLabel(card.rank);
  const s = SUIT_SYMBOL[card.suit];
  return (
    <div className="card" data-card={slot} data-card-id={card.id} aria-label={`${r}${s}`}>
      <div className="card-glow" />
      <div className="card-inner">
        <div className="card-face card-back" />
        <div className={`card-face card-front${isRed(card.suit) ? ' is-red' : ''}`}>
          <span className="corner tl">
            {r}
            <br />
            {s}
          </span>
          <span className={`pip${card.rank >= 11 && card.rank <= 13 ? ' face' : ''}`}>
            {card.rank >= 11 && card.rank <= 13 ? r : s}
          </span>
          <span className="corner br">
            {r}
            <br />
            {s}
          </span>
        </div>
      </div>
    </div>
  );
}

export function EmptySlot() {
  return <div className="card card--empty" aria-hidden />;
}
