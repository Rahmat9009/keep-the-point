import './tokens.css';
import './style.css';
import { cardTitle, cardsFromOutline, countWords, estimateSeconds, newCard, parseOutline } from './outline';
import { SAMPLE_LIMIT, sampleRuns, sampleTalk, upgradeOldSample } from './sample';
import { addRun, cardsRunningLong, makeRun, progressLine, replaceTalk, tendencyLine, type RunCard, type RunKind } from './insights';
import { capybaraSvg } from './capybara';
import { openCueView, printSheetHtml, type CueView } from './cueView';
import { openRehearsal } from './rehearsalView';
import { openLive } from './liveView';
import { MAX_CARDS, shortenedLabel, spokenCard } from './select';
import { AI_NOTICE, THINKING_HTML, requestBridge, requestSetup, requestShorten, shortenTarget } from './ai';
import { MAX_RUBRIC_CHARS, MAX_SCRIPT_CHARS, MESSY_RUBRIC, MESSY_SCRIPT, buildSetup, splitSentences, type SetupResult } from './setup';
import { clearState, loadState, saveState, type SavedState } from './storage';
import { cardTimeLabel, summarize, type Summary } from './summary';
import { addPoint, emptyTalk, moveCard, removePoint } from './talk';
import { formatTime, parseTime } from './time';
import type { Card } from './types';
import { MAX_SPEAKER_NAME, speakerName, speakerTimes } from './group';
import { speakerTimesHtml } from './groupView';

const DEFAULT_LIMIT = '2:00';
const MAX_SECONDS = 3600;

const savedState = upgradeOldSample(loadState());
let state: SavedState = savedState ?? { talk: structuredClone(sampleTalk), limit: SAMPLE_LIMIT, history: sampleRuns() };

/** Slider range: 0:30 up to the full talk length, in 5-second steps. */
const SLIDER_MIN = 30;
const SLIDER_STEP = 5;
const HINT_KEY = 'keep-the-point:slider-hint-done';
function hintDone(): boolean {
  try {
    return globalThis.localStorage?.getItem(HINT_KEY) === '1';
  } catch {
    return true;
  }
}
function markHintDone() {
  try {
    globalThis.localStorage?.setItem(HINT_KEY, '1');
  } catch {
    /* ignore */
  }
}

/* ---------- Static layout ---------- */

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <div class="page">
    <header class="top">
      <div class="top__brand">${capybaraSvg('capy capy--brand')}<h1 class="brand">Keep the Point</h1></div>
      <label class="visually-hidden" for="title">Talk title</label>
      <textarea id="title" class="talk-title" rows="1" autocomplete="off" spellcheck="true"></textarea>
      <ol class="how" aria-label="How it works">
        <li><a href="#outline-box" id="how-paste"><b aria-hidden="true">1</b>Paste your talk</a></li>
        <li><b aria-hidden="true">2</b>Set your time</li>
        <li><b aria-hidden="true">3</b>Get cue cards that fit</li>
      </ol>
    </header>

    <div class="hero-sentinel" id="hero-sentinel" aria-hidden="true"></div>
    <section class="hero" id="hero" aria-label="Time limit and result">
      <div id="summary" class="summary" aria-live="polite"></div>
      <div class="limit-row">
        <label for="limit">Fit it into</label>
        <input id="limit" type="text" inputmode="numeric" placeholder="mm:ss" aria-describedby="limit-error" />
        <span id="slider-hint" class="slider-hint" ${hintDone() ? 'hidden' : ''}>Try it: drag to cut the talk</span>
      </div>
      <input id="limit-slider" class="slider" type="range" min="${SLIDER_MIN}" step="${SLIDER_STEP}" aria-label="Time limit slider" />
      <p id="limit-error" class="error" role="alert"></p>
    </section>

    <div class="actions actions--top" role="group" aria-label="Practise and present">
      <button id="open-cues" class="primary" type="button" aria-describedby="rehearse-note">Open cue cards</button>
      <button id="rehearse-full" type="button">▶ Rehearse full talk</button>
      <button id="rehearse-short" type="button" aria-describedby="rehearse-note">▶ Rehearse shortened talk</button>
      <button id="present-live" type="button">▶ Present live</button>
      <p id="rehearse-note" class="hint rehearse-note"></p>
    </div>

    <section class="talk" aria-labelledby="talk-h">
      <div class="grid3 intro">
        <div class="intro__main">
          <h2 id="talk-h">Your talk <span id="card-count" class="count"></span></h2>
          <p class="sub">Tap a card to edit it. Pink means cut, yellow means said in the short version.</p>
          <p class="hint ai-notice">✨ ${AI_NOTICE}</p>
          <p id="too-many" class="notice" hidden></p>
        </div>
        <aside class="intro__note" aria-labelledby="points-h">
          <h3 id="points-h">Required points</h3>
          <p class="hint">Things your talk must cover. Tag the cards that cover each one.</p>
          <ul id="point-list" class="points"></ul>
          <form id="point-form" class="inline-form">
            <label class="visually-hidden" for="point-name">New required point</label>
            <input id="point-name" type="text" placeholder="e.g. Evidence" autocomplete="off" aria-describedby="point-error" />
            <button type="submit">Add point</button>
          </form>
          <p id="point-error" class="error" role="alert"></p>
          <section id="insights" class="insights" aria-labelledby="insights-h" tabindex="-1">
            <h3 id="insights-h">Practice insights</h3>
            <div id="insights-body"></div>
          </section>
        </aside>
      </div>

      <details class="outline group-settings" ${state.talk.groupMode ? 'open' : ''}>
        <summary>Group presentation</summary>
        <label class="check"><input id="group-mode" type="checkbox" aria-controls="group-options" /> Assign speakers to cards</label>
        <div id="group-options" hidden>
          <p class="hint">Enter a speaker for each card. The whole team shares the time limit, including handoffs.</p>
          <div id="group-speakers"></div>
          <datalist id="speaker-names"></datalist>
          <div id="group-plan"></div>
        </div>
      </details>
      <ol id="rows" class="rows"></ol>
      <p id="no-cards" class="empty" hidden>No cards yet. Paste an outline below, load the sample talk, or add a card.</p>

      <div class="grid3 end">
        <div class="end__main">
          <div class="buttons">
            <button id="add-card" type="button">+ Add card</button>
            <button id="load-sample" type="button">Load sample talk</button>
            <button id="clear" class="danger" type="button">Clear</button>
          </div>
          <details id="outline-box" class="outline">
            <summary>Paste your talk</summary>
            <div class="setup">
              <label class="field" for="script">Your script <span class="hint">(paragraphs are fine)</span></label>
              <textarea id="script" rows="9" placeholder="Paste what you'll say, word for word." aria-describedby="script-count"></textarea>
              <p id="script-count" class="hint setup__count"></p>
              <label class="field" for="rubric">What must you cover? <span class="hint">(optional: paste your rubric or assignment)</span></label>
              <textarea id="rubric" rows="3" placeholder="e.g. Must include: claim, evidence, counterargument, conclusion"></textarea>
              <p id="setup-error" class="error" role="alert"></p>
              <div class="buttons">
                <button id="make-smart" class="primary" type="button">✨ Make my cards</button>
                <button id="try-messy" type="button">Try with a messy script</button>
              </div>
              <p class="hint setup__notice">✨ ${AI_NOTICE} Your words stay exactly as you wrote them: the AI only suggests where each card starts and ends.</p>
              <button id="show-lines" class="linkbtn setup__lines" type="button" aria-expanded="false" aria-controls="line-mode">or split it line by line myself</button>
              <div id="line-mode" class="line-mode" hidden>
                <label for="outline" class="hint">One card per line.</label>
                <textarea id="outline" rows="5" placeholder="Hook: why does bread rise?&#10;My research question&#10;How I tested it"></textarea>
                <p id="outline-error" class="error" role="alert"></p>
                <button id="make-cards" type="button">Make cards</button>
              </div>
              <section id="setup-preview" class="preview" hidden aria-labelledby="preview-h"></section>
            </div>
          </details>
        </div>
      </div>
    </section>

    <footer class="app-footer">${capybaraSvg('capy capy--foot')}<span>Keep the Point · timed by a very patient capybara</span></footer>
  </div>
