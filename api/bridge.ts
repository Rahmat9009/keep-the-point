import { askGemini, asObject, cardText, countWords, handle, shortString, InputError, type ApiResult, type GeminiOptions } from './_gemini.js';

export const MAX_BRIDGE_WORDS = 15;

export interface BridgeInput {
  /** Kept card before the gap, or null at the very start of the talk. */
  before: string | null;
  cut: string[];
  /** Kept card after the gap. */
  after: string;
  title: string;
}

export function parseBridgeInput(body: unknown): BridgeInput {
  const o = asObject(body, ['before', 'cut', 'after', 'title']);
  if (!Array.isArray(o.cut) || o.cut.length < 1 || o.cut.length > 11) {
    throw new InputError('cut must be a list of 1 to 11 cards.');
  }
  return {
    before: o.before === null || o.before === undefined ? null : cardText(o.before, 'The card before'),
    cut: o.cut.map((c, i) => cardText(c, `Cut card ${i + 1}`)),
    after: cardText(o.after, 'The card after'),
    title: shortString(o.title, 'Title', 300),
  };
}

export function bridgePrompt(input: BridgeInput): string {
  return [
    'A student cut part of a spoken talk to fit a time limit. Write ONE short sentence they can say to link the parts that remain.',
    `Talk title: ${JSON.stringify(input.title || 'Untitled talk')}`,
    `Card said just before the gap: ${input.before === null ? '(none: this is the start of the talk)' : JSON.stringify(input.before)}`,
    `Cut card(s), no longer said: ${JSON.stringify(input.cut)}`,
    `Card said right after the gap: ${JSON.stringify(input.after)}`,
    '',
    `Rules: at most ${MAX_BRIDGE_WORDS} words. Sound like a student speaking. Lead naturally into the card after the gap.`,
    'Do not add any new facts or numbers, and do not retell the cut content.',
    'Return JSON: {"text": "<the linking sentence>"}.',
  ].join('\n');
}

export async function bridge(body: unknown, opts?: GeminiOptions): Promise<ApiResult> {
  const result = await askGemini(bridgePrompt(parseBridgeInput(body)), opts);
  if ('text' in result.body && countWords(result.body.text) > MAX_BRIDGE_WORDS) {
    return { status: 502, body: { error: 'The suggestion came back too long. Try again.' }, trace: result.trace };
  }
  return result;
}

export function POST(req: Request): Promise<Response> {
  return handle(req, (body) => bridge(body));
}
