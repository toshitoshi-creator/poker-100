import { parseCard } from '../src/logic/deck';
import { HandCategory, compareHands, evaluateBest } from '../src/logic/handEvaluator';

const hand = (s: string) => evaluateBest(s.split(' ').map(parseCard));
const ids = (s: string) => hand(s).cards.map((c) => c.id);

describe('evaluateBest — categories', () => {
  it.each([
    ['As Ks Qs Js Ts 2d 3c', HandCategory.RoyalFlush],
    ['9h 8h 7h 6h 5h Ad Ac', HandCategory.StraightFlush],
    ['5d 4d 3d 2d Ad Kc Qh', HandCategory.StraightFlush], // steel wheel
    ['7c 7d 7h 7s Kd 2c 3h', HandCategory.FourOfAKind],
    ['Kc Kd Kh 2s 2d 9c 3h', HandCategory.FullHouse],
    ['Ah 9h 7h 4h 2h Kd Kc', HandCategory.Flush],
    ['Tc 9d 8h 7s 6c 2d 2h', HandCategory.Straight],
    ['Ac 2d 3h 4s 5c Kd 9h', HandCategory.Straight], // wheel
    ['Qc Qd Qh 8s 5c 3d 2h', HandCategory.ThreeOfAKind],
    ['Jc Jd 4h 4s Ac 9d 2h', HandCategory.TwoPair],
    ['Tc Td Ah 8s 6c 3d 2h', HandCategory.OnePair],
    ['Ac Qd 9h 7s 5c 3d 2h', HandCategory.HighCard],
  ])('%s → %s', (cards, cat) => {
    expect(hand(cards).category).toBe(cat);
  });

  it('K-A-2-3-4 is not a straight', () => {
    expect(hand('Kc Ad 2h 3s 4c 9d 8h').category).toBe(HandCategory.HighCard);
  });
});

describe('evaluateBest — best five of seven', () => {
  it('prefers flush over straight in the same seven', () => {
    expect(hand('9h 8h 7h 6c 5h 2h Kd').category).toBe(HandCategory.Flush);
  });

  it('two pair with three pairs keeps the top two pairs and best kicker', () => {
    expect(ids('Ac Ad Kc Kd Qc Qd 2s')).toEqual(['Ac', 'Ad', 'Kc', 'Kd', 'Qc']);
  });

  it('two trips make the best full house', () => {
    const h = hand('9c 9d 9h 5s 5c 5d 2h');
    expect(h.category).toBe(HandCategory.FullHouse);
    expect(h.score).toEqual([6, 9, 5]);
  });

  it('wheel straight lists the ace last (plays low)', () => {
    expect(ids('Ac 2d 3h 4s 5c Kd 9h')).toEqual(['5c', '4s', '3h', '2d', 'Ac']);
  });

  it('returns exactly 5 cards drawn from the input', () => {
    const input = 'Ac Qd 9h 7s 5c 3d 2h';
    const h = hand(input);
    expect(h.cards).toHaveLength(5);
    h.cards.forEach((c) => expect(input).toContain(c.id));
  });
});

describe('compareHands', () => {
  it('higher category wins', () => {
    expect(compareHands(hand('Tc 9d 8h 7s 6c 2d 2h'), hand('Kc Kd Kh 2s 5d 9c 3h'))).toBe(1);
  });

  it('6-high straight beats the wheel', () => {
    expect(compareHands(hand('6c 5d 4h 3s 2c Kd Kh'), hand('Ac 2d 3h 4s 5c Kd 9h'))).toBe(1);
  });

  it('kicker decides equal pairs', () => {
    expect(compareHands(hand('Ac Ad Kh 8s 6c 3d 2h'), hand('Ah As Qh 8d 6d 3c 2c'))).toBe(1);
  });

  it('flush compares all five cards', () => {
    expect(compareHands(hand('Ah Jh 9h 6h 3h'), hand('Ad Jd 9d 6d 2d'))).toBe(1);
  });

  it('board plays → split pot', () => {
    const board = 'Ac Kd Qh Js Tc';
    expect(compareHands(hand(`${board} 2c 3d`), hand(`${board} 4h 5s`))).toBe(0);
  });

  it('full house: trips rank decides before pair', () => {
    expect(compareHands(hand('3c 3d 3h As Ad'), hand('2c 2d 2h Ks Kd'))).toBe(1);
  });
});
