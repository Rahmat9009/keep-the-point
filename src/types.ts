/** One spoken card in a talk. */
export interface Card {
  id: string;
  text: string;
  /** How long the card takes to say, in seconds. */
  seconds: number;
  /** Required points this card covers, e.g. "Evidence". Empty for purely optional cards. */
  tags: string[];
  /** Locked cards are always kept. */
  locked: boolean;
  /** 1-5 for optional cards (5 = most important). Cards that only exist to cover a required point may leave it out. */
  priority?: number;
}

/** A talk: cards in speaking order plus the points it must cover. */
export interface Talk {
  title: string;
  cards: Card[];
  requiredPoints: string[];
}