`;

/** Hidden on screen; the only thing shown when printing. */
const printSheet = document.createElement('div');
printSheet.className = 'print-sheet';
printSheet.setAttribute('aria-hidden', 'true');
document.body.append(printSheet);

const $ = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
const titleInput = $<HTMLTextAreaElement>('#title');
const limitInput = $<HTMLInputElement>('#limit');
const limitError = $('#limit-error');
const limitSlider = $<HTMLInputElement>('#limit-slider');
const sliderHint = $('#slider-hint');
const summaryEl = $('#summary');
const tooManyEl = $('#too-many');
const heroEl = $('#hero');
const outlineBox = $<HTMLDetailsElement>('#outline-box');
const outlineInput = $<HTMLTextAreaElement>('#outline');
const scriptInput = $<HTMLTextAreaElement>('#script');
const rubricInput = $<HTMLTextAreaElement>('#rubric');
const scriptCount = $('#script-count');
const setupError = $('#setup-error');
const makeSmartBtn = $<HTMLButtonElement>('#make-smart');
const tryMessyBtn = $<HTMLButtonElement>('#try-messy');
const lineMode = $('#line-mode');
const showLinesBtn = $<HTMLButtonElement>('#show-lines');
const previewEl = $('#setup-preview');
const outlineError = $('#outline-error');
const pointList = $('#point-list');
const pointForm = $<HTMLFormElement>('#point-form');
const pointName = $<HTMLInputElement>('#point-name');
const pointError = $('#point-error');
const rowsEl = $('#rows');
const groupModeInput = $<HTMLInputElement>('#group-mode');
const groupOptions = $('#group-options');
const groupSpeakers = $('#group-speakers');
const groupPlan = $('#group-plan');
const speakerNames = $('#speaker-names');
const noCards = $('#no-cards');
const cardCount = $('#card-count');
const rehearseFull = $<HTMLButtonElement>('#rehearse-full');
const rehearseShort = $<HTMLButtonElement>('#rehearse-short');
const rehearseNote = $('#rehearse-note');
const openCuesBtn = $<HTMLButtonElement>('#open-cues');
const presentLive = $<HTMLButtonElement>('#present-live');
const insightsEl = $('#insights');
const insightsBody = $('#insights-body');

/** Cards the selection keeps right now (null when there's no shortened talk to rehearse). */
let shortenedCards: Card[] | null = null;
/** Kept cards that use their short version in the current selection. */
let currentShortIds: string[] = [];

/** Short-version drafts not accepted yet, by card id (not saved). */
interface ShortDraft {
  text: string;
  loading?: boolean;
  error?: string;
}
const drafts = new Map<string, ShortDraft>();
/** Cards with fewer words than this are not sent to the AI. */
const MIN_SHORTEN_WORDS = 15;
/** "Already short." notes under the Shorten button, by card id (not saved). */
const shortNotes = new Map<string, string>();
/** The card open for editing in the talk list (not saved). Tap a card to open it. */
let editingId: string | null = null;
/** Latest selection summary, used when one row re-renders on its own. */
let lastSummary: Summary | null = null;

/* ---------- State changes ---------- */

/** Call after any change. `structural` re-renders the editor (don't use it while the student is typing). */
function changed(structural: boolean) {
  const budget = parseTime(state.limit);
  const summary = budget === null ? null : summarize(state.talk.cards, state.talk.requiredPoints, budget);
  if (structural) {
    renderEditor(summary ?? lastSummary);
    renderGroupFields();
  }
  renderGroupPlan(summary);
  renderResults(summary, budget);
  saveState(state);
}

function cardById(id: string): Card | undefined {
  return state.talk.cards.find((c) => c.id === id);
}

/* ---------- Header + time limit ---------- */

titleInput.addEventListener('input', () => {
  // A title is one line: newlines from pasting become spaces.
  if (/[\r\n]/.test(titleInput.value)) titleInput.value = titleInput.value.replace(/\s*[\r\n]+\s*/g, ' ');
  state.talk.title = titleInput.value;
  fitTitle();
  changed(false);
});
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.preventDefault();
});
window.addEventListener('resize', fitTitle);

/** Grow the title box to fit its text so long titles wrap instead of being cut off. */
function fitTitle() {
  titleInput.style.height = 'auto';
  titleInput.style.height = `${titleInput.scrollHeight}px`;
}

limitInput.addEventListener('input', () => {
  state.limit = limitInput.value;
  changed(false);
});

limitSlider.addEventListener('input', () => {
  state.limit = formatTime(Number(limitSlider.value));
  limitInput.value = state.limit;
  if (!sliderHint.hidden) {
    sliderHint.hidden = true;
    markHintDone();
  }
  changed(false);
});

/** Keep the slider's range and position in step with the cards and the typed limit. */
function syncSlider(budget: number | null) {
  const full = state.talk.cards.reduce((t, c) => t + c.seconds, 0);
  const max = SLIDER_MIN + Math.max(SLIDER_STEP, Math.ceil((full - SLIDER_MIN) / SLIDER_STEP) * SLIDER_STEP);
  limitSlider.max = String(max);
  limitSlider.disabled = state.talk.cards.length === 0;
  if (budget !== null) limitSlider.value = String(Math.min(max, Math.max(SLIDER_MIN, budget)));
  limitSlider.setAttribute('aria-valuetext', budget === null ? 'No valid limit' : formatTime(budget));
  const value = Number(limitSlider.value);
  limitSlider.style.setProperty('--fill', `${((value - SLIDER_MIN) / Math.max(1, max - SLIDER_MIN)) * 100}%`);
}

/* ---------- Outline / sample / clear ---------- */

$('#make-cards').addEventListener('click', () => {
  const lines = parseOutline(outlineInput.value);
  if (lines.length === 0) {
    outlineError.textContent = 'Paste at least one line first.';
    outlineInput.focus();
    return;
  }
  outlineError.textContent = '';
  const existing = state.talk.cards.length;
  if (existing > 0 && !confirm(`Replace your ${plural(existing, 'card')} with ${plural(lines.length, 'new card')}?`)) {
    return;
  }
  state = replaceTalk(state, { ...state.talk, cards: cardsFromOutline(outlineInput.value) });
  editingId = null;
  outlineBox.open = false;
  changed(true);
  rowsEl.querySelector<HTMLElement>('[data-action="edit"]')?.focus();
});

/** "1 Paste your talk" opens the outline box and puts the cursor in it. */
$('#how-paste').addEventListener('click', (e) => {
  e.preventDefault();
  outlineBox.open = true;
  outlineBox.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  scriptInput.focus({ preventScroll: true });
});

$('#load-sample').addEventListener('click', () => {
  if (state.talk.cards.length > 0 && !confirm('Replace your talk with the sample science-fair talk?')) return;
  state.talk = structuredClone(sampleTalk);
  state.limit = SAMPLE_LIMIT;
  state.history = sampleRuns();
  editingId = null;
  syncInputs();
  changed(true);
});

$('#clear').addEventListener('click', () => {
  if (!confirm('Clear everything and start fresh? Your cards and required points will be deleted.')) return;
  clearState();
  state = { talk: emptyTalk(), limit: DEFAULT_LIMIT, history: [] };
  editingId = null;
  outlineInput.value = '';
  outlineError.textContent = '';
  scriptInput.value = '';
  rubricInput.value = '';
  setupError.textContent = '';
  hidePreview();
  updateScriptCount();
  pointError.textContent = '';
  syncInputs();
  changed(true);
  outlineBox.open = true;
  scriptInput.focus();
});

/* ---------- Smart setup: script (+ rubric) → cards ---------- */

/** Cards waiting in the preview (not saved until "Use these cards"). */
let pendingSetup: SetupResult | null = null;

function updateScriptCount() {
  const n = scriptInput.value.length;
  scriptCount.textContent = `${n.toLocaleString('en')} / ${MAX_SCRIPT_CHARS.toLocaleString('en')} characters`;
  scriptCount.classList.toggle('setup__count--over', n > MAX_SCRIPT_CHARS);
}
scriptInput.addEventListener('input', updateScriptCount);

showLinesBtn.addEventListener('click', () => {
  lineMode.hidden = !lineMode.hidden;
  showLinesBtn.setAttribute('aria-expanded', String(!lineMode.hidden));
  if (!lineMode.hidden) outlineInput.focus();
});

tryMessyBtn.addEventListener('click', () => {
  const own = scriptInput.value.trim() && scriptInput.value !== MESSY_SCRIPT;
  if (own && !confirm('Replace what you pasted with the example script?')) return;
  scriptInput.value = MESSY_SCRIPT;
  rubricInput.value = MESSY_RUBRIC;
  setupError.textContent = '';
  updateScriptCount();
  makeSmartBtn.focus();
});

makeSmartBtn.addEventListener('click', async () => {
  const script = scriptInput.value;
  const rubric = rubricInput.value.trim();
  const problem = !script.trim()
    ? 'Paste your script first.'
    : script.length > MAX_SCRIPT_CHARS
      ? `Your script is ${script.length.toLocaleString('en')} characters. The limit is ${MAX_SCRIPT_CHARS.toLocaleString('en')}: try pasting part of it.`
      : rubric.length > MAX_RUBRIC_CHARS
        ? `The rubric is too long (max ${MAX_RUBRIC_CHARS.toLocaleString('en')} characters).`
        : null;
  setupError.textContent = problem ?? '';
  if (problem) {
    (script.trim() && script.length <= MAX_SCRIPT_CHARS ? rubricInput : scriptInput).focus();
    return;
  }
  const sentences = splitSentences(script);
  setBusy(true);
  const reply = await requestSetup({ sentences: sentences.map((x) => x.text), rubric });
  setBusy(false);
  pendingSetup = buildSetup(sentences, rubric, reply.ok ? reply.data : null, reply.ok ? undefined : reply.message);
  renderPreview(pendingSetup);
});

function setBusy(busy: boolean) {
  makeSmartBtn.disabled = busy;
  tryMessyBtn.disabled = busy;
  makeSmartBtn.toggleAttribute('aria-busy', busy);
  makeSmartBtn.innerHTML = busy ? THINKING_HTML : '✨ Make my cards';
}

function renderPreview(result: SetupResult) {
  const total = result.cards.reduce((t, c) => t + c.seconds, 0);
  previewEl.hidden = false;
  previewEl.innerHTML = `
    <h3 id="preview-h" tabindex="-1">Your talk as ${plural(result.cards.length, 'card')} <span class="count">· ~${formatTime(total)}</span></h3>
    ${result.source === 'ai'
      ? '<p class="hint">Grouped by AI. Every word is yours. Times are estimates from word count; each card starts at priority 3 for you to change.</p>'
      : `<p class="notice">${esc(result.note ?? 'Your script was split by paragraph.')}</p>`}
    ${result.requiredPoints.length
      ? `<p class="preview__points"><span>Required points:</span> ${result.requiredPoints.map((p) => `<span class="preview__chip">${esc(p)}</span>`).join(' ')}</p>`
      : ''}
    <ol class="preview__list">
      ${result.cards.map((c, i) => `
        <li>
          <span class="preview__n" aria-hidden="true">${i + 1}</span>
          <div class="preview__body">
            <b>${esc(cardTitle(c) || '(empty card)')}</b>
            <span class="preview__first">${esc(firstLine(c.text))}</span>
            ${c.tags.length ? `<span class="preview__tags">Covers ${esc(c.tags.join(', '))}</span>` : ''}
          </div>
          <span class="preview__secs">~${c.seconds}s</span>
        </li>`).join('')}
    </ol>
    <div class="buttons">
      <button id="use-cards" class="primary" type="button">Use these cards</button>
      <button id="cancel-preview" type="button">Cancel</button>
    </div>`;
  previewEl.querySelector<HTMLElement>('#preview-h')!.focus();
}

/** The card's first sentence, cut to about 90 characters. */
function firstLine(text: string): string {
  const first = splitSentences(text)[0]?.text ?? text;
  return first.length > 90 ? `${first.slice(0, 88).trimEnd()}…` : first;
}

function hidePreview() {
  pendingSetup = null;
  previewEl.hidden = true;
  previewEl.innerHTML = '';
}

/** True when there's nothing of the student's to lose: no cards, or the untouched sample talk. */
function talkIsPristine(): boolean {
  const { cards, requiredPoints } = state.talk;
  if (cards.length === 0) return true;
  return canonical({ cards, requiredPoints }) === canonical({ cards: sampleTalk.cards, requiredPoints: sampleTalk.requiredPoints });
}

/** JSON with object keys sorted, so a talk loaded from storage compares equal to the same talk in code. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

previewEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('#cancel-preview')) {
    hidePreview();
    makeSmartBtn.focus();
    return;
  }
  if (!target.closest('#use-cards') || !pendingSetup) return;
  const result = pendingSetup;
  const existing = state.talk.cards.length;
  if (!talkIsPristine() && !confirm(`Replace your ${plural(existing, 'card')} with ${plural(result.cards.length, 'new card')}?`)) return;
  const { bridges: _oldBridges, ...rest } = state.talk;
  state = replaceTalk(state, {
    ...rest,
    title: state.talk.title === sampleTalk.title ? 'My talk' : state.talk.title,
    cards: result.cards,
    requiredPoints: result.requiredPoints,
  });
  editingId = null;
  hidePreview();
  outlineBox.open = false;
  syncInputs();
  changed(true);
  $('#talk-h').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  rowsEl.querySelector<HTMLElement>('[data-action="edit"]')?.focus({ preventScroll: true });
});

/* ---------- Required points ---------- */

pointForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const result = addPoint(state.talk, pointName.value);
  if (result.error !== undefined) {
    pointError.textContent = result.error;
    return;
  }
  pointError.textContent = '';
  state.talk = result.talk;
  pointName.value = '';
  changed(true);
  pointName.focus();
});

pointList.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-point]');
  if (!btn) return;
  state.talk = removePoint(state.talk, btn.dataset.point!);
  changed(true);
  pointName.focus();
});

/* ---------- Group presentation ---------- */

groupModeInput.addEventListener('change', () => {
  if (groupModeInput.checked) state.talk.groupMode = true;
  else delete state.talk.groupMode;
  changed(true);
});

groupSpeakers.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const card = input.dataset.speakerCard ? cardById(input.dataset.speakerCard) : undefined;
  if (!card) return;
  const value = speakerName(input.value, state.talk.cards.filter((other) => other !== card));
  if (value) card.speaker = value;
  else delete card.speaker;
  input.value = value ?? '';
  changed(false);
});

function renderGroupFields() {
  const enabled = state.talk.groupMode === true;
  groupModeInput.checked = enabled;
  groupOptions.hidden = !enabled;
  groupSpeakers.innerHTML = enabled ? state.talk.cards.map((card, i) => `
    <label class="group-speaker">
      <span data-speaker-title>${i + 1}. ${esc(cardTitle(card) || '(empty card)')}</span>
      <input type="text" autocomplete="off" list="speaker-names" maxlength="${MAX_SPEAKER_NAME}"
        data-speaker-card="${esc(card.id)}" value="${esc(card.speaker ?? '')}" placeholder="Speaker name" />
    </label>`).join('') : '';
}

function renderGroupPlan(summary: Summary | null) {
  if (!state.talk.groupMode) return;
  const cards = state.talk.cards;
  groupSpeakers.querySelectorAll('[data-speaker-title]').forEach((label, index) => {
    const card = cards[index];
    if (card) label.textContent = `${index + 1}. ${cardTitle(card) || '(empty card)'}`;
  });
  const names = new Set(cards.flatMap((card) => card.speaker ? [card.speaker] : []));
  speakerNames.innerHTML = [...names].map((name) => `<option value="${esc(name)}"></option>`).join('');
  if (!cards.length) {
    groupPlan.innerHTML = '<p class="hint">Add a card to assign a speaker.</p>';
    return;
  }
  const result = summary?.result;
  if (!result?.fits) {
    groupPlan.innerHTML = '<p class="hint">Fit the talk to a valid time limit to see each speaker’s planned time.</p>';
    return;
  }
  const kept = new Set(result.kept.map((card) => card.id));
  const planned = speakerTimes(cards, (card) => kept.has(card.id) ? spokenCard(card, result.shortIds).seconds : 0);
  groupPlan.innerHTML = speakerTimesHtml(planned) + '<p class="hint">Planned time comes from the selected cue cards. Rehearsal measures handoffs separately.</p>';
}

/* ---------- Card rows ---------- */

$('#add-card').addEventListener('click', () => {
  const card = newCard('');
  state.talk.cards.push(card);
  editingId = card.id; // a new card opens ready to type
  changed(true);
  rowsEl.querySelector<HTMLInputElement>(`[data-id="${card.id}"] [data-field="text"]`)?.focus();
});

rowsEl.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  const row = el.closest<HTMLElement>('[data-id]');
  const card = row && cardById(row.dataset.id!);
  if (!row || !card) return;

  if (el.dataset.field === 'title') {
    if (el.value.trim()) card.title = el.value;
    else delete card.title;
    changed(false);
  } else if (el.dataset.field === 'text') {
    card.text = el.value;
    row.querySelector<HTMLInputElement>('[data-field="title"]')?.setAttribute('placeholder', titlePlaceholder(card));
    if (shortNotes.delete(card.id)) renderShort(card.id);
    const shortenBtn = row.querySelector<HTMLButtonElement>('[data-action="shorten"]');
    if (shortenBtn && !drafts.get(card.id)?.loading) shortenBtn.disabled = !card.text.trim();
    if (card.estimated) {
      card.seconds = estimateSeconds(card.text);
      row.querySelector<HTMLInputElement>('[data-field="seconds"]')!.value = String(card.seconds);
    }
    changed(false);
  } else if (el.dataset.field === 'draft') {
    const draft = drafts.get(card.id);
    if (!draft) return;
    draft.text = el.value;
    row.querySelector('[data-ref="draft-est"]')!.textContent = draftEstimate(card, draft.text);
  } else if (el.dataset.field === 'short' && card.short) {
    if (!el.value.trim()) return; // keep the last non-empty text; "Remove" deletes it
    card.short.text = el.value;
    if (card.short.estimated) {
      card.short.seconds = estimateSeconds(el.value);
      row.querySelector<HTMLInputElement>('[data-field="short-seconds"]')!.value = String(card.short.seconds);
    }
    row.querySelector('[data-ref="short-saves"]')!.textContent = savesLabel(card);
    changed(false);
  } else if (el.dataset.field === 'short-seconds' && card.short) {
    const n = Number(el.value);
    const valid = el.value.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_SECONDS;
    el.toggleAttribute('aria-invalid', !valid);
    if (!valid) return;
    card.short.seconds = n;
    card.short.estimated = false;
    row.querySelector('[data-ref="short-saves"]')!.textContent = savesLabel(card);
    row.querySelector('.row__short')?.classList.remove('short--est');
    changed(false);
  } else if (el.dataset.field === 'seconds') {
    const n = Number(el.value);
    const valid = el.value.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_SECONDS;
    el.toggleAttribute('aria-invalid', !valid);
    if (!valid) return; // keep the last good value until they fix it
    card.seconds = n;
    card.estimated = false;
    row.classList.remove('card--est');
    changed(false);
  }
});

rowsEl.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const row = el.closest<HTMLElement>('[data-id]');
  const card = row && cardById(row.dataset.id!);
  if (!row || !card) return;

  switch (el.dataset.field) {
    case 'seconds': // leaving the field with an invalid value restores the last good one
      el.value = String(card.seconds);
      el.removeAttribute('aria-invalid');
      return;
    case 'short-seconds':
      if (card.short) el.value = String(card.short.seconds);
      el.removeAttribute('aria-invalid');
      return;
    case 'short':
      if (card.short) el.value = card.short.text;
      return;
    case 'tag': {
      const point = el.value;
      const checked = (el as HTMLInputElement).checked;
      card.tags = checked ? [...new Set([...card.tags, point])] : card.tags.filter((t) => t !== point);
      break;
    }
    case 'locked':
      card.locked = (el as HTMLInputElement).checked;
      row.classList.toggle('card--locked', card.locked);
      break;
    case 'priority':
      if (el.value === '') delete card.priority;
      else card.priority = Number(el.value);
      break;
    default:
      return;
  }
  changed(false);
});

rowsEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest<HTMLButtonElement>('button[data-action]');
  // Tapping anywhere on a closed card opens it for editing.
  const view = btn ? null : target.closest<HTMLElement>('.card__view');
  const row = (btn ?? view)?.closest<HTMLElement>('[data-id]');
  if (!row) return;
  const id = row.dataset.id!;
  if (view) {
    openEditor(id);
    return;
  }
  const index = state.talk.cards.findIndex((c) => c.id === id);
  const action = btn!.dataset.action!;
  if (handleShortAction(action, state.talk.cards[index])) return;

  if (action === 'edit') {
    openEditor(id);
    return;
  }
  if (action === 'done') {
    closeEditor(true);
    return;
  }
  if (action === 'keep') {
    // "Keep this card" on a cut card: the same as ticking Always keep.
    state.talk.cards[index].locked = true;
    changed(true);
    rowsEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] [data-action="edit"]`)?.focus();
    return;
  }

  if (action === 'up' || action === 'down') {
    state.talk.cards = moveCard(state.talk.cards, index, action === 'up' ? -1 : 1);
    changed(true);
    // Keep focus on the moved card's button (or its other arrow if this one is now disabled).
    const moved = rowsEl.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    const same = moved.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
    (same.disabled ? moved.querySelector<HTMLButtonElement>(`[data-action="${action === 'up' ? 'down' : 'up'}"]`)! : same).focus();
  } else if (action === 'delete') {
    state.talk.cards.splice(index, 1);
    if (editingId === id) editingId = null;
    changed(true);
    const next = state.talk.cards[Math.min(index, state.talk.cards.length - 1)];
    (next
      ? rowsEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(next.id)}"] [data-action="edit"]`)
      : $('#add-card'))?.focus();
  }
});

