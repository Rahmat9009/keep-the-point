import { askGeminiJson, asObject, countWords, extractJson, handle, shortString, InputError, type ApiResult, type GeminiOptions } from './_gemini.js';

/**
 * POST /api/setup: suggest how to group a script's numbered sentences into cue cards.
 *
 * The browser splits the script into sentences and sends them; the AI only answers with
 * sentence-number ranges, short titles and required points. The browser rebuilds every
 * card from the student's own sentences and checks the ranges again (see src/setup.ts).
 *
 * The app needs optional (untagged) cards it can cut, so the reply is checked: if it has
 * fewer cards than the script's length calls for, tags every card, or has a card far over
 * the size limit, the AI is asked once more with a short correction. If the second answer is still off, the better of the two
 * is used anyway: it's still the student's own words.
 */

export const MAX_SCRIPT_CHARS = 6000;
export const MAX_RUBRIC_CHARS = 2000;
export const MAX_SENTENCES = 400;
const MAX_CARDS = 12;
const MAX_POINTS = 6;
/** Target card size: 30 to 60 words (about 12 to 25 seconds). */
export const MIN_CARD_WORDS = 30;
export const MAX_CARD_WORDS = 60;
/** A card with several sentences and more words than this (the 60-word target plus a little slack) triggers the retry. */
export const OVERSIZE_WORDS = 65;
/** First request: the first model gets 6s, the whole request 11s. */
export const SETUP_FIRST_TIMEOUT_MS = 6_000;
export const SETUP_TOTAL_TIMEOUT_MS = 11_000;
/** Everything, including a retry, finishes within 18s (the function may run 20s). */
export const SETUP_OVERALL_MS = 18_000;
/** Don't start a retry with less time than this left. */
const MIN_RETRY_MS = 3_000;
export const SETUP_TEMPERATURE = 0.2;

export interface SetupInput {
  sentences: string[];
  rubric: string;
}

export interface SetupBody {
  cards: { start: number; end: number; title: string; points: string[] }[];
  points: string[];
  /** True when the first answer was corrected by a second request. */
  retried?: boolean;
}

export function parseSetupInput(body: unknown): SetupInput {
  const o = asObject(body, ['sentences', 'rubric']);
  const list = o.sentences;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SENTENCES) {
    throw new InputError(`sentences must be a list of 1 to ${MAX_SENTENCES} sentences.`);
  }
  const sentences = list.map((s, i) => {
    if (typeof s !== 'string' || !s.trim()) throw new InputError(`Sentence ${i + 1} must be some text.`);
    return s.trim();
  });
  const total = sentences.reduce((n, s) => n + s.length + 1, -1);
  if (total > MAX_SCRIPT_CHARS) throw new InputError(`The script is too long (max ${MAX_SCRIPT_CHARS.toLocaleString('en')} characters).`);
  return { sentences, rubric: shortString(o.rubric, 'Rubric', MAX_RUBRIC_CHARS) };
}

/** Fewest cards for this script: total words ÷ 60, rounded up, between 1 and 12 (and never more than the sentences). */
export function minCards(sentences: string[]): number {
  const words = sentences.reduce((n, s) => n + countWords(s), 0);
  return Math.max(1, Math.min(MAX_CARDS, sentences.length, Math.ceil(words / MAX_CARD_WORDS)));
}

export function setupPrompt(input: SetupInput): string {
  const n = input.sentences.length;
  const words = input.sentences.reduce((t, s) => t + countWords(s), 0);
  const min = minCards(input.sentences);
  return [
    'You help a student turn the script of a spoken talk into cue cards. Later, an app cuts optional cards so the talk fits a time limit,',
    'so the talk needs small cards, and some of them must be optional.',
    '',
    `The script has ${n} sentences and ${words} words. They are numbered below with their word counts.`,
    '',
    'Rules for cards:',
    '- Each card is a run of consecutive sentences, given as start and end sentence numbers (inclusive).',
    `- Cards are in order and together cover every sentence from 1 to ${n} exactly once: no gaps, no overlaps.`,
    `- Aim for ${MIN_CARD_WORDS} to ${MAX_CARD_WORDS} words per card (about 12 to 25 seconds of speaking).`,
    `  A card with more than one sentence must not go over ${MAX_CARD_WORDS} words: split long paragraphs into several cards.`,
    `- Make at least ${min} cards and at most ${MAX_CARDS}.`,
    '- Put each of these in its OWN card, separate from the main points: greetings and introductions, hooks, personal stories,',
    '  extra examples, asides and thank-yous. A short card is fine for these.',
    '- When a point is backed by several examples (a study, a statistic, a survey, a story), give each example its own card.',
    '- Give each card a title of at most 5 words naming its idea (for example "Greeting", "Main claim", "Sleep research", "Survey example").',
    '- Never rewrite, shorten or summarise the sentences. You only choose where cards start and end.',
    '',
    input.rubric
      ? [
          'The student pasted their rubric or assignment (between the lines):',
          '---',
          input.rubric,
          '---',
          `List at most ${MAX_POINTS} required points the talk must cover: short names (1 to 3 words) taken from the rubric.`,
          'Tag a card with a point ONLY if that card itself states the point. Usually each point is covered by exactly one card:',
          'for example, tag the card with the main evidence, not every card with an extra example.',
          'Most scripts should end up with some untagged (optional) cards: never tag every card.',
        ].join('\n')
      : 'There is no rubric: return an empty "points" list and an empty "points" list for every card.',
    '',
    'Sentences:',
    ...input.sentences.map((s, i) => `${i + 1}. (${countWords(s)} words) ${s}`),
    '',
    'Return JSON: {"cards": [{"start": 1, "end": 3, "title": "...", "points": ["..."]}], "points": ["..."]}.',
  ].join('\n');
}

