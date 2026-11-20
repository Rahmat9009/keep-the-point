import type { Card } from './types';

export const MAX_CARDS = 12;
/** A short version counts for this share of the card's priority. */
export const SHORT_PRIORITY_SHARE = 0.6;

/** How a card is used: said in full, said as its short version, or cut. */
export type CardMode = 'full' | 'short' | 'cut';

export interface CutCard {
  card: Card;
  /** Plain-language reason, e.g. "Optional, priority 1 — saves 46s". */
  reason: string;
}

/** Which kept cards cover each required point. */
export type Coverage = Record<string, Card[]>;

export interface FitResult {
  fits: true;
  /** Kept cards (full or short), in original order. These are the original cards: use spokenCard() for what is said. */
  kept: Card[];
  /** Ids of kept cards that use their short version. */
  shortIds: string[];
  /** Cut cards, in original order, each with a reason. */
  cut: CutCard[];
  totalSeconds: number;
  spareSeconds: number;
  coverage: Coverage;
}

export interface NoFitResult {
  fits: false;
  budgetSeconds: number;
  /**
   * The shortest talk that keeps every locked card and still covers every required point.
   * Null when no such talk exists (some required point has no card tagged with it).
   */
  shortest: { cards: Card[]; shortIds: string[]; totalSeconds: number; overBySeconds: number } | null;
  /** Required points that no card is tagged with at all. */
  uncoverablePoints: string[];
}

export type SelectionResult = FitResult | NoFitResult;

export function hasShort(card: Card): boolean {
  return !!card.short && card.short.text.trim() !== '' && card.short.seconds >= 1;
}

/** The card as it will be said: its short version if the selection shortened it. */
export function spokenCard(card: Card, shortIds: Iterable<string>): Card {
  if (!card.short || !new Set(shortIds).has(card.id)) return card;
  return { ...card, text: card.short.text, seconds: card.short.seconds, estimated: card.short.estimated };
}

/** "Shortened: 46s → 12s" (with ~ for estimates). */
export function shortenedLabel(card: Card): string {
  const s = card.short;
  if (!s) return '';
  return `Shortened: ${card.estimated ? '~' : ''}${card.seconds}s → ${s.estimated ? '~' : ''}${s.seconds}s`;
}

// Priorities are compared in tenths so 60% stays an exact integer.
const fullScore = (card: Card) => (card.priority ?? 0) * 10;
const shortScore = (card: Card) => (card.priority ?? 0) * 10 * SHORT_PRIORITY_SHARE;

function coverageOf(kept: Card[], requiredPoints: string[]): Coverage {
  const coverage: Coverage = {};
  for (const point of requiredPoints) {
    coverage[point] = kept.filter((c) => c.tags.includes(point));
  }
  return coverage;
}

function cutReason(card: Card, kept: Card[]): string {
  const saves = `saves ${card.seconds}s`;
  if (card.tags.length > 0) {
    const coveredBy = card.tags
      .map((tag) => {
        const other = kept.find((k) => k.tags.includes(tag));
        return other ? `"${tag}" is still covered by ${other.text}` : null;
      })
      .filter(Boolean);
    if (coveredBy.length > 0) return `${coveredBy.join('; ')} — ${saves}`;
  }
  if (card.priority !== undefined) return `Optional, priority ${card.priority} — ${saves}`;
  return `Optional — ${saves}`;
}

const CUT = 0;
const FULL = 1;
const SHORT = 2;

/**
 * Pick how to use each card so the talk fits in `budgetSeconds`.
 *
 * Locked cards are always said in full. Every other card can be FULL, SHORT (if it has a
 * short version) or CUT, and every combination is tried (at most 3^12 = 531,441).
 * Combinations that run over budget or leave a required point uncovered are thrown out;
 * a tagged card can be cut only when another kept card covers its points.
 * A short version scores 60% of the card's priority.
 * The winner has the highest total priority, then (on a tie) uses the most time,
 * then (still tied) is the first one found in a fixed search order over the cards as listed.
 */