// Escape closes the open card (unless a short-version draft box has focus and wants to keep typing).
rowsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !editingId) return;
  if ((e.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id') !== editingId) return;
  e.preventDefault();
  closeEditor(true);
});

/** Open one card for editing (closing any other) and put the cursor in its text. */
function openEditor(id: string) {
  const previous = editingId;
  editingId = id;
  if (previous && previous !== id) renderRow(previous);
  renderRow(id);
  rowsEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] [data-field="text"]`)?.focus();
}

function closeEditor(focusCard: boolean) {
  const id = editingId;
  if (!id) return;
  editingId = null;
  renderRow(id);
  if (focusCard) rowsEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] [data-action="edit"]`)?.focus();
}

/* ---------- Short versions ---------- */

/** Handle a short-version button. Returns true if `action` was one. */
function handleShortAction(action: string, card: Card | undefined): boolean {
  if (!card) return false;
  switch (action) {
    case 'shorten':
      void shortenWithAi(card);
      return true;
    case 'write-own':
      drafts.set(card.id, { text: '' });
      renderShort(card.id, 'draft');
      return true;
    case 'accept': {
      const draft = drafts.get(card.id);
      if (!draft) return true;
      const text = draft.text.trim();
      if (!text) {
        draft.error = 'Type a short version first, or discard it.';
        renderShort(card.id, 'draft');
        return true;
      }
      card.short = { text, seconds: estimateSeconds(text), estimated: true };
      drafts.delete(card.id);
      changed(false);
      renderShort(card.id, 'short');
      return true;
    }
    case 'discard':
      drafts.delete(card.id);
      renderShort(card.id, card.short ? 'short' : 'shorten');
      return true;
    case 'remove-short':
      delete card.short;
      changed(false);
      renderShort(card.id, 'shorten');
      return true;
  }
  return false;
}

