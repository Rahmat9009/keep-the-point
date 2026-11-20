import './style.css';
import { cardsFromOutline, estimateSeconds, newCard, parseOutline } from './outline';
import { sampleTalk } from './sample';
import { capybaraSvg } from './capybara';
import { openCueView, printSheetHtml, type CueView } from './cueView';
import { openRehearsal } from './rehearsalView';
import { MAX_CARDS } from './select';
import { clearState, loadState, saveState, type SavedState } from './storage';
import { cardTimeLabel, summarize } from './summary';
import { addPoint, emptyTalk, moveCard, removePoint } from './talk';
import { parseTime } from './time';
import type { Card } from './types';

const DEFAULT_LIMIT = '2:00';
const MAX_SECONDS = 3600;

let state: SavedState = loadState() ?? { talk: structuredClone(sampleTalk), limit: DEFAULT_LIMIT };

/* ---------- Static layout ---------- */

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <header class="top">
    <p class="eyebrow">Keep the Point</p>
    <p class="tagline">Cut your talk to time — keep every point that matters.</p>
    <label class="visually-hidden" for="title">Talk title</label>
    <textarea id="title" class="title" rows="1" autocomplete="off" spellcheck="true"></textarea>
  </header>

  <div class="layout">
    <aside class="side" aria-label="Results">
      <div class="status">
        <label class="limit">
          Time limit
          <input id="limit" type="text" inputmode="numeric" placeholder="mm:ss" aria-describedby="limit-error" />
        </label>
        <p id="limit-error" class="error" role="alert"></p>
        <p id="summary" class="summary" aria-live="polite"></p>
        <div class="rehearse">
          <button id="rehearse-full" type="button">▶ Rehearse full talk</button>
          <button id="rehearse-short" type="button" aria-describedby="rehearse-note">▶ Rehearse shortened talk</button>
          <button id="open-cues" type="button" aria-describedby="rehearse-note">Open cue cards</button>
        </div>
        <p id="rehearse-note" class="hint rehearse-note"></p>
      </div>
      <div class="details">
        <p id="too-many" class="notice" hidden></p>
        <div id="result-body">
          <h2>What fits</h2>
          <ol id="result-cards" class="cards"></ol>
          <h2>Required points</h2>
          <ul id="coverage" class="points"></ul>
        </div>
      </div>
    </aside>

    <div class="editor">
      <section aria-labelledby="outline-h">
        <h2 id="outline-h">Start from an outline</h2>
        <label for="outline" class="hint">Paste your outline, one card per line.</label>
        <textarea id="outline" rows="5" placeholder="Hook: why does bread rise?&#10;My research question&#10;How I tested it"></textarea>
        <p id="outline-error" class="error" role="alert"></p>
        <div class="buttons">
          <button id="make-cards" class="primary" type="button">Make cards</button>
          <button id="load-sample" type="button">Load sample talk</button>
          <button id="clear" class="danger" type="button">Clear</button>
        </div>
      </section>

      <section aria-labelledby="points-h">
        <h2 id="points-h">Required points</h2>
        <p class="hint">Things your talk must cover. Tag the cards that cover each one.</p>
        <ul id="point-list" class="chips"></ul>
        <form id="point-form" class="inline-form">
          <label class="visually-hidden" for="point-name">New required point</label>
          <input id="point-name" type="text" placeholder="e.g. Evidence" autocomplete="off" aria-describedby="point-error" />
          <button type="submit">Add point</button>
        </form>
        <p id="point-error" class="error" role="alert"></p>
      </section>

      <section aria-labelledby="cards-h">
        <h2 id="cards-h">Cards <span id="card-count" class="count"></span></h2>
        <ol id="rows" class="rows"></ol>
        <p id="no-cards" class="hint" hidden>No cards yet. Paste an outline above or add a card.</p>
        <button id="add-card" type="button">+ Add card</button>
      </section>
    </div>
  </div>

  <footer class="app-footer">${capybaraSvg('capy capy--tiny')}<span>Keep the Point · timed by a very patient capybara</span></footer>
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
const summaryEl = $('#summary');
const tooManyEl = $('#too-many');
const resultBody = $('#result-body');
const resultCards = $('#result-cards');
const coverageEl = $('#coverage');
const outlineInput = $<HTMLTextAreaElement>('#outline');
const outlineError = $('#outline-error');
const pointList = $('#point-list');
const pointForm = $<HTMLFormElement>('#point-form');
const pointName = $<HTMLInputElement>('#point-name');
const pointError = $('#point-error');
const rowsEl = $('#rows');
const noCards = $('#no-cards');
const cardCount = $('#card-count');
const rehearseFull = $<HTMLButtonElement>('#rehearse-full');
const rehearseShort = $<HTMLButtonElement>('#rehearse-short');
const rehearseNote = $('#rehearse-note');
const openCuesBtn = $<HTMLButtonElement>('#open-cues');

