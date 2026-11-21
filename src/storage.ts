import { HISTORY_LIMIT, type PracticeRun, type RunCard, type RunKind } from './insights';
import type { Card, Talk } from './types';

export const STORAGE_KEY = 'keep-the-point:v1';
/** Longest card title kept when loading. */
export const MAX_TITLE = 200;

export interface SavedState {
  talk: Talk;
  /** Time limit as the student typed it, e.g. "2:00". */
  limit: string;
  /** Last few completed practice runs, oldest first. */
  history?: PracticeRun[];
}

/** Minimal storage interface so tests can pass a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // e.g. storage blocked by the browser
  }
}

/** Read the saved talk. Returns null if nothing usable is saved or storage is unavailable. */
export function loadState(store: KeyValueStore | null = defaultStore()): SavedState | null {
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw ? parseSavedState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Save the talk. Failures (full or blocked storage) are ignored: saving is a convenience. */
export function saveState(state: SavedState, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState(store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Validate untrusted saved data, dropping anything malformed. */
export function parseSavedState(data: unknown): SavedState | null {
  if (!isObject(data) || !isObject(data.talk)) return null;
  const t = data.talk;
  if (!Array.isArray(t.cards) || !Array.isArray(t.requiredPoints)) return null;

  const requiredPoints = [...new Set(t.requiredPoints.filter(isString).map((p) => p.trim()).filter(Boolean))];
  const seenIds = new Set<string>();
  const cards: Card[] = [];
  for (const c of t.cards) {
    if (!isObject(c) || !isString(c.id) || seenIds.has(c.id)) continue;
    if (typeof c.seconds !== 'number' || !Number.isFinite(c.seconds) || c.seconds < 1) continue;
    seenIds.add(c.id);
    const card: Card = {
      id: c.id,
      text: isString(c.text) ? c.text : '',
      seconds: Math.round(c.seconds),
      tags: Array.isArray(c.tags) ? c.tags.filter((tag): tag is string => isString(tag) && requiredPoints.includes(tag)) : [],
      locked: c.locked === true,
    };
    if (typeof c.priority === 'number' && Number.isInteger(c.priority) && c.priority >= 1 && c.priority <= 5) {
      card.priority = c.priority;
    }
    if (c.estimated === true) card.estimated = true;
    if (isString(c.title) && c.title.trim() && c.title.length <= MAX_TITLE) card.title = c.title;
    const sh = c.short;
    if (isObject(sh) && isString(sh.text) && sh.text.trim() && typeof sh.seconds === 'number' && Number.isFinite(sh.seconds) && sh.seconds >= 1) {
      card.short = { text: sh.text, seconds: Math.round(sh.seconds) };
      if (sh.estimated === true) card.short.estimated = true;
    }
    cards.push(card);
  }

  const bridges: Record<string, string> = {};
  if (isObject(t.bridges)) {
    for (const [key, text] of Object.entries(t.bridges)) {
      if (isString(text) && text.trim() && text.length <= 500) bridges[key] = text;
    }
  }

  return {
    talk: { title: isString(t.title) && t.title.trim() ? t.title : 'My talk', cards, requiredPoints, ...(Object.keys(bridges).length ? { bridges } : {}) },
    limit: isString(data.limit) ? data.limit : '2:00',
    ...(Array.isArray(data.history) ? { history: parseHistory(data.history) } : {}),
  };
}

const RUN_KINDS: RunKind[] = ['full', 'short', 'live', 'card'];
const isSeconds = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 36_000;

function parseHistory(list: unknown[]): PracticeRun[] {
  const runs: PracticeRun[] = [];
  for (const r of list) {
    if (!isObject(r) || !RUN_KINDS.includes(r.kind as RunKind) || !Array.isArray(r.cards) || !isSeconds(r.totalSeconds)) continue;
    const cards: RunCard[] = [];
    for (const c of r.cards) {
      if (!isObject(c) || !isString(c.id) || !isSeconds(c.planned) || !isSeconds(c.actual)) continue;
      cards.push({ id: c.id, planned: c.planned, actual: c.actual, ...(c.short === true ? { short: true } : {}) });
    }
    if (!cards.length) continue;
    runs.push({
      kind: r.kind as RunKind,
      at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0,
      cards,
      totalSeconds: r.totalSeconds,
      ...(r.sample === true ? { sample: true } : {}),
    });
  }
  return runs.slice(-HISTORY_LIMIT);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
