import { capybaraSvg } from './capybara';
import { buildCueItems, cutLabel } from './cues';
import { cardTimeLabel, summarize, timeLabel } from './summary';
import { formatTime } from './time';
import type { Talk } from './types';

/**
 * HTML for the cue-card sheet. `interactive` adds the "Keep this card" controls
 * on cut markers (on screen); the print sheet uses the plain version.
 */
export function cueSheetHtml(talk: Talk, budgetSeconds: number, interactive: boolean): string {
  const summary = summarize(talk.cards, talk.requiredPoints, budgetSeconds);
  if (!summary.result?.fits) {
    return `<p class="cue-empty">${esc(summary.text)}</p>`;
  }
  const result = summary.result;
  const items = buildCueItems(talk.cards, result.kept.map((c) => c.id));

  const body = items
    .map((item, i) => {
      if (item.kind === 'card') {
        const { card, number } = item;
        const tags = card.tags.length
          ? `<ul class="cue-tags" aria-label="Covers">${card.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
          : '';
        return `
          <article class="cue-card">
            <div class="cue-card__head">
              <span class="cue-num" aria-label="Card ${number}">${number}</span>
              ${card.locked ? '<span class="cue-lock">Always keep</span>' : ''}
              <span class="cue-secs">${cardTimeLabel(card)}</span>
            </div>
            <p class="cue-text">${esc(card.text) || '<em>(empty card)</em>'}</p>
            ${tags}
          </article>`;
      }
      const label = `✂ Cut here: ${esc(cutLabel(item))}`;
      if (!interactive) return `<div class="cue-cut"><span>${label}</span></div>`;
      const menuId = `cut-menu-${i}`;
      const keepButtons = item.cards
        .map((c) => `<button type="button" data-keep="${esc(c.id)}">Keep this card${item.cards.length > 1 ? `: ${esc(c.text) || '(empty card)'}` : ''} <span class="cue-adds">+${cardTimeLabel(c)}</span></button>`)
        .join('');
      return `
        <div class="cue-cut">
          <button type="button" class="cue-cut__toggle" aria-expanded="false" aria-controls="${menuId}">${label}</button>
          <div class="cue-cut__menu" id="${menuId}" hidden>${keepButtons}</div>
        </div>`;
    })
    .join('');

  const anyEst = result.kept.some((c) => c.estimated);
  return `
    <div class="cue-list">${body}</div>
    <p class="cue-total">
      <strong>Total ${timeLabel(result.totalSeconds, anyEst)}</strong>
      · ${result.spareSeconds}s spare · limit ${formatTime(budgetSeconds)}
    </p>`;
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
      lastKept = { id, text: card?.text || '(empty card)' };
      opts.keepCard(id); // the app calls refresh() after re-running the selection
      showKeptNotice();
      return;
    }
    if (target.closest('[data-ref="undo"]') && lastKept) {
      opts.unlockCard(lastKept.id);
      notice.hidden = true;
      lastKept = null;
      ref<HTMLButtonElement>('close').focus();
    }
  });

  refresh();
  ref<HTMLButtonElement>('close').focus();

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
        : cueSheetHtml(talk, limitSeconds, true);
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
