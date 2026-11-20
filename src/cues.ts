import type { Card } from './types';

export interface CueCardItem {
  kind: 'card';
  card: Card;
  /** Position in the shortened talk, starting at 1. */
  number: number;
}

export interface CutMarker {
  kind: 'cut';
  /** The cut cards in this gap, in original order (several in a row share one marker). */
  cards: Card[];
  seconds: number;
  /** Kept card just before the gap, or null if the gap is at the very start. */
  after: Card | null;
  /** Kept card just after the gap, or null if the gap is at the very end. */
  before: Card | null;
}

export type CueItem = CueCardItem | CutMarker;

/**
 * Lay out the shortened talk for cue cards: kept cards in order, with a marker
 * wherever one or more cards were cut so the speaker knows a bridge is needed.
 */
export function buildCueItems(allCards: Card[], keptIds: Iterable<string>): CueItem[] {
  const kept = new Set(keptIds);
  const items: CueItem[] = [];
  let pending: Card[] = [];
  let lastKept: Card | null = null;
  let number = 0;

  const flush = (before: Card | null) => {
    if (pending.length === 0) return;
    items.push({
      kind: 'cut',
      cards: pending,
      seconds: pending.reduce((t, c) => t + c.seconds, 0),
      after: lastKept,
      before,
    });
    pending = [];
  };

  for (const card of allCards) {
    if (kept.has(card.id)) {
      flush(card);
      number += 1;
      items.push({ kind: 'card', card, number });
      lastKept = card;
    } else {
      pending.push(card);
    }
  }
  flush(null);
  return items;
}

/** Just the cut markers. */
export function cutMarkers(allCards: Card[], keptIds: Iterable<string>): CutMarker[] {
  return buildCueItems(allCards, keptIds).filter((i): i is CutMarker => i.kind === 'cut');
}

/** "Grandma's bakery story (46s)" or "Hook (~4s), Setup details (18s)". */
export function cutLabel(marker: CutMarker): string {
  return marker.cards
    .map((c) => `${c.text.trim() || '(empty card)'} (${c.estimated ? '~' : ''}${c.seconds}s)`)
    .join(', ');
}
