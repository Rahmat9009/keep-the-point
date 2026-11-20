import { askGemini, asObject, cardText, handle, shortString, stringList, InputError, type ApiResult, type GeminiOptions } from './_gemini.js';

export interface ShortenInput {
  text: string;
  targetSeconds: number;
  title: string;
  requiredPoints: string[];
}

export function parseShortenInput(body: unknown): ShortenInput {
  const o = asObject(body, ['text', 'targetSeconds', 'title', 'requiredPoints']);
  const target = o.targetSeconds;
  if (typeof target !== 'number' || !Number.isInteger(target) || target < 1 || target > 1800) {
    throw new InputError('targetSeconds must be a whole number from 1 to 1800.');
  }
  return {
    text: cardText(o.text, 'Card text'),
    targetSeconds: target,
    title: shortString(o.title, 'Title', 300),
    requiredPoints: stringList(o.requiredPoints, 'Required points', 20, 100),
  };
}

export function shortenPrompt(input: ShortenInput): string {
  const words = Math.max(5, Math.round(input.targetSeconds * 2.5));
  return [
    'You help a student shorten one cue card of a spoken talk so it fits a time limit.',
    `Talk title: ${JSON.stringify(input.title || 'Untitled talk')}`,
    `Points the whole talk must cover: ${JSON.stringify(input.requiredPoints)}`,
    `Card text: ${JSON.stringify(input.text)}`,
    '',
    `Rewrite the card so it takes about ${input.targetSeconds} seconds to say (about ${words} words at 150 words per minute).`,
    "Rules: keep the speaker's own voice and words where possible (first person stays first person).",
    'Keep every fact, name and number from the card. Do not add any new facts, examples or claims.',
    'If the card is only a short label or note, return a shorter label in the same style.',
    'Return JSON: {"text": "<the short version>"}.',
  ].join('\n');
}

export async function shorten(body: unknown, opts?: GeminiOptions): Promise<ApiResult> {
  return askGemini(shortenPrompt(parseShortenInput(body)), opts);
}

export function POST(req: Request): Promise<Response> {
  return handle(req, (body) => shorten(body));
}