/** Cards the selection keeps right now (null when there's no shortened talk to rehearse). */
let shortenedCards: Card[] | null = null;

/* ---------- State changes ---------- */

/** Call after any change. `structural` re-renders the editor (don't use it while the student is typing). */
function changed(structural: boolean) {
  if (structural) renderEditor();
  renderResults();
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
  state.talk.cards = cardsFromOutline(outlineInput.value);
  changed(true);
});

$('#load-sample').addEventListener('click', () => {
  if (state.talk.cards.length > 0 && !confirm('Replace your talk with the sample science-fair talk?')) return;
  state.talk = structuredClone(sampleTalk);
  syncInputs();
  changed(true);
});

$('#clear').addEventListener('click', () => {
  if (!confirm('Clear everything and start fresh? Your cards and required points will be deleted.')) return;
  clearState();
  state = { talk: emptyTalk(), limit: DEFAULT_LIMIT };
  outlineInput.value = '';
  outlineError.textContent = '';
  pointError.textContent = '';
  syncInputs();
  changed(true);
  outlineInput.focus();
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

/* ---------- Card rows ---------- */

$('#add-card').addEventListener('click', () => {
  const card = newCard('');
  state.talk.cards.push(card);
  changed(true);
  rowsEl.querySelector<HTMLInputElement>(`[data-id="${card.id}"] [data-field="text"]`)?.focus();
});

rowsEl.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  const row = el.closest<HTMLElement>('[data-id]');
  const card = row && cardById(row.dataset.id!);
  if (!row || !card) return;

  if (el.dataset.field === 'text') {
    card.text = el.value;
    if (card.estimated) {
      card.seconds = estimateSeconds(card.text);
      row.querySelector<HTMLInputElement>('[data-field="seconds"]')!.value = String(card.seconds);
    }
    changed(false);
  } else if (el.dataset.field === 'seconds') {
    const n = Number(el.value);
    const valid = el.value.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_SECONDS;
    el.toggleAttribute('aria-invalid', !valid);
    if (!valid) return; // keep the last good value until they fix it
    card.seconds = n;
    card.estimated = false;
    row.classList.remove('row--est');
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
    case 'tag': {
      const point = el.value;
      const checked = (el as HTMLInputElement).checked;
      card.tags = checked ? [...new Set([...card.tags, point])] : card.tags.filter((t) => t !== point);
      break;
    }
    case 'locked':
      card.locked = (el as HTMLInputElement).checked;
      row.classList.toggle('row--locked', card.locked);
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
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  const row = btn?.closest<HTMLElement>('[data-id]');
  if (!btn || !row) return;
  const id = row.dataset.id!;
  const index = state.talk.cards.findIndex((c) => c.id === id);
  const action = btn.dataset.action!;

  if (action === 'up' || action === 'down') {
    state.talk.cards = moveCard(state.talk.cards, index, action === 'up' ? -1 : 1);
    changed(true);
    // Keep focus on the moved card's button (or its other arrow if this one is now disabled).
    const moved = rowsEl.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    const same = moved.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
    (same.disabled ? moved.querySelector<HTMLButtonElement>(`[data-action="${action === 'up' ? 'down' : 'up'}"]`)! : same).focus();
  } else if (action === 'delete') {
    state.talk.cards.splice(index, 1);
    changed(true);
    const next = state.talk.cards[Math.min(index, state.talk.cards.length - 1)];
    (next
      ? rowsEl.querySelector<HTMLElement>(`[data-id="${next.id}"] [data-field="text"]`)
      : $('#add-card'))?.focus();
  }
});

/* ---------- Rehearsal ---------- */

function startRehearsal(label: string, cards: Card[], trigger: HTMLButtonElement) {
  const limit = parseTime(state.limit);
  if (limit === null || cards.length === 0) return;
  openRehearsal({
    label,
    cards: structuredClone(cards),
    talk: structuredClone(state.talk),
    limitSeconds: limit,
    onSave(measured) {
      for (const card of state.talk.cards) {
        const seconds = measured.get(card.id);
        if (seconds === undefined) continue;
        card.seconds = seconds;
        card.estimated = false;
      }
      changed(true);
    },
    onClose: () => trigger.focus(),
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
    onClose() {
      cueView = null;
      openCuesBtn.focus();
    },
  });
});

