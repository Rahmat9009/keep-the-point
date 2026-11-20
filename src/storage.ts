import type { Card, Talk } from './types';

export const STORAGE_KEY = 'keep-the-point:v1';

export interface SavedState {
  talk: Talk;
  /** Time limit as the student typed it, e.g. "2:00". */
  limit: string;
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
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