async function shortenWithAi(card: Card) {
  if (!card.text.trim()) return;
  const id = card.id;
  if (countWords(card.text) < MIN_SHORTEN_WORDS) {
    shortNotes.set(id, 'Already short.');
    renderShort(id, 'shorten');
    return;
  }
  shortNotes.delete(id);
  drafts.set(id, { text: drafts.get(id)?.text ?? '', loading: true });
  renderShort(id);
  const result = await requestShorten({
    text: card.text,
    targetSeconds: shortenTarget(card.seconds),
    title: state.talk.title,
    requiredPoints: state.talk.requiredPoints,
  });
  if (!cardById(id)) return; // deleted meanwhile
  drafts.set(id, result.ok ? { text: result.text } : { text: '', error: result.message });
  renderShort(id, 'draft');
}

function draftEstimate(card: Card, text: string): string {
  if (!text.trim()) return '';
  return `~${estimateSeconds(text)}s (full card ${card.estimated ? '~' : ''}${card.seconds}s)`;
}

function savesLabel(card: Card): string {
  if (!card.short) return '';
  const diff = card.seconds - card.short.seconds;
  return diff > 0 ? `saves ${diff}s` : diff < 0 ? `${-diff}s longer than the full card` : 'same length as the full card';
}

function shortSectionHtml(card: Card, n: number): string {
  const draft = drafts.get(card.id);
  const noText = !card.text.trim();
  const aiButton = (label: string) =>
    `<button type="button" data-action="shorten" ${noText || draft?.loading ? 'disabled' : ''} ${draft?.loading ? 'aria-busy="true"' : ''} ${noText ? 'title="Write the card first"' : ''}>${draft?.loading ? THINKING_HTML : label}</button>`;
  const id = esc(card.id);

  let html = '';
  if (card.short) {
    const s = card.short;
    html += `
      <label class="short__label" for="short-${id}">Short version</label>
      <textarea id="short-${id}" class="short__text" rows="2" data-field="short">${esc(s.text)}</textarea>
      <div class="short__meta">
        <span class="row__secs"><span class="tilde" title="Estimated from word count">~</span><input type="number" min="1" max="${MAX_SECONDS}" step="1" data-field="short-seconds" value="${s.seconds}" aria-label="Card ${n} short version length in seconds" /><span aria-hidden="true">s</span></span>
        <span class="hint" data-ref="short-saves">${esc(savesLabel(card))}</span>
        <span class="short__buttons">${draft && !draft.loading ? '' : aiButton('✨ Suggest again')}<button type="button" data-action="remove-short" class="danger">Remove short version</button></span>
      </div>`;
  }
  if (draft && !draft.loading) {
    html += `
      ${draft.error ? `<p class="error" role="alert">${esc(draft.error)}</p>` : ''}
      <label class="short__label" for="draft-${id}">${card.short ? 'New suggestion' : 'Short version'} <span class="hint">(not used until you accept it)</span></label>
      <textarea id="draft-${id}" class="short__text short__text--draft" rows="2" data-field="draft" placeholder="Write a shorter way to say this card">${esc(draft.text)}</textarea>
      <div class="short__meta">
        <span class="hint" data-ref="draft-est">${esc(draftEstimate(card, draft.text))}</span>
        <span class="short__buttons">
          <button type="button" data-action="accept" class="primary">${card.short ? 'Replace' : 'Accept'}</button>
          <button type="button" data-action="discard">Discard</button>
        </span>
      </div>`;
  } else if (!card.short) {
    html += `<div class="short__buttons">${aiButton('✨ Shorten')}${draft?.loading ? '' : '<button type="button" data-action="write-own">Write my own short version</button>'}</div>`;
    const note = shortNotes.get(card.id);
    if (note && !draft) html += `<p class="hint short__note" role="status">${esc(note)}</p>`;
  }
  return html;
}

