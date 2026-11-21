import { AI_NOTICE, THINKING_HTML, type AiResult, type BridgeRequest } from './ai';
import { capybaraSvg } from './capybara';
import { buildCueItems, cutLabel, gapKey, type CutMarker } from './cues';
import { cardTitle, estimateSeconds } from './outline';
import { shortenedLabel, spokenCard } from './select';
import { cardTimeLabel, summarize, timeLabel } from './summary';
import { formatTime } from './time';
import type { Card, Talk } from './types';
import { changesSpeaker } from './group';

/** On-screen state of the bridge tools (not saved). */
export interface BridgeUi {
  /** Gaps waiting for an AI answer. */
  loading: Set<string>;
  /** Gaps whose bridge editor is open even though the line is still empty. */
  editing: Set<string>;
  /** Last error per gap. */
  errors: Map<string, string>;
}

const bridgeSeconds = (text: string) => estimateSeconds(text);

/**
 * HTML for the cue-card sheet. `interactive` adds the "Keep this card" and bridge
 * controls on cut markers (on screen); the print sheet uses the plain version.
 */
export function cueSheetHtml(talk: Talk, budgetSeconds: number, interactive: boolean, ui?: BridgeUi): string {
  const summary = summarize(talk.cards, talk.requiredPoints, budgetSeconds);
  if (!summary.result?.fits) {
    return `<p class="cue-empty">${esc(summary.text)}</p>`;
  }
  const result = summary.result;
  const items = buildCueItems(talk.cards, result.kept.map((c) => c.id));
  const bridges = talk.bridges ?? {};
  let bridgeTotal = 0;
  let previous: Card | undefined;
  /** Bridge line waiting to be shown at the top of the next card. */
  let pendingBridge: { key: string; text: string } | null = null;

  const body = items
    .map((item, i) => {
      if (item.kind === 'card') {
        const { card: original, number } = item;
        const card = spokenCard(original, result.shortIds);
        const isShort = card !== original;
        const tags = card.tags.length
          ? `<ul class="cue-tags" aria-label="Covers">${card.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
          : '';
        const handoff = talk.groupMode && previous && changesSpeaker(previous, card);
        previous = card;
        const speaker = talk.groupMode && card.speaker
          ? `<p class="cue-speaker">${handoff ? 'Hand off to ' : 'Speaker: '}${esc(card.speaker)}</p>`
          : '';
        const bridge = pendingBridge;
        pendingBridge = null;
        const bridgeHtml = bridge
          ? `<p class="cue-bridge" data-bridge-show="${esc(bridge.key)}" ${bridge.text.trim() ? '' : 'hidden'}><em data-ref="bridge-text">${esc(bridge.text)}</em> <span class="cue-bridge__secs" data-ref="bridge-secs">~${bridgeSeconds(bridge.text)}s</span></p>`
          : '';
        return `
          <article class="cue-card ${isShort ? 'cue-card--short' : ''}">
            ${bridgeHtml}
            <div class="cue-card__head">
              <span class="cue-num" aria-label="Card ${number}">${number}</span>
              ${card.locked ? '<span class="cue-lock">Always keep</span>' : ''}
              ${isShort ? `<span class="cue-short">${esc(shortenedLabel(original))}</span>` : ''}
              <span class="cue-secs">${cardTimeLabel(card)}</span>
            </div>
            ${speaker}
            <h3 class="cue-title">${esc(cardTitle(original)) || '<em>(empty card)</em>'}</h3>
            ${card.text.trim() && card.text.trim() !== cardTitle(original) ? `<p class="cue-text">${esc(card.text)}</p>` : ''}
            ${tags}
          </article>`;
      }

      // A bridge leads into the next kept card, so it needs one.
      const key = gapKey(item);
      const bridgeText = item.before ? (bridges[key] ?? '') : '';
      if (item.before && (bridgeText.trim() || interactive)) {
        pendingBridge = { key, text: bridgeText };
        if (bridgeText.trim()) bridgeTotal += bridgeSeconds(bridgeText);
      }

      const label = `✂ Cut here: ${esc(cutLabel(item))}`;
      if (!interactive) return `<div class="cue-cut"><span>${label}</span></div>`;
      const menuId = `cut-menu-${i}`;
      const keepButtons = item.cards
        .map((c) => `<button type="button" data-keep="${esc(c.id)}">Keep this card${item.cards.length > 1 ? `: ${esc(cardTitle(c) || '(empty card)')}` : ''} <span class="cue-adds">+${cardTimeLabel(c)}</span></button>`)
        .join('');
      return `
        <div class="cue-cut">
          <button type="button" class="cue-cut__toggle" aria-expanded="false" aria-controls="${menuId}">${label}</button>
          <div class="cue-cut__menu" id="${menuId}" hidden>${keepButtons}</div>
          ${item.before ? bridgeToolsHtml(key, bridgeText, ui) : ''}
        </div>`;
    })
    .join('');

  const anyEst = result.kept.some((c) => spokenCard(c, result.shortIds).estimated);
  return `
    <div class="cue-list">${body}</div>
    <p class="cue-total">
      <strong>Total ${timeLabel(result.totalSeconds, anyEst)}</strong>
      · ${result.spareSeconds}s spare · limit ${formatTime(budgetSeconds)}
      <span class="cue-total__bridges" data-ref="bridge-total">${bridgeTotal ? `· bridge lines add ~${bridgeTotal}s` : ''}</span>
    </p>`;
}

function bridgeToolsHtml(key: string, text: string, ui?: BridgeUi): string {
  const k = esc(key);
  const loading = ui?.loading.has(key) ?? false;
  const error = ui?.errors.get(key);
  const open = !!text.trim() || (ui?.editing.has(key) ?? false);
  const aiButton = `<button type="button" data-bridge-ai="${k}" ${loading ? 'disabled aria-busy="true"' : ''}>${loading ? THINKING_HTML : open ? '✨ Suggest again' : '✨ Suggest bridge'}</button>`;
  return `
    <div class="cue-bridge-tools" data-gap="${k}">
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
      ${
        open
          ? `<label class="cue-bridge-tools__label">Bridge line <span class="hint">(max 15 words, shown in italics on the next card)</span>
               <input type="text" data-bridge-input="${k}" value="${esc(text)}" maxlength="200" placeholder="One sentence that links the cards" />
             </label>
             <div class="cue-bridge-tools__buttons">${aiButton}<button type="button" data-bridge-remove="${k}">Remove</button></div>`
          : `<div class="cue-bridge-tools__buttons">${aiButton}<button type="button" data-bridge-own="${k}">Write my own</button></div>`
      }
      <p class="hint cue-ai-notice">${esc(AI_NOTICE)}</p>
    </div>`;
}

/** The hidden sheet that only appears when printing. */
export function printSheetHtml(talk: Talk, budgetSeconds: number | null): string {
  const title = talk.title.trim() || 'My talk';
  const sheet =
    budgetSeconds === null
      ? '<p class="cue-empty">Enter a valid time limit to print cue cards.</p>'
      : cueSheetHtml(talk, budgetSeconds, false);
  return `
    <header class="ps-head">
      <h1>${esc(title)}</h1>
      <p>Cue cards${budgetSeconds === null ? '' : ` · ${formatTime(budgetSeconds)} limit`}</p>
    </header>
    ${sheet}
    <footer class="ps-foot">${capybaraSvg('capy capy--print')}<span>Keep the Point: cut your talk to time, keep every point that matters.</span></footer>`;
}

export interface CueViewOptions {
  /** Current talk and time limit (null if the limit is invalid). */
  getState(): { talk: Talk; limitSeconds: number | null };
  /** Lock a card so it's always kept, then re-run the selection. */
  keepCard(id: string): void;
  /** Undo a keep. */
  unlockCard(id: string): void;
  /** Save (or, with empty text, remove) the bridge line for a gap. Does not re-render the cue view. */
  setBridge(key: string, text: string): void;
  requestBridge(req: BridgeRequest): Promise<AiResult>;
  onClose(): void;
}

export interface CueView {
  /** Re-render after the talk changed. */
  refresh(): void;
  close(): void;
}

/** Open the full-screen cue-card view. */
export function openCueView(opts: CueViewOptions): CueView {
  const app = document.querySelector<HTMLElement>('#app');
  const root = document.createElement('div');
  root.className = 'cue';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'cue-title');
  root.innerHTML = `
    <div class="cue__bar">
      <div class="cue__heading">
        <h2 id="cue-title">Cue cards</h2>
        <p class="cue__sub" data-ref="sub"></p>
      </div>
      <div class="cue__buttons">
        <button type="button" class="primary" data-ref="print">Print cue cards</button>
        <button type="button" data-ref="close" aria-keyshortcuts="Escape">Close</button>
      </div>
    </div>
    <div class="cue__body">
      <p class="cue__notice" data-ref="notice" tabindex="-1" role="status" hidden></p>
      <div data-ref="sheet"></div>
      <footer class="cue__foot">${capybaraSvg('capy capy--tiny')}</footer>
    </div>
  `;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const sheet = ref('sheet');
  const notice = ref('notice');
  let lastKept: { id: string; text: string } | null = null;
  const bridgeUi: BridgeUi = { loading: new Set(), editing: new Set(), errors: new Map() };
  let closed = false;

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  if (app) app.inert = true;
  document.body.append(root);

  ref('print').addEventListener('click', () => window.print());
  ref('close').addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown);

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const toggle = target.closest<HTMLButtonElement>('.cue-cut__toggle');
    if (toggle) {
      const menu = root.querySelector<HTMLElement>(`#${toggle.getAttribute('aria-controls')}`)!;
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      menu.hidden = !open;
      if (open) menu.querySelector('button')?.focus();
      return;
    }
    const keep = target.closest<HTMLButtonElement>('[data-keep]');
    if (keep) {
      const id = keep.dataset.keep!;
      const card = opts.getState().talk.cards.find((c) => c.id === id);
      lastKept = { id, text: (card && cardTitle(card)) || '(empty card)' };
      opts.keepCard(id); // the app calls refresh() after re-running the selection
      showKeptNotice();
      return;
    }
    const ai = target.closest<HTMLButtonElement>('[data-bridge-ai]');
    if (ai) {
      void suggestBridge(ai.dataset.bridgeAi!);
      return;
    }
    const own = target.closest<HTMLButtonElement>('[data-bridge-own]');
    if (own) {
      const key = own.dataset.bridgeOwn!;
      bridgeUi.editing.add(key);
      refresh();
      focusBridgeInput(key);
      return;
    }
    const remove = target.closest<HTMLButtonElement>('[data-bridge-remove]');
    if (remove) {
      const key = remove.dataset.bridgeRemove!;
      bridgeUi.editing.delete(key);
      bridgeUi.errors.delete(key);
      opts.setBridge(key, '');
      refresh();
      root.querySelector<HTMLElement>(`[data-bridge-ai="${CSS.escape(key)}"]`)?.focus();
      return;
    }
    if (target.closest('[data-ref="undo"]') && lastKept) {
      opts.unlockCard(lastKept.id);
      notice.hidden = true;
      lastKept = null;
      ref<HTMLButtonElement>('close').focus();
    }
  });

  // Typing a bridge line saves it and updates the next card in place (no re-render, so focus stays).
  root.addEventListener('input', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-bridge-input]');
    if (!input) return;
    const key = input.dataset.bridgeInput!;
    opts.setBridge(key, input.value);
    const show = root.querySelector<HTMLElement>(`[data-bridge-show="${CSS.escape(key)}"]`);
    if (show) {
      show.hidden = !input.value.trim();
      show.querySelector('[data-ref="bridge-text"]')!.textContent = input.value;
      show.querySelector('[data-ref="bridge-secs"]')!.textContent = `~${estimateSeconds(input.value)}s`;
    }
    const total = [...root.querySelectorAll<HTMLInputElement>('[data-bridge-input]')]
      .filter((i) => i.value.trim())
      .reduce((t, i) => t + estimateSeconds(i.value), 0);
    const totalEl = root.querySelector<HTMLElement>('[data-ref="bridge-total"]');
    if (totalEl) totalEl.textContent = total ? `· bridge lines add ~${total}s` : '';
  });

  refresh();
  ref<HTMLButtonElement>('close').focus();

  function focusBridgeInput(key: string) {
    const input = root.querySelector<HTMLInputElement>(`[data-bridge-input="${CSS.escape(key)}"]`);
    input?.focus();
    input?.select();
  }

  function markerFor(key: string): CutMarker | null {
    const { talk, limitSeconds } = opts.getState();
    if (limitSeconds === null) return null;
    const result = summarize(talk.cards, talk.requiredPoints, limitSeconds).result;
    if (!result?.fits) return null;
    const items = buildCueItems(talk.cards, result.kept.map((c) => c.id));
    const marker = items.find((i): i is CutMarker => i.kind === 'cut' && gapKey(i) === key);
    if (!marker) return null;
    // Send what will actually be said: short versions where the selection uses them.
    const say = (c: CutMarker['after']) => (c ? spokenCard(c, result.shortIds) : null);
    return { ...marker, after: say(marker.after), before: say(marker.before) };
  }

  async function suggestBridge(key: string) {
    const marker = markerFor(key);
    if (!marker?.before) return;
    const { talk } = opts.getState();
    const cut = marker.cards.map((c) => c.text.trim()).filter(Boolean);
    bridgeUi.errors.delete(key);
    if (!marker.before.text.trim() || cut.length === 0) {
      bridgeUi.errors.set(key, 'The cards around this cut need some text first.');
      bridgeUi.editing.add(key);
      refresh();
      return;
    }
    bridgeUi.loading.add(key);
    refresh();
    const result = await opts.requestBridge({
      before: marker.after?.text.trim() || null,
      cut,
      after: marker.before.text,
      title: talk.title,
    });
    bridgeUi.loading.delete(key);
    if (closed) return;
    bridgeUi.editing.add(key);
    if (result.ok) opts.setBridge(key, result.text);
    else bridgeUi.errors.set(key, result.message);
    refresh();
    focusBridgeInput(key);
  }

  function showKeptNotice() {
    if (!lastKept) return;
    const { talk, limitSeconds } = opts.getState();
    const fits = limitSeconds !== null && summarize(talk.cards, talk.requiredPoints, limitSeconds).result?.fits;
    notice.innerHTML = `${fits ? 'Kept' : 'Locked'} “${esc(lastKept.text)}”.${fits ? '' : ' The talk no longer fits the time limit.'} <button type="button" data-ref="undo">Undo</button>`;
    notice.classList.toggle('cue__notice--bad', !fits);
    notice.hidden = false;
    notice.focus();
  }

  function refresh() {
    if (closed) return;
    const { talk, limitSeconds } = opts.getState();
    ref('sub').textContent = `${talk.title.trim() || 'My talk'}${limitSeconds === null ? '' : ` · ${formatTime(limitSeconds)} limit`}`;
    sheet.innerHTML =
      limitSeconds === null
        ? '<p class="cue-empty">Enter a valid time limit to see your cue cards.</p>'
        : cueSheetHtml(talk, limitSeconds, true, bridgeUi);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    const openToggle = root.querySelector<HTMLButtonElement>('.cue-cut__toggle[aria-expanded="true"]');
    e.preventDefault();
    if (openToggle && root.contains(document.activeElement) && openToggle.parentElement!.contains(document.activeElement)) {
      // First Esc closes an open "Keep this card" menu.
      openToggle.setAttribute('aria-expanded', 'false');
      root.querySelector<HTMLElement>(`#${openToggle.getAttribute('aria-controls')}`)!.hidden = true;
      openToggle.focus();
      return;
    }
    close();
  }

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    root.remove();
    if (app) app.inert = false;
    document.body.style.overflow = previousOverflow;
    opts.onClose();
  }

  return { refresh, close };
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
