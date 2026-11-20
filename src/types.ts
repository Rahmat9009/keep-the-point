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
  /** True while `seconds` is a word-count guess rather than a number the student entered. */
  estimated?: boolean;
  /** Optional short version the selection may use instead of the full card. Keeps the card's tags. */
  short?: ShortVersion;
}

export interface ShortVersion {
  text: string;
  seconds: number;
  /** True while `seconds` is a word-count guess. */
  estimated?: boolean;
}

/** A talk: cards in speaking order plus the points it must cover. */
export interface Talk {
  title: string;
  cards: Card[];
  requiredPoints: string[];
  /** Bridge lines for cut gaps, keyed by gapKey() (see cues.ts). */
  bridges?: Record<string, string>;
}