/** Re-render one row's short-version area and optionally move focus into it. */
function renderShort(id: string, focus?: 'draft' | 'short' | 'shorten') {
  const row = rowsEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  const card = cardById(id);
  if (!row || !card) return;
  const box = row.querySelector<HTMLElement>('.row__short');
  if (!box) return; // card is closed; the draft shows when it's opened again
  box.classList.toggle('short--est', !!card.short?.estimated);
  box.innerHTML = shortSectionHtml(card, state.talk.cards.indexOf(card) + 1);
  const target =
    focus === 'draft'
      ? '[data-field="draft"]'
      : focus === 'short'
        ? '[data-field="short"]'
        : focus === 'shorten'
          ? '[data-action="shorten"]:not([disabled]), [data-action="write-own"]'
          : null;
  if (target) box.querySelector<HTMLElement>(target)?.focus();
}

/* ---------- Rehearsal ---------- */

function startRehearsal(kind: RunKind, label: string, cards: Card[], trigger: HTMLButtonElement, shortIds: string[] = []) {
  const limit = parseTime(state.limit);
  if (limit === null || cards.length === 0) return;
  const spoken = structuredClone(cards.map((c) => spokenCard(c, shortIds)));
  openRehearsal({
    label,
    cards: spoken,
    talk: structuredClone(state.talk),
    shortIds,
    limitSeconds: limit,
    onComplete(measured, handoffSeconds) {
      recordRun(
        kind,
        spoken.map((c) => {
          const short = shortIds.includes(c.id) && !!c.short;
          return { id: c.id, planned: c.seconds, actual: measured.get(c.id) ?? 0, ...(short ? { short: true } : {}) };
        }),
        handoffSeconds,
      );
    },
    onSave(measured) {
      for (const card of state.talk.cards) {
        const seconds = measured.get(card.id);
        if (seconds === undefined) continue;
        if (shortIds.includes(card.id) && card.short) {
          card.short.seconds = seconds;
          card.short.estimated = false;
        } else {
          card.seconds = seconds;
          card.estimated = false;
        }
      }
      changed(true);
    },
    onClose: () => (trigger.isConnected ? trigger : insightsEl).focus(),
  });
}

