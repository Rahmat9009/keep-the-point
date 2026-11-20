import type { Card, Talk } from './types';

/** Return a copy of `cards` with the card at `index` moved by `delta` places (clamped to the ends). */
export function moveCard(cards: Card[], index: number, delta: number): Card[] {
  const target = Math.min(cards.length - 1, Math.max(0, index + delta));
  if (index < 0 || index >= cards.length || target === index) return cards;
  const next = [...cards];
  const [card] = next.splice(index, 1);
  next.splice(target, 0, card);
  return next;
}

export type AddPointResult = { talk: Talk; error?: undefined } | { talk?: undefined; error: string };

/** Add a required point. Names are trimmed; duplicates (ignoring case) are rejected. */
export function addPoint(talk: Talk, rawName: string): AddPointResult {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Type a name for the point first.' };
  if (talk.requiredPoints.some((p) => p.toLowerCase() === name.toLowerCase())) {
    return { error: `"${name}" is already on the list.` };
  }
  return { talk: { ...talk, requiredPoints: [...talk.requiredPoints, name] } };
}

/** Remove a required point and untag it from every card. */
export function removePoint(talk: Talk, name: string): Talk {
  return {
    ...talk,
    requiredPoints: talk.requiredPoints.filter((p) => p !== name),
    cards: talk.cards.map((c) =>
      c.tags.includes(name) ? { ...c, tags: c.tags.filter((t) => t !== name) } : c,
    ),
  };
}

export function emptyTalk(): Talk {
  return { title: 'My talk', cards: [], requiredPoints: [] };
}