export function selectCards(
  cards: Card[],
  requiredPoints: string[],
  budgetSeconds: number,
): SelectionResult {
  if (cards.length > MAX_CARDS) {
    throw new Error(`A talk can have at most ${MAX_CARDS} cards (got ${cards.length}).`);
  }

  const locked = cards.filter((c) => c.locked);
  const unlocked = cards.filter((c) => !c.locked);
  const n = unlocked.length;

  // Required points as bits, so coverage is one OR per card.
  const pointBit = new Map(requiredPoints.map((p, i) => [p, i]));
  const maskOf = (card: Card) => card.tags.reduce((m, t) => (pointBit.has(t) ? m | 2 ** pointBit.get(t)! : m), 0);
  const useBits = requiredPoints.length <= 30;
  const allPoints = useBits ? 2 ** requiredPoints.length - 1 : 0;

  const lockedSeconds = locked.reduce((t, c) => t + c.seconds, 0);
  const lockedScore = locked.reduce((t, c) => t + fullScore(c), 0);
  const lockedMask = locked.reduce((m, c) => m | maskOf(c), 0);

  const radix = unlocked.map((c) => (hasShort(c) ? 3 : 2));
  const secs = unlocked.map((c) => [0, c.seconds, c.short?.seconds ?? 0]);
  const score = unlocked.map((c) => [0, fullScore(c), shortScore(c)]);
  const masks = unlocked.map(maskOf);

  const coversAll = (modes: number[]): boolean => {
    if (useBits) {
      let m = lockedMask;
      for (let i = 0; i < n; i++) if (modes[i] !== CUT) m |= masks[i];
      return (m & allPoints) === allPoints;
    }
    return requiredPoints.every(
      (p) => locked.some((c) => c.tags.includes(p)) || unlocked.some((c, i) => modes[i] !== CUT && c.tags.includes(p)),
    );
  };

  type Pick = { modes: number[]; score: number; seconds: number };
  let best: Pick | null = null;
  let shortest: Pick | null = null;

  // Odometer over all mode combinations, first card changing fastest (the same order as
  // the original keep/cut bitmask search), with FULL tried before SHORT for each card.
  const modes = new Array<number>(n).fill(CUT);
  for (;;) {
    let seconds = lockedSeconds;
    let total = lockedScore;
    for (let i = 0; i < n; i++) {
      seconds += secs[i][modes[i]];
      total += score[i][modes[i]];
    }

    if (coversAll(modes)) {
      if (!shortest || seconds < shortest.seconds || (seconds === shortest.seconds && total > shortest.score)) {
        shortest = { modes: [...modes], score: total, seconds };
      }
      if (
        seconds <= budgetSeconds &&
        (!best || total > best.score || (total === best.score && seconds > best.seconds))
      ) {
        best = { modes: [...modes], score: total, seconds };
      }
    }

    let i = 0;
    while (i < n && modes[i] === radix[i] - 1) modes[i++] = CUT;
    if (i >= n) break;
    modes[i] += 1;
  }

  const split = (pick: Pick) => {
    const modeById = new Map<string, number>(locked.map((c) => [c.id, FULL]));
    unlocked.forEach((c, i) => modeById.set(c.id, pick.modes[i]));
    const kept = cards.filter((c) => modeById.get(c.id) !== CUT); // original order
    const shortIds = kept.filter((c) => modeById.get(c.id) === SHORT).map((c) => c.id);
    return { kept, shortIds };
  };

  if (best) {
    const { kept, shortIds } = split(best);
    const keptIds = new Set(kept.map((c) => c.id));
    const cut = cards
      .filter((c) => !keptIds.has(c.id))
      .map((card) => ({ card, reason: cutReason(card, kept) }));
    return {
      fits: true,
      kept,
      shortIds,
      cut,
      totalSeconds: best.seconds,
      spareSeconds: budgetSeconds - best.seconds,
      coverage: coverageOf(kept, requiredPoints),
    };
  }

  const uncoverablePoints = requiredPoints.filter((p) => !cards.some((c) => c.tags.includes(p)));
  return {
    fits: false,
    budgetSeconds,
    shortest: shortest
      ? {
          cards: split(shortest).kept,
          shortIds: split(shortest).shortIds,
          totalSeconds: shortest.seconds,
          overBySeconds: shortest.seconds - budgetSeconds,
        }
      : null,
    uncoverablePoints,
  };
}

/** Mode of each card in a result, by id. */
export function modeOf(card: Card, kept: Card[], shortIds: string[]): CardMode {
  if (!kept.some((c) => c.id === card.id)) return 'cut';
  return shortIds.includes(card.id) ? 'short' : 'full';
}