/* ---------- Cue cards ---------- */

let cueView: CueView | null = null;

openCuesBtn.addEventListener('click', () => {
  cueView = openCueView({
    getState: () => ({ talk: state.talk, limitSeconds: parseTime(state.limit) }),
    keepCard(id) {
      const card = cardById(id);
      if (!card) return;
      card.locked = true;
      changed(true);
    },
    unlockCard(id) {
      const card = cardById(id);
      if (!card) return;
      card.locked = false;
      changed(true);
    },
    setBridge(key, text) {
      const bridges = (state.talk.bridges ??= {});
      if (text.trim()) bridges[key] = text;
      else delete bridges[key];
      printSheet.innerHTML = printSheetHtml(state.talk, parseTime(state.limit));
      saveState(state);
    },
    requestBridge,
    onClose() {
      cueView = null;
      openCuesBtn.focus();
    },
  });
});

rehearseFull.addEventListener('click', () => startRehearsal('full', 'Full talk', state.talk.cards, rehearseFull));
rehearseShort.addEventListener('click', () => {
  if (shortenedCards) startRehearsal('short', 'Shortened talk', shortenedCards, rehearseShort, currentShortIds);
});

presentLive.addEventListener('click', () => {
  const limit = parseTime(state.limit);
  if (limit === null || state.talk.cards.length === 0 || state.talk.cards.length > MAX_CARDS) return;
  openLive({
    talk: structuredClone(state.talk),
    limitSeconds: limit,
    onComplete(measured, handoffSeconds) {
      const runCards: RunCard[] = [];
      for (const [id, m] of measured) {
        const card = cardById(id);
        if (!card) continue;
        const short = m.short && !!card.short;
        runCards.push({ id, planned: short ? card.short!.seconds : card.seconds, actual: m.seconds, ...(short ? { short: true } : {}) });
      }
      recordRun('live', runCards, handoffSeconds);
    },
    onSave(measured) {
      for (const card of state.talk.cards) {
        const m = measured.get(card.id);
        if (!m) continue;
        if (m.short && card.short) {
          card.short.seconds = m.seconds;
          card.short.estimated = false;
        } else {
          card.seconds = m.seconds;
          card.estimated = false;
        }
      }
      changed(true);
    },
    onClose: () => presentLive.focus(),
  });
});

/* ---------- Practice insights ---------- */

/** Every finished run goes into the history, even when its times are discarded. */
function recordRun(kind: RunKind, cards: RunCard[], handoffSeconds: number) {
  if (!cards.length) return;
  state.history = addRun(state.history ?? [], makeRun(kind, cards, Date.now(), handoffSeconds));
  saveState(state);
  renderInsights();
}

