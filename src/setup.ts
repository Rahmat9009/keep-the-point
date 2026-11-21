/**
 * Smart setup: turn a pasted script (and optional rubric) into cards.
 *
 * The student's words never change. The script is split into sentences here, the AI only
 * suggests how to group sentence numbers into cards (plus titles and required points), and
 * every card's text is rebuilt from the original sentences. If the AI's grouping is invalid
 * or the AI is unavailable, the script is split by paragraph instead.
 */
import { countWords, newCard, newCardId } from './outline';
import { MAX_CARDS } from './select';
import type { Card } from './types';

export const MAX_SCRIPT_CHARS = 6000;
export const MAX_RUBRIC_CHARS = 2000;
export const MAX_POINTS = 6;
export const MAX_TITLE_WORDS = 5;
/** A single paragraph longer than this (with no AI) is split into sentence groups of about this size. */
export const FALLBACK_CHUNK_WORDS = 45;

export interface Sentence {
  /** The sentence as written, with runs of whitespace collapsed to one space. */
  text: string;
  /** Which paragraph (blank-line separated block) it came from, starting at 0. */
  para: number;
}

/** Abbreviations whose full stop doesn't end a sentence. */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'e.g', 'i.e', 'a.m', 'p.m',
  'u.s', 'u.k', 'approx', 'dept', 'fig', 'no', 'vol', 'cf', 'ca', 'inc', 'ltd', 'co',
]);
/** Titles never end a sentence, even at a line break ("Dr.\nSmith"). */
const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'mt']);

const BULLET_LINE = /^\s*(?:[-*•–]|\d+[.)])\s/;

/** Split a script into sentences, keeping every word exactly as written. */
export function splitSentences(script: string): Sentence[] {
  const text = script.replace(/\r\n?/g, '\n');
  const paragraphs = text.split(/\n[ \t]*\n/).filter((p) => p.trim());
  const out: Sentence[] = [];
  paragraphs.forEach((para, index) => {
    for (const piece of splitParagraph(para)) {
      const clean = piece.replace(/\s+/g, ' ').trim();
      if (clean) out.push({ text: clean, para: index });
    }
  });
  return out;
}