rehearseFull.addEventListener('click', () => startRehearsal('Full talk', state.talk.cards, rehearseFull));
rehearseShort.addEventListener('click', () => {
  if (shortenedCards) startRehearsal('Shortened talk', shortenedCards, rehearseShort);
});

function updateRehearseButtons(fits: boolean, limitValid: boolean) {
  const cards = state.talk.cards;
  rehearseFull.disabled = cards.length === 0 || !limitValid;
  rehearseShort.disabled = !fits || !shortenedCards?.length;
  openCuesBtn.disabled = rehearseShort.disabled;
  rehearseNote.textContent =
    cards.length === 0 || !limitValid || fits
      ? ''
      : cards.length > MAX_CARDS
        ? 'The shortened talk needs 12 cards or fewer.'
        : 'Shortened rehearsal and cue cards are available once the talk can fit the time limit.';
}

/* ---------- Rendering ---------- */

function syncInputs() {
  titleInput.value = state.talk.title;
  limitInput.value = state.limit;
  fitTitle();
}

function renderEditor() {
  const { cards, requiredPoints } = state.talk;

  pointList.innerHTML = requiredPoints.length
    ? requiredPoints
        .map(
          (p) => `<li class="chip">${esc(p)}<button type="button" data-point="${esc(p)}" aria-label="Remove required point ${esc(p)}">×</button></li>`,
        )
        .join('')
    : '<li class="hint">None yet.</li>';

  cardCount.textContent = !cards.length
    ? ''
    : cards.length > MAX_CARDS
      ? `(${cards.length}, max ${MAX_CARDS})`
      : `(${cards.length} of ${MAX_CARDS})`;
  cardCount.classList.toggle('count--over', cards.length > MAX_CARDS);
  noCards.hidden = cards.length > 0;

  rowsEl.innerHTML = cards
    .map((card, i) => {
      const n = i + 1;
      const tagBoxes = requiredPoints.length
        ? requiredPoints
            .map(
              (p) => `<label class="tag"><input type="checkbox" data-field="tag" value="${esc(p)}" ${card.tags.includes(p) ? 'checked' : ''} /> ${esc(p)}</label>`,
            )
            .join('')
        : '<span class="hint">Add required points to tag cards.</span>';
      const priorityOptions = ['', '1', '2', '3', '4', '5']
        .map((v) => `<option value="${v}" ${String(card.priority ?? '') === v ? 'selected' : ''}>${v || '—'}</option>`)
        .join('');
      return `
        <li class="row ${card.estimated ? 'row--est' : ''} ${card.locked ? 'row--locked' : ''}" data-id="${esc(card.id)}">
          <div class="row__top">
            <span class="row__num" aria-hidden="true">${n}</span>
            <input class="row__text" type="text" data-field="text" value="${esc(card.text)}" placeholder="What you'll say" aria-label="Card ${n} text" />
            <span class="row__secs">
              <span class="tilde" title="Estimated from word count">~</span><input type="number" min="1" max="${MAX_SECONDS}" step="1" data-field="seconds" value="${card.seconds}" aria-label="Card ${n} length in seconds" /><span aria-hidden="true">s</span>
            </span>
          </div>
          <div class="row__tags" role="group" aria-label="Card ${n} covers">${tagBoxes}</div>
          <div class="row__controls">
            <label class="lock"><input type="checkbox" data-field="locked" ${card.locked ? 'checked' : ''} /> Always keep</label>
            <label class="prio">Priority <select data-field="priority" aria-label="Card ${n} priority">${priorityOptions}</select></label>
            <span class="row__actions">
              <button type="button" data-action="up" aria-label="Move card ${n} up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" data-action="down" aria-label="Move card ${n} down" ${i === cards.length - 1 ? 'disabled' : ''}>↓</button>
              <button type="button" data-action="delete" class="danger" aria-label="Delete card ${n}">Delete</button>
            </span>
          </div>
        </li>`;
    })
    .join('');
}

