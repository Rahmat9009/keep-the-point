import { MAX_CARDS, selectCards, spokenCard, type SelectionResult } from './select';
import { formatTime } from './time';
import type { Card } from './types';

export type SummaryTone = 'ok' | 'bad' | 'quiet';

export interface Summary {
  /** e.g. "2:38 → 1:52 · 8s spare" */
  text: string;
  tone: SummaryTone;
  /** Null when the selection couldn't run (no cards, or too many). */
  result: SelectionResult | null;
  /** Cards to show as kept: the selection, or the shortest valid talk when nothing fits. */
  keptCards: Card[];
  /** Ids of kept cards that use their short version. */
  shortIds: string[];
  /** When the talk fits: a single time or the before-and-after times. */
  headline?: string;
  /** When the talk fits: small details shown under the headline, e.g. ["3s spare", "1 shortened", "1 cut"]. */
  chips?: string[];
}

/** "~1:52" when any card in the total is still an estimate. */
export function timeLabel(seconds: number, estimated: boolean): string {
  return `${estimated ? '~' : ''}${formatTime(seconds)}`;
}

export function cardTimeLabel(card: Card): string {
  return `${card.estimated ? '~' : ''}${card.seconds}s`;
}

/** Run the selection and describe it in one line. */
export function summarize(cards: Card[], requiredPoints: string[], budgetSeconds: number): Summary {
  if (cards.length === 0) {
    return { text: 'Add some cards to see what fits.', tone: 'quiet', result: null, keptCards: [], shortIds: [] };
  }
  if (cards.length > MAX_CARDS) {
    return { text: `${cards.length} cards is too many to check`, tone: 'bad', result: null, keptCards: [], shortIds: [] };
  }

  const full = timeLabel(cards.reduce((t, c) => t + c.seconds, 0), cards.some((c) => c.estimated));
  const result = selectCards(cards, requiredPoints, budgetSeconds);

  const anyEstimated = (kept: Card[], shortIds: string[]) => kept.some((c) => spokenCard(c, shortIds).estimated);
  const shortNote = (shortIds: string[]) => (shortIds.length ? ` · ${shortIds.length} shortened` : '');

  if (result.fits) {
    const total = timeLabel(result.totalSeconds, anyEstimated(result.kept, result.shortIds));
    const trimmed = result.shortIds.length > 0 || result.cut.length > 0;
    const headline = trimmed ? `${full} → ${total}` : total;
    const spare = `${result.spareSeconds}s spare`;
    const chips = [trimmed ? spare : `Fits · ${spare}`];
    if (result.shortIds.length) chips.push(`${result.shortIds.length} shortened`);
    if (result.cut.length) chips.push(`${result.cut.length} cut`);
    return {
      text: `${headline} · ${chips[0]}${shortNote(result.shortIds)}`,
      headline,
      chips,
      tone: 'ok',
      result,
      keptCards: result.kept,
      shortIds: result.shortIds,
    };
  }
  if (result.shortest) {
    const s = result.shortest;
    return {
      text: `${full} → can't fit ${formatTime(budgetSeconds)} · shortest valid talk is ${timeLabel(s.totalSeconds, anyEstimated(s.cards, s.shortIds))} (${s.overBySeconds}s over)`,
      tone: 'bad',
      result,
      keptCards: s.cards,
      shortIds: s.shortIds,
    };
  }
  return {
    text: `Can't build a valid talk: no card covers ${result.uncoverablePoints.join(', ')}`,
    tone: 'bad',
    result,
    keptCards: [],
    shortIds: [],
  };
}