function renderInsights() {
  const history = state.history ?? [];
  if (!history.length) {
    insightsBody.innerHTML = '<p class="hint">Rehearse once to see insights.</p>';
    return;
  }
  const progress = progressLine(history);
  const tendency = tendencyLine(history);
  const long = cardsRunningLong(history, state.talk.cards);
  const sample = history.some((r) => r.sample);
  const longHtml = long.length
    ? `<p class="insights__label">Keeps running long</p>
       <ul class="insights__long">${long
         .map(
           (l) => `<li>
             <span>${esc(cardTitle(l.card) || '(empty card)')}${l.short ? ' (short)' : ''} · planned ${l.planned}s · you average ${Math.round(l.average)}s</span>
             <button type="button" class="insights__practise" data-practise="${esc(l.card.id)}" data-short="${l.short ? '1' : ''}">Practise this card</button>
           </li>`,
         )
         .join('')}</ul>`
    : progress
      ? '<p class="hint">No card keeps running long.</p>'
      : '<p class="hint">Rehearse the whole talk to see your progress.</p>';
  insightsBody.innerHTML = `
    ${sample ? '<p class="insights__sample">Sample practice runs. Rehearse to replace them with yours.</p>' : ''}
    ${progress ? `<p class="insights__progress"><span class="insights__label">Progress</span> <b>${esc(progress)}</b></p>` : ''}
    ${longHtml}
    ${tendency ? `<p class="insights__tendency">${esc(tendency)}</p>` : ''}
  `;
}

insightsBody.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-practise]');
  if (!btn) return;
  const card = cardById(btn.dataset.practise!);
  if (!card) return;
  const short = btn.dataset.short === '1' && !!card.short;
  startRehearsal('card', `Practise: ${cardTitle(card) || 'card'}`, [card], btn, short ? [card.id] : []);
});

function updateRehearseButtons(fits: boolean, limitValid: boolean) {
  const cards = state.talk.cards;
  rehearseFull.disabled = cards.length === 0 || !limitValid;
  presentLive.disabled = cards.length === 0 || cards.length > MAX_CARDS || !limitValid || (fits && !shortenedCards?.length);
  rehearseShort.disabled = !fits || !shortenedCards?.length;
  openCuesBtn.disabled = rehearseShort.disabled;
  rehearseNote.textContent =
    fits && cards.length > 0 && !shortenedCards?.length
      ? 'The current time limit leaves no cards to present.'
      : cards.length === 0 || !limitValid || fits
        ? ''
        : cards.length > MAX_CARDS
          ? 'Cue cards, shortened rehearsal and Present live need 12 cards or fewer.'
          : 'Shortened rehearsal and cue cards are available once the talk can fit the time limit.';
}

/* ---------- Rendering ---------- */

function syncInputs() {
  titleInput.value = state.talk.title;
  limitInput.value = state.limit;
  fitTitle();
}

type CardState = 'kept' | 'short' | 'cut' | 'none';

/** How the current selection uses a card, plus why it was cut. Only reads the summary; no selection logic here. */
function cardStatus(card: Card, summary: Summary | null): { state: CardState; reason: string } {
  const result = summary?.result;
  if (!summary || !result || (!result.fits && !result.shortest)) return { state: 'none', reason: '' };
  if (summary.keptCards.some((c) => c.id === card.id)) {
    return { state: summary.shortIds.includes(card.id) ? 'short' : 'kept', reason: '' };
  }
  const reason = result.fits ? (result.cut.find((c) => c.card.id === card.id)?.reason ?? '') : 'Not in the shortest valid talk';
  return { state: 'cut', reason };
}

function renderEditor(summary: Summary | null) {
  const { cards } = state.talk;
  cardCount.textContent = !cards.length
    ? ''
    : cards.length > MAX_CARDS
      ? `(${cards.length}, max ${MAX_CARDS})`
      : `(${cards.length} of ${MAX_CARDS})`;
  cardCount.classList.toggle('count--over', cards.length > MAX_CARDS);
  noCards.hidden = cards.length > 0;
  if (cards.length === 0) outlineBox.open = true;
  rowsEl.innerHTML = cards.map((card, i) => rowHtml(card, i, summary)).join('');
}

/** Re-render one card in place (opening or closing it). */
function renderRow(id: string) {
  const card = cardById(id);
  const li = rowsEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  if (!card || !li) return;
  li.outerHTML = rowHtml(card, state.talk.cards.indexOf(card), lastSummary);
}