function renderResults() {
  const { cards, requiredPoints } = state.talk;
  const budget = parseTime(state.limit);
  printSheet.innerHTML = printSheetHtml(state.talk, budget);
  cueView?.refresh();
  limitError.textContent = budget === null ? 'Enter a time like 2:00' : '';
  limitInput.toggleAttribute('aria-invalid', budget === null);
  if (budget === null) {
    updateRehearseButtons(false, false);
    return; // keep showing the last valid result
  }

  const summary = summarize(cards, requiredPoints, budget);
  const result = summary.result;
  summaryEl.className = `summary ${summary.tone === 'bad' ? 'summary--bad' : summary.tone === 'quiet' ? 'summary--quiet' : ''}`;
  summaryEl.textContent = summary.text;
  shortenedCards = result?.fits ? result.kept : null;
  updateRehearseButtons(!!result?.fits, true);

  tooManyEl.hidden = cards.length <= MAX_CARDS;
  if (cards.length > MAX_CARDS) {
    tooManyEl.textContent = `Keep the Point can sort out up to ${MAX_CARDS} cards. Merge or delete ${plural(cards.length - MAX_CARDS, 'card')} and your result will appear here.`;
  }
  resultBody.hidden = result === null;
  if (result === null) return;

  const keptCards = summary.keptCards;
  const reasons = new Map(result.fits ? result.cut.map((c) => [c.card.id, c.reason]) : []);

  const keptIds = new Set(keptCards.map((c) => c.id));
  resultCards.innerHTML = cards
    .map((card) => {
      const kept = keptIds.has(card.id);
      const reason = kept ? '' : (reasons.get(card.id) ?? (result.fits ? '' : 'Not in the shortest valid talk'));
      const meta = [card.locked ? 'Always keep' : null, card.tags.join(', ') || null, card.priority !== undefined ? `Priority ${card.priority}` : null]
        .filter(Boolean)
        .join(' · ');
      return `
        <li class="card ${kept ? '' : 'card--cut'}">
          <div class="card__main">
            <span class="card__text">${esc(card.text) || '<em>(empty card)</em>'}</span>
            <span class="card__time">${cardTimeLabel(card)}</span>
          </div>
          ${meta ? `<div class="card__meta">${esc(meta)}</div>` : ''}
          ${reason ? `<div class="card__reason">${esc(reason)}</div>` : ''}
        </li>`;
    })
    .join('');

  coverageEl.innerHTML = requiredPoints.length
    ? requiredPoints
        .map((point) => {
          const by = keptCards.filter((c) => c.tags.includes(point)).map((c) => c.text || '(empty card)');
          return `<li class="${by.length ? '' : 'missing'}"><span class="point">${esc(point)}</span><span class="by">${by.length ? esc(by.join(', ')) : 'Not covered'}</span></li>`;
        })
        .join('')
    : '<li class="hint">No required points yet.</li>';
}

/* ---------- Helpers ---------- */

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/* ---------- Start ---------- */

syncInputs();
changed(true);