export const SETUP_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'integer' },
          end: { type: 'integer' },
          title: { type: 'string' },
          points: { type: 'array', items: { type: 'string' } },
        },
        required: ['start', 'end', 'title', 'points'],
      },
    },
    points: { type: 'array', items: { type: 'string' } },
  },
  required: ['cards', 'points'],
};

/** Check the reply's shape. Ranges and card sizes are checked by setupProblems. */
export function extractSetup(data: unknown): SetupBody | null {
  const o = extractJson(data) as { cards?: unknown; points?: unknown } | null;
  if (!o || !Array.isArray(o.cards) || o.cards.length < 1 || o.cards.length > MAX_CARDS) return null;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim().length <= max ? v.trim() : null);
  const list = (v: unknown, maxItems: number) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > maxItems) return null;
    const items = v.map((x) => str(x, 60));
    return items.every((x): x is string => x !== null) ? items.filter(Boolean) : null;
  };
  const points = list(o.points, MAX_POINTS);
  if (!points) return null;
  const cards: SetupBody['cards'] = [];
  for (const c of o.cards as Record<string, unknown>[]) {
    if (typeof c !== 'object' || c === null) return null;
    const title = str(c.title, 80);
    const cardPoints = list(c.points, MAX_POINTS);
    if (!Number.isInteger(c.start) || !Number.isInteger(c.end) || title === null || !cardPoints) return null;
    cards.push({ start: c.start as number, end: c.end as number, title, points: cardPoints });
  }
  return { cards, points };
}

/**
 * What's wrong with a grouping, as short sentences for the correction note. Empty means fine.
 * Checks: ranges cover every sentence in order, enough cards, and not every card tagged.
 */
export function setupProblems(body: SetupBody, input: SetupInput): string[] {
  const problems: string[] = [];
  const n = input.sentences.length;
  let expected = 1;
  for (const c of body.cards) {
    if (c.start !== expected || c.end < c.start) {
      problems.push(`The ranges must run 1 to ${n} in order with no gaps or overlaps.`);
      break;
    }
    expected = c.end + 1;
  }
  if (!problems.length && expected - 1 !== n) problems.push(`The ranges must end at sentence ${n}.`);
  if (!problems.length) {
    const big = body.cards
      .map((c, i) => ({ i, words: input.sentences.slice(c.start - 1, c.end).reduce((t, x) => t + countWords(x), 0), many: c.end > c.start }))
      .filter((c) => c.many && c.words > OVERSIZE_WORDS);
    if (big.length) {
      problems.push(`${big.map((c) => `Card ${c.i + 1} has ${c.words} words`).join('; ')}. Split cards over ${MAX_CARD_WORDS} words, giving each example its own card.`);
    }
  }
  const min = minCards(input.sentences);
  if (body.cards.length < min) {
    problems.push(`You made ${body.cards.length} cards; make at least ${min}, each ${MIN_CARD_WORDS} to ${MAX_CARD_WORDS} words, with greetings, stories and asides in their own cards.`);
  }
  if (input.rubric && body.cards.length > 1 && body.cards.every((c) => c.points.length > 0)) {
    problems.push('Every card is tagged with a required point. Tag a card only if it states the point itself; greetings, stories, examples and asides stay untagged.');
  }
  return problems;
}

function correctionNote(problems: string[]): string {
  return ['', 'Your previous answer needs fixing:', ...problems.map((p) => `- ${p}`), 'Return the corrected JSON.'].join('\n');
}

export async function setup(body: unknown, opts: GeminiOptions = {}): Promise<ApiResult<SetupBody>> {
  const input = parseSetupInput(body);
  const started = Date.now();
  const prompt = setupPrompt(input);
  const ask = (text: string, totalMs: number) =>
    askGeminiJson(text, SETUP_SCHEMA, extractSetup, {
      firstTimeoutMs: SETUP_FIRST_TIMEOUT_MS,
      totalTimeoutMs: totalMs,
      temperature: SETUP_TEMPERATURE,
      ...opts,
    });

  const first = await ask(prompt, SETUP_TOTAL_TIMEOUT_MS);
  if (!('cards' in first.body)) return first;
  const problems = setupProblems(first.body, input);
  const left = SETUP_OVERALL_MS - (Date.now() - started);
  if (!problems.length || left < MIN_RETRY_MS) return first;

  const second = await ask(prompt + correctionNote(problems), Math.min(left, SETUP_TOTAL_TIMEOUT_MS));
  const trace = [...(first.trace ?? []), ...(second.trace ?? []).map((t) => `retry ${t}`)];
  // Keep whichever answer has fewer problems (the corrected one on a tie). Either is the student's own words.
  if ('cards' in second.body && setupProblems(second.body, input).length <= problems.length) {
    return { status: 200, body: { ...second.body, retried: true }, trace };
  }
  return { ...first, trace };
}

export function POST(req: Request): Promise<Response> {
  return handle(req, (body) => setup(body));
}
