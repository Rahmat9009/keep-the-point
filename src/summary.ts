import { MAX_CARDS, selectCards, type SelectionResult } from './select';
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
    return { text: 'Add some cards to see what fits.', tone: 'quiet', result: null, keptCards: [] };
  }
  if (cards.length > MAX_CARDS) {
    return { text: `${cards.length} cards is too many to check`, tone: 'bad', result: null, keptCards: [] };
  }

  const full = timeLabel(cards.reduce((t, c) => t + c.seconds, 0), cards.some((c) => c.estimated));
  const result = selectCards(cards, requiredPoints, budgetSeconds);

  if (result.fits) {
    const total = timeLabel(result.totalSeconds, result.kept.some((c) => c.estimated));
    return { text: `${full} → ${total} · ${result.spareSeconds}s spare`, tone: 'ok', result, keptCards: result.kept };
  }
  if (result.shortest) {
    const s = result.shortest;
    return {
      text: `${full} → can't fit ${formatTime(budgetSeconds)} · shortest valid talk is ${timeLabel(s.totalSeconds, s.cards.some((c) => c.estimated))} (${s.overBySeconds}s over)`,
      tone: 'bad',
      result,
      keptCards: s.cards,
    };
  }
  return {
    text: `Can't build a valid talk: no card covers ${result.uncoverablePoints.join(', ')}`,
    tone: 'bad',
    result,
    keptCards: [],
  };
}
