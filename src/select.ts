import type { Card } from './types';

export const MAX_CARDS = 12;

export interface CutCard {
  card: Card;
  /** Plain-language reason, e.g. "Optional, priority 1 — saves 46s". */
  reason: string;
}

/** Which kept cards cover each required point. */
export type Coverage = Record<string, Card[]>;

export interface FitResult {
  fits: true;
  /** Kept cards, in original order. */
  kept: Card[];
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
  shortest: { cards: Card[]; totalSeconds: number; overBySeconds: number } | null;
  /** Required points that no card is tagged with at all. */
  uncoverablePoints: string[];
}

export type SelectionResult = FitResult | NoFitResult;

const priorityOf = (card: Card) => card.priority ?? 0;
const sumSeconds = (cards: Card[]) => cards.reduce((t, c) => t + c.seconds, 0);

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

/**
 * Pick which cards to keep so the talk fits in `budgetSeconds`.
 *
 * Locked cards are always kept. Every combination of the unlocked cards is tried;
 * combinations that run over budget or leave a required point uncovered are thrown out.
 * The winner has the highest total priority, then (on a tie) uses the most time.
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
  const lockedSeconds = sumSeconds(locked);
  const lockedPriority = locked.reduce((t, c) => t + priorityOf(c), 0);

  // Best combination that fits the budget.
  let best: { mask: number; priority: number; seconds: number } | null = null;
  // Shortest combination that covers every point, ignoring the budget (fallback).
  let shortest: { mask: number; priority: number; seconds: number } | null = null;

  const combos = 1 << unlocked.length; // at most 4,096
  for (let mask = 0; mask < combos; mask++) {
    let seconds = lockedSeconds;
    let priority = lockedPriority;
    const chosen: Card[] = [...locked];
    for (let i = 0; i < unlocked.length; i++) {
      if (mask & (1 << i)) {
        const card = unlocked[i];
        seconds += card.seconds;
        priority += priorityOf(card);
        chosen.push(card);
      }
    }

    const coversAll = requiredPoints.every((p) => chosen.some((c) => c.tags.includes(p)));
    if (!coversAll) continue;

    if (
      !shortest ||
      seconds < shortest.seconds ||
      (seconds === shortest.seconds && priority > shortest.priority)
    ) {
      shortest = { mask, priority, seconds };
    }

    if (seconds > budgetSeconds) continue;
    if (
      !best ||
      priority > best.priority ||
      (priority === best.priority && seconds > best.seconds)
    ) {
      best = { mask, priority, seconds };
    }
  }

  const keptFor = (mask: number) => {
    const keptIds = new Set(locked.map((c) => c.id));
    unlocked.forEach((c, i) => {
      if (mask & (1 << i)) keptIds.add(c.id);
    });
    return cards.filter((c) => keptIds.has(c.id)); // original order
  };

  if (best) {
    const kept = keptFor(best.mask);
    const keptIds = new Set(kept.map((c) => c.id));
    const cut = cards
      .filter((c) => !keptIds.has(c.id))
      .map((card) => ({ card, reason: cutReason(card, kept) }));
    return {
      fits: true,
      kept,
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
          cards: keptFor(shortest.mask),
          totalSeconds: shortest.seconds,
          overBySeconds: shortest.seconds - budgetSeconds,
        }
      : null,
    uncoverablePoints,
  };
}