function rowClass(card: Card, st: CardState): string {
  return [
    'card',
    `card--${st}`,
    card.locked ? 'card--locked' : '',
    card.estimated ? 'card--est' : '',
    editingId === card.id ? 'card--editing' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function rowHtml(card: Card, i: number, summary: Summary | null): string {
  const { state: st, reason } = cardStatus(card, summary);
  const editing = editingId === card.id;
  return `
    <li class="${rowClass(card, st)}" data-id="${esc(card.id)}">
      <div class="card__gutter"><span class="card__n" aria-hidden="true">${i + 1}</span><span class="card__secs" data-ref="secs">${secsLabel(card, st, summary)}</span></div>
      <div class="card__body" data-ref="body">${editing ? editHtml(card, i) : viewHtml(card, i, st)}</div>
      <aside class="card__note" data-ref="note">${noteHtml(card, st, reason, summary)}</aside>
    </li>`;
}

function secsLabel(card: Card, st: CardState, summary: Summary | null): string {
  return st === 'short' ? cardTimeLabel(spokenCard(card, summary?.shortIds ?? [])) : cardTimeLabel(card);
}

function viewHtml(card: Card, i: number, st: CardState): string {
  const title = cardTitle(card);
  const text = card.text.trim();
  let extra = '';
  if (st === 'short' && card.short) extra = `<p class="card__short"><span class="hl">${esc(card.short.text)}</span></p>`;
  else if (card.short) extra = `<p class="card__spare">Short version ready (${card.short.estimated ? '~' : ''}${card.short.seconds}s), not needed at this limit.</p>`;
  const body = !text
    ? '<p class="card__text card__text--empty">Tap to write what you&#39;ll say.</p>'
    : text !== title
      ? `<p class="card__text">${esc(card.text)}</p>`
      : '';
  return `
    <div class="card__view">
      <h3 class="card__title"><button type="button" class="card__open" data-action="edit" aria-expanded="false" aria-label="Edit card ${i + 1}: ${esc(title || 'empty card')}">${esc(title) || '(empty card)'}</button></h3>
      ${state.talk.groupMode && card.speaker ? `<p class="hint card__speaker">${esc(card.speaker)}</p>` : ''}
      ${body}
      ${extra}
    </div>`;
}

function editHtml(card: Card, i: number): string {
  const n = i + 1;
  const { requiredPoints, cards } = state.talk;
  const tagBoxes = requiredPoints.length
    ? requiredPoints
        .map((p) => `<label class="tag"><input type="checkbox" data-field="tag" value="${esc(p)}" ${card.tags.includes(p) ? 'checked' : ''} /> ${esc(p)}</label>`)
        .join('')
    : '<span class="hint">Add required points to tag cards.</span>';
  const priorityOptions = ['', '1', '2', '3', '4', '5']
    .map((v) => `<option value="${v}" ${String(card.priority ?? '') === v ? 'selected' : ''}>${v || '—'}</option>`)
    .join('');
  return `
    <div class="edit">
      <div class="edit__two">
        <label class="field">Title <span class="hint">(optional)</span>
          <input class="edit__title" type="text" data-field="title" value="${esc(card.title ?? '')}" placeholder="${esc(titlePlaceholder(card))}" maxlength="200" aria-label="Card ${n} title (optional)" />
        </label>
        <label class="field">Seconds
          <span class="secs"><span class="tilde" title="Estimated from word count">~</span><input type="number" min="1" max="${MAX_SECONDS}" step="1" data-field="seconds" value="${card.seconds}" aria-label="Card ${n} length in seconds" /></span>
        </label>
      </div>
      <label class="field">What you'll say
        <textarea data-field="text" rows="4" placeholder="What you'll say" aria-label="Card ${n} spoken text">${esc(card.text)}</textarea>
      </label>
      <fieldset class="edit__tags"><legend>Covers</legend>${tagBoxes}</fieldset>
      <div class="edit__row">
        <label class="check"><input type="checkbox" data-field="locked" ${card.locked ? 'checked' : ''} /> Always keep</label>
        <label class="check">Priority <select data-field="priority" aria-label="Card ${n} priority">${priorityOptions}</select></label>
      </div>
      <div class="row__short ${card.short?.estimated ? 'short--est' : ''}">${shortSectionHtml(card, n)}</div>
      <div class="edit__actions">
        <button type="button" data-action="up" aria-label="Move card ${n} up" ${i === 0 ? 'disabled' : ''}>↑ Up</button>
        <button type="button" data-action="down" aria-label="Move card ${n} down" ${i === cards.length - 1 ? 'disabled' : ''}>↓ Down</button>
        <button type="button" data-action="delete" class="danger" aria-label="Delete card ${n}">Delete</button>
        <button type="button" data-action="done" class="primary">Done</button>
      </div>
    </div>`;
}

function noteHtml(card: Card, st: CardState, reason: string, summary: Summary | null): string {
  const lock = card.locked ? '<span class="note__lock">Always keep</span>' : '';
  if (st === 'cut') {
    const canKeep = !!summary?.result?.fits && !card.locked;
    return `<b class="note__cut">Cut</b>${esc(reason)}${canKeep ? '<br /><button type="button" class="linkbtn" data-action="keep">Keep this card</button>' : ''}`;
  }
  if (st === 'short') {
    return `<b>${esc(shortenedLabel(card))}</b>${card.tags.length ? `Covers ${esc(card.tags.join(', '))}.` : ''}${lock}`;
  }
  if (st === 'kept') {
    if (card.tags.length) return `<b>Covers ${esc(card.tags.join(', '))}</b>${lock}`;
    return `<b>${card.priority !== undefined ? `Priority ${card.priority}` : 'No priority'}</b>Optional${lock}`;
  }
  return lock;
}

function renderResults(summary: Summary | null, budget: number | null) {
  const { cards } = state.talk;
  printSheet.innerHTML = printSheetHtml(state.talk, budget);
  cueView?.refresh();
  limitError.textContent = budget === null ? 'Enter a time like 2:00' : '';
  limitInput.toggleAttribute('aria-invalid', budget === null);
  syncSlider(budget);
  renderPoints(summary ?? lastSummary);
  renderInsights();
  if (budget === null || !summary) {
    updateRehearseButtons(false, false);
    return; // keep showing the last valid result
  }
  lastSummary = summary;
  const result = summary.result;

  if (summary.headline && summary.chips) {
    const [first, afterTrim] = summary.headline.split(' → ');
    const before = afterTrim
      ? `<span class="was">${esc(first)}</span><span class="to" aria-hidden="true">→</span><span class="visually-hidden"> cut to </span>`
      : '';
    const chipClass = (c: string) => (c.includes('shortened') ? 'chip--short' : c.includes('cut') ? 'chip--cut' : 'chip--spare');
    summaryEl.className = 'summary';
    summaryEl.innerHTML = `
      <p class="big">${before}<span class="now">${esc(afterTrim ?? first)}</span></p>
      <ul class="chips">${summary.chips.map((c) => `<li class="${chipClass(c)}">${esc(c)}</li>`).join('')}</ul>`;
  } else {
    summaryEl.className = `summary ${summary.tone === 'bad' ? 'summary--bad' : 'summary--quiet'}`;
    summaryEl.innerHTML = `<p class="big big--text">${esc(summary.text)}</p>`;
  }
  shortenedCards = result?.fits ? result.kept : null;
  currentShortIds = summary.shortIds;
  updateRehearseButtons(!!result?.fits, true);

  tooManyEl.hidden = cards.length <= MAX_CARDS;
  if (cards.length > MAX_CARDS) {
    tooManyEl.textContent = `Keep the Point can sort out up to ${MAX_CARDS} cards. Merge or delete ${plural(cards.length - MAX_CARDS, 'card')} and your result will appear here.`;
  }

  // Update each card's marks in place. The open card keeps its editor (and focus); only its marks change.
  for (const card of cards) {
    const li = rowsEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(card.id)}"]`);
    if (!li) continue;
    const { state: st, reason } = cardStatus(card, summary);
    li.className = rowClass(card, st);
    li.querySelector('[data-ref="secs"]')!.innerHTML = secsLabel(card, st, summary);
    li.querySelector('[data-ref="note"]')!.innerHTML = noteHtml(card, st, reason, summary);
    if (editingId !== card.id) li.querySelector('[data-ref="body"]')!.innerHTML = viewHtml(card, cards.indexOf(card), st);
  }
}

/** Required points with who covers each one, and a × to remove it. */
function renderPoints(summary: Summary | null) {
  const { requiredPoints } = state.talk;
  const kept = summary?.result ? summary.keptCards : null;
  pointList.innerHTML = requiredPoints.length
    ? requiredPoints
        .map((p) => {
          const by = kept ? kept.filter((c) => c.tags.includes(p)).map((c) => cardTitle(c) || '(empty card)') : null;
          const missing = by !== null && by.length === 0;
          return `<li class="${missing ? 'missing' : by ? 'covered' : ''}">
            <span class="pt">${esc(p)}</span>
            <span class="by">${by === null ? '' : by.length ? esc(by.join(', ')) : 'Not covered'}</span>
            <button type="button" class="pt__remove" data-point="${esc(p)}" aria-label="Remove required point ${esc(p)}">×</button>
          </li>`;
        })
        .join('')
    : '<li class="none">None yet.</li>';
}

/* ---------- Helpers ---------- */

/** Placeholder for the title box: the title the card gets if the student leaves it empty. */
function titlePlaceholder(card: Card): string {
  return cardTitle({ text: card.text }) || 'Title (optional)';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/* ---------- Sticky time control ---------- */

// The hero sticks to the top while you scroll the talk; once it's stuck it shrinks so the cards stay visible.
const sentinel = $('#hero-sentinel');
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => heroEl.classList.toggle('hero--stuck', !entry.isIntersecting)).observe(sentinel);
}

/* ---------- Start ---------- */

syncInputs();
updateScriptCount();
changed(true);
