import { askGeminiJson, asObject, extractJson, handle, shortString, InputError, type ApiResult, type GeminiOptions } from './_gemini.js';

/**
 * POST /api/setup: suggest how to group a script's numbered sentences into cue cards.
 *
 * The browser splits the script into sentences and sends them; the AI only answers with
 * sentence-number ranges, short titles and required points. The browser rebuilds every
 * card from the student's own sentences and checks the ranges (see src/setup.ts).
 */

export const MAX_SCRIPT_CHARS = 6000;
export const MAX_RUBRIC_CHARS = 2000;
export const MAX_SENTENCES = 400;
const MAX_CARDS = 12;
const MAX_POINTS = 6;
/** Grouping a whole script is a bigger job than one card: a little more time than shorten/bridge. */
export const SETUP_FIRST_TIMEOUT_MS = 8_000;
export const SETUP_TOTAL_TIMEOUT_MS = 16_000;

export interface SetupInput {
  sentences: string[];
  rubric: string;
}

export interface SetupBody {
  cards: { start: number; end: number; title: string; points: string[] }[];
  points: string[];
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

export function setupPrompt(input: SetupInput): string {
  const n = input.sentences.length;
  return [
    'You help a student turn the script of a spoken talk into cue cards.',
    `The script's ${n} sentences are numbered below. Group them into cards.`,
    '',
    'Rules for cards:',
    '- Each card is a run of consecutive sentences, given as start and end sentence numbers (inclusive).',
    `- Cards are in order and together cover every sentence from 1 to ${n} exactly once: no gaps, no overlaps.`,
    `- Make between 1 and ${MAX_CARDS} cards. Aim for one idea per card, about 25 to 100 words each.`,
    '- Give each card a title of at most 5 words naming its idea (for example "Hook", "Main claim", "Sleep research").',
    '- Never rewrite, shorten or summarise the sentences. You only choose where cards start and end.',
    '',
    input.rubric
      ? [
          'The student pasted their rubric or assignment (between the lines):',
          '---',
          input.rubric,
          '---',
          `List at most ${MAX_POINTS} required points the talk must cover: short names (1 to 3 words) taken from the rubric.`,
          'For each card, list which of those points it covers, using the same names. A card may cover none.',
        ].join('\n')
      : 'There is no rubric: return an empty "points" list and an empty "points" list for every card.',
    '',
    'Sentences:',
    ...input.sentences.map((s, i) => `${i + 1}. ${s}`),
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

/** Check the reply's shape (not the ranges: the browser checks those against its own sentences). */
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

export async function setup(body: unknown, opts: GeminiOptions = {}): Promise<ApiResult<SetupBody>> {
  const input = parseSetupInput(body);
  return askGeminiJson(setupPrompt(input), SETUP_SCHEMA, extractSetup, {
    firstTimeoutMs: SETUP_FIRST_TIMEOUT_MS,
    totalTimeoutMs: SETUP_TOTAL_TIMEOUT_MS,
    temperature: 0.2,
    ...opts,
  });
}

export function POST(req: Request): Promise<Response> {
  return handle(req, (body) => setup(body));
}
