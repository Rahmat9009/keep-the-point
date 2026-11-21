import type { Card } from './types';

/** Speaking pace used for estimates: 150 words per minute. */
export const WORDS_PER_SECOND = 2.5;
export const MIN_ESTIMATE_SECONDS = 3;
/** Priority given to new cards until the student changes it. */
export const DEFAULT_PRIORITY = 3;

/** Split a pasted outline into card texts: one per line, trimmed, blank lines skipped. */
export function parseOutline(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Words of the spoken text used as a title when the card has none. */
export const TITLE_WORDS = 5;

/** The card's title, or the first few words of its spoken text. Empty string for an empty card. */
export function cardTitle(card: Pick<Card, 'title' | 'text'>): string {
  const title = card.title?.trim();
  if (title) return title;
  const words = card.text.trim().split(/\s+/).filter(Boolean);
  return words.length > TITLE_WORDS ? `${words.slice(0, TITLE_WORDS).join(' ')}…` : words.join(' ');
}

/** Estimated spoken length: words ÷ 2.5, rounded, at least 3 seconds. */
export function estimateSeconds(text: string): number {
  return Math.max(MIN_ESTIMATE_SECONDS, Math.round(countWords(text) / WORDS_PER_SECOND));
}

let idCounter = 0;
export function newCardId(): string {
  idCounter += 1;
  return `c${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** A fresh, unlocked card with an estimated length. */
export function newCard(text = '', makeId: () => string = newCardId): Card {
  return {
    id: makeId(),
    text,
    seconds: estimateSeconds(text),
    tags: [],
    locked: false,
    priority: DEFAULT_PRIORITY,
    estimated: true,
  };
}

/** Turn a pasted outline into cards, one per non-empty line. */
export function cardsFromOutline(text: string, makeId: () => string = newCardId): Card[] {
  return parseOutline(text).map((line) => newCard(line, makeId));
}