function splitParagraph(para: string): string[] {
  const cuts = new Set<number>();

  // End punctuation, optional closing quotes/brackets, then whitespace.
  const end = /([.!?…]+)(["'”’)\]]*)(\s+)/g;
  for (let m = end.exec(para); m; m = end.exec(para)) {
    const cutAt = m.index + m[1].length + m[2].length;
    const space = m[3];
    const next = para.slice(cutAt + space.length);
    if (!next.trim()) continue;
    const lineBreak = space.includes('\n');
    const lineStart = para.lastIndexOf('\n', m.index - 1) + 1;
    const before = para.slice(lineStart, m.index);

    if (m[1] === '.' && !m[2]) {
      const word = /([A-Za-z][A-Za-z.]*)$/.exec(before)?.[1] ?? '';
      const lower = word.toLowerCase();
      if (TITLES.has(lower)) continue; // "Dr. Carskadon"
      if (ABBREVIATIONS.has(lower) && !lineBreak) continue; // "e.g. cats", "8:30 a.m. tomorrow"
      if (/^[A-Z]$/.test(word)) continue; // initials: "J. K. Rowling"
      if (/^\s*\d+$/.test(before)) continue; // list marker at the start of a line: "1. Intro"
    }
    // A lowercase word next means the sentence carries on ("wait... what").
    if (!lineBreak && /^\s*[a-z]/.test(next)) continue;
    cuts.add(cutAt);
  }

  // A line that starts with a bullet or number starts a new sentence.
  const bullet = /\n/g;
  for (let m = bullet.exec(para); m; m = bullet.exec(para)) {
    if (BULLET_LINE.test(para.slice(m.index + 1).split('\n')[0] + ' ')) cuts.add(m.index);
  }

  const pieces: string[] = [];
  let from = 0;
  for (const at of [...cuts].sort((a, b) => a - b)) {
    pieces.push(para.slice(from, at));
    from = at;
  }
  pieces.push(para.slice(from));
  return pieces;
}

/* ---------- Grouping ---------- */

/** A run of consecutive sentences, numbered from 1 and inclusive. */
export interface Range {
  start: number;
  end: number;
}

/**
 * Check an AI grouping: 1 to 12 ranges of whole numbers, in order, with no gaps or overlaps,
 * covering sentences 1..count exactly. Returns an error message, or null when it's valid.
 */
export function rangeProblem(ranges: Range[], count: number): string | null {
  if (!Array.isArray(ranges) || ranges.length === 0) return 'no cards';
  if (ranges.length > MAX_CARDS) return `more than ${MAX_CARDS} cards`;
  let expected = 1;
  for (const r of ranges) {
    if (!Number.isInteger(r?.start) || !Number.isInteger(r?.end)) return 'a range is not whole numbers';
    if (r.start > r.end) return 'a range runs backwards';
    if (r.start < expected) return r.start < 1 ? 'a range starts before sentence 1' : 'ranges overlap or are out of order';
    if (r.start > expected) return `sentence ${expected} is missing`;
    expected = r.end + 1;
  }
  if (expected - 1 > count) return 'a range goes past the last sentence';
  if (expected - 1 < count) return `sentence ${expected} is missing`;
  return null;
}

/** Fallback grouping: one card per paragraph, merging the smallest neighbours until there are at most 12. */
export function paragraphRanges(sentences: Sentence[]): Range[] {
  if (!sentences.length) return [];
  const groups: { start: number; end: number; words: number }[] = [];
  sentences.forEach((s, i) => {
    const last = groups[groups.length - 1];
    const n = i + 1;
    if (last && sentences[i - 1].para === s.para) {
      last.end = n;
      last.words += countWords(s.text);
    } else {
      groups.push({ start: n, end: n, words: countWords(s.text) });
    }
  });

  // One long paragraph and no AI: split it into sentence groups of roughly FALLBACK_CHUNK_WORDS.
  if (groups.length === 1 && groups[0].words > FALLBACK_CHUNK_WORDS * 1.5 && sentences.length > 1) {
    groups.length = 0;
    sentences.forEach((s, i) => {
      const last = groups[groups.length - 1];
      const words = countWords(s.text);
      if (last && last.words + words <= FALLBACK_CHUNK_WORDS) {
        last.end = i + 1;
        last.words += words;
      } else {
        groups.push({ start: i + 1, end: i + 1, words });
      }
    });
  }

  while (groups.length > MAX_CARDS) {
    // Merge the smallest group into its smaller neighbour.
    let smallest = 0;
    groups.forEach((g, i) => { if (g.words < groups[smallest].words) smallest = i; });
    const left = smallest - 1;
    const right = smallest + 1;
    const into = left < 0 ? right : right >= groups.length ? left : groups[left].words <= groups[right].words ? left : right;
    const a = Math.min(into, smallest);
    groups.splice(a, 2, { start: groups[a].start, end: groups[a + 1].end, words: groups[a].words + groups[a + 1].words });
  }
  return groups.map(({ start, end }) => ({ start, end }));
}

/** Pull up to 6 point names out of a rubric, for when the AI isn't available. */
export function rubricPoints(rubric: string): string[] {
  const body = rubric.replace(/^[^:\n]*\b(?:include|cover|have|contain)s?\b[^:\n]*:/i, '');
  const items = body
    .split(/[\n,;•]+|\band\b/i)
    .map((s) => s.replace(/^\s*(?:[-*–]|\d+[.)])\s*/, '').replace(/[.:]+$/, '').trim())
    .filter((s) => s && s.length <= 40 && countWords(s) <= 4);
  return dedupe(items.map(capitalise)).slice(0, MAX_POINTS);
}

/** At most 5 words, trimmed; empty means "no title" (the app then uses the first words). */
export function cleanTitle(title: unknown): string | undefined {
  if (typeof title !== 'string') return undefined;
  const words = title.replace(/[“”"]/g, '').trim().split(/\s+/).filter(Boolean).slice(0, MAX_TITLE_WORDS);
  const clean = words.join(' ').replace(/[.:;,]+$/, '');
  return clean || undefined;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------- Building the cards ---------- */

/** What the AI sent back (already checked for shape by the server). */
export interface AiGrouping {
  cards: { start: number; end: number; title?: string; points?: string[] }[];
  points: string[];
}

export interface SetupResult {
  cards: Card[];
  requiredPoints: string[];
  /** 'ai' when the AI grouping was used; otherwise why the paragraph split was used instead. */
  source: 'ai' | 'paragraphs';
  note?: string;
}

/**
 * Build cards from the original sentences. Uses the AI grouping when it is valid, otherwise
 * splits by paragraph. Seconds are word-count estimates; priority is the default (3).
 */
export function buildSetup(
  sentences: Sentence[],
  rubric: string,
  ai: AiGrouping | null,
  aiError?: string,
  makeId: () => string = newCardId,
): SetupResult {
  const problem = ai ? rangeProblem(ai.cards, sentences.length) : null;
  if (ai && !problem) {
    const points = rubric.trim() ? dedupe(ai.points.map((p) => capitalise(p.trim())).filter((p) => p && p.length <= 40)).slice(0, MAX_POINTS) : [];
    const byLower = new Map(points.map((p) => [p.toLowerCase(), p]));
    const cards = ai.cards.map((g) => {
      const card = newCard(joinSentences(sentences, g), makeId);
      const title = cleanTitle(g.title);
      if (title) card.title = title;
      card.tags = dedupe((g.points ?? []).map((p) => byLower.get(String(p).trim().toLowerCase())).filter((p): p is string => !!p));
      return card;
    });
    return { cards, requiredPoints: points, source: 'ai' };
  }
  const cards = paragraphRanges(sentences).map((g) => newCard(joinSentences(sentences, g), makeId));
  const note = ai ? `The AI's grouping didn't check out (${problem}), so your script was split by paragraph.` : `${aiError ? `${aiError} ` : ''}Your script was split by paragraph instead.`;
  return { cards, requiredPoints: rubricPoints(rubric), source: 'paragraphs', note };
}

function joinSentences(sentences: Sentence[], r: Range): string {
  return sentences.slice(r.start - 1, r.end).map((s) => s.text).join(' ');
}

/* ---------- Sample for "Try with a messy script" ---------- */

export const MESSY_SCRIPT = `Okay so, um, hi everyone. My topic today is why school should start later. I really think it should, and not just because I like sleeping in!

So here's my claim. School should start at 9:00 instead of 7:45, because teenagers are biologically wired to fall asleep later. It's not laziness, it's science.

According to Dr. Mary Carskadon, a sleep researcher at Brown University, teens need about 8.5 to 9.5 hours of sleep a night. But most of us get around 7. The American Academy of Pediatrics actually says middle and high schools shouldn't start before 8:30 a.m.
When a district in Seattle pushed its start time back by almost an hour, students got 34 more minutes of sleep on average, and their grades went up 4.5 percent. I also did my own survey of 40 students in our grade, and 31 of them said they feel tired during first period.

Now, some people say, "If school starts later, it just ends later, and that messes up sports and jobs." That's a fair point. Buses would have to be rescheduled too, and that costs money. Some parents also worry about getting younger kids to school in the morning.
But schools that changed found ways to make it work, like moving practices to the evening and staggering bus routes.

So to wrap up: later start times mean more sleep, better grades and healthier students. I think our school should at least try it for one semester. Thanks for listening! Any questions?`;

export const MESSY_RUBRIC = 'Must include: claim, evidence, counterargument, conclusion';
