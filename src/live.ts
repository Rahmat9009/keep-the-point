/**
 * Live pacing: re-plan the rest of the talk while it is being given. Pure functions only.
 *
 * After each card the remaining cards are run through the normal selection again, with
 * "time left on the clock" as the budget. Cards already spoken never change.
 */
import { cardTitle } from './outline';
import { selectCards, spokenCard } from './select';
import { formatTime } from './time';
import type { Card } from './types';

/** The cards still to be said, in order, and which of them use their short version. */
export interface LivePlan {
  ids: string[];
  shortIds: string[];
}

/** A card that has been said, in the version it was said in. */
export interface SpokenEntry {
  id: string;
  short: boolean;
}

export interface ReplanInput {
  /** Every card in the talk, in talk order. */
  cards: Card[];
  requiredPoints: string[];
  limitSeconds: number;
  /** Cards said so far, in the order they were said. */
  spoken: SpokenEntry[];
  /** Time on the clock so far. */
  elapsedSeconds: number;
}

export interface ReplanResult {
  plan: LivePlan;
  /** True when nothing fits the time left, so the plan is the shortest one that still covers the required points. */
  wrapUp: boolean;
  /** Seconds left on the clock (limit − elapsed); may be negative. */
  budgetSeconds: number;
}

/** Seconds the plan expects a card to take in the version it uses. */
export function plannedSeconds(card: Card, short: boolean): number {
  return short && card.short ? card.short.seconds : card.seconds;
}

/**
 * Re-run the selection over the cards not said yet.
 *
 * - Only cards after the last spoken card are candidates (a speaker can't go back), including
 *   ones the earlier plan cut and their short versions.
 * - Required points covered by spoken cards count as covered. Points no remaining card can cover are dropped.
 * - Locked cards stay (the selection always keeps them).
 * - If nothing fits, the selection's shortest valid plan is used and `wrapUp` is true.
 */
export function replan(input: ReplanInput): ReplanResult {
  const { cards, requiredPoints, limitSeconds, spoken, elapsedSeconds } = input;
  const spokenIds = new Set(spoken.map((s) => s.id));
  const lastIndex = spoken.reduce((m, s) => Math.max(m, cards.findIndex((c) => c.id === s.id)), -1);
  const remaining = cards.slice(lastIndex + 1).filter((c) => !spokenIds.has(c.id));
  const spokenCards = cards.filter((c) => spokenIds.has(c.id));

  const stillNeeded = requiredPoints.filter(
    (p) => !spokenCards.some((c) => c.tags.includes(p)) && remaining.some((c) => c.tags.includes(p)),
  );
  const budgetSeconds = Math.floor(limitSeconds - elapsedSeconds);

  if (remaining.length === 0) return { plan: { ids: [], shortIds: [] }, wrapUp: false, budgetSeconds };

  const result = selectCards(remaining, stillNeeded, budgetSeconds);
  if (result.fits) {
    return { plan: { ids: result.kept.map((c) => c.id), shortIds: result.shortIds }, wrapUp: false, budgetSeconds };
  }
  // stillNeeded only has coverable points, so a shortest plan always exists.
  const shortest = result.shortest!;
  return { plan: { ids: shortest.cards.map((c) => c.id), shortIds: shortest.shortIds }, wrapUp: true, budgetSeconds };
}

/** One difference between two plans, for the banner. */
export type PlanChange =
  | { kind: 'skip'; id: string; savesSeconds: number }
  | { kind: 'short'; id: string; savesSeconds: number }
  | { kind: 'full'; id: string; addsSeconds: number }
  | { kind: 'add'; id: string; addsSeconds: number };

/** What changed between the old upcoming plan and the new one. */
export function diffPlans(before: LivePlan, after: LivePlan, cards: Card[]): PlanChange[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const changes: PlanChange[] = [];
  const all = cards.filter((c) => before.ids.includes(c.id) || after.ids.includes(c.id));
  for (const card of all) {
    const wasIn = before.ids.includes(card.id);
    const isIn = after.ids.includes(card.id);
    const wasShort = before.shortIds.includes(card.id);
    const isShort = after.shortIds.includes(card.id);
    const c = byId.get(card.id)!;
    if (wasIn && !isIn) changes.push({ kind: 'skip', id: c.id, savesSeconds: plannedSeconds(c, wasShort) });
    else if (!wasIn && isIn) changes.push({ kind: 'add', id: c.id, addsSeconds: plannedSeconds(c, isShort) });
    else if (wasIn && isIn && wasShort !== isShort) {
      const delta = plannedSeconds(c, wasShort) - plannedSeconds(c, isShort);
      changes.push(isShort ? { kind: 'short', id: c.id, savesSeconds: delta } : { kind: 'full', id: c.id, addsSeconds: -delta });
    }
  }
  return changes;
}

/** Below this many seconds either way the pace line says "On track". */
export const ON_TRACK_SECONDS = 3;

/**
 * How far off the plan the speaker is, in seconds: positive = behind, negative = ahead.
 * Compares time actually taken by spoken cards with what the plan gave them, plus any
 * overrun on the card being said right now.
 */
export function paceSeconds(
  spokenActualMs: number,
  spokenPlannedSeconds: number,
  currentElapsedMs: number,
  currentPlannedSeconds: number,
): number {
  const overrun = Math.max(0, currentElapsedMs - currentPlannedSeconds * 1000);
  return (spokenActualMs - spokenPlannedSeconds * 1000 + overrun) / 1000;
}

/** 6 -> "6s", 101 -> "1:41". */
export function gapLabel(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  return s < 60 ? `${s}s` : formatTime(s);
}

export type PaceTone = 'ok' | 'behind' | 'ahead';

/** "On track", "6s behind" or "8s ahead". */
export function paceLabel(pace: number): { text: string; tone: PaceTone } {
  const s = Math.round(Math.abs(pace));
  if (s < ON_TRACK_SECONDS) return { text: 'On track', tone: 'ok' };
  return pace > 0 ? { text: `${gapLabel(s)} behind`, tone: 'behind' } : { text: `${gapLabel(s)} ahead`, tone: 'ahead' };
}

/** e.g. "6s behind → skip 'Seattle study' (saves 18s)". */
export function describeChanges(changes: PlanChange[], cards: Card[], pace: number, wrapUp: boolean): string {
  if (wrapUp) return 'Wrap up: required points only';
  const byId = new Map(cards.map((c) => [c.id, c]));
  const name = (id: string) => `'${cardTitle(byId.get(id)!) || '(empty card)'}'`;
  const parts = changes.map((ch) => {
    switch (ch.kind) {
      case 'skip':
        return `skip ${name(ch.id)} (saves ${ch.savesSeconds}s)`;
      case 'short':
        return `short version of ${name(ch.id)} (saves ${ch.savesSeconds}s)`;
      case 'full':
        return `full version of ${name(ch.id)} (+${ch.addsSeconds}s)`;
      case 'add':
        return `added back ${name(ch.id)} (+${ch.addsSeconds}s)`;
    }
  });
  const label = paceLabel(pace);
  const prefix = label.tone === 'ok' ? '' : `${label.text} `;
  return `${prefix}→ ${parts.join(', ')}`;
}

/** Total planned seconds of an upcoming plan. */
export function planSeconds(plan: LivePlan, cards: Card[]): number {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return plan.ids.reduce((t, id) => t + spokenCard(byId.get(id)!, plan.shortIds).seconds, 0);
}
