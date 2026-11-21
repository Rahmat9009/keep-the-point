import type { Card } from './types';

export const MAX_SPEAKER_NAME = 60;

export function speakerName(value: string, cards: Card[] = []): string | undefined {
  const name = value.trim().replace(/\s+/g, ' ').slice(0, MAX_SPEAKER_NAME).trimEnd();
  if (!name) return undefined;
  return cards.find((card) => card.speaker?.toLowerCase() === name.toLowerCase())?.speaker ?? name;
}

export function changesSpeaker(from: Card, to: Card | undefined): boolean {
  return !!(from.speaker && to?.speaker && from.speaker !== to.speaker);
}

export function speakerTimes(cards: Card[], seconds: (card: Card) => number): Map<string | undefined, number> {
  const times = new Map<string | undefined, number>();
  for (const card of cards) {
    times.set(card.speaker, (times.get(card.speaker) ?? 0) + seconds(card));
  }
  return times;
}

export type RehearsalStep =
  | { kind: 'card'; card: Card }
  | { kind: 'handoff'; from: Card; to: Card };

export function rehearsalSteps(cards: Card[], groupMode: boolean): RehearsalStep[] {
  const steps: RehearsalStep[] = [];
  cards.forEach((card, i) => {
    const previous = cards[i - 1];
    if (groupMode && previous && changesSpeaker(previous, card)) {
      steps.push({ kind: 'handoff', from: previous, to: card });
    }
    steps.push({ kind: 'card', card });
  });
  return steps;
}
