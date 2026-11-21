/* Study B · Highlighter notebook. Static mock driven by the real sample data (KTP). */
(function () {
  const { fmt, esc, step, cardState, spoken, initialLimit, view, reason, cueItems } = window.KTPU;
  const D = window.KTP;
  const app = document.getElementById('app');
  let limit = initialLimit();
  const EDITING = '4'; // the Method card is open for editing, mid-AI request

  const header = () => `
    <header class="top">${D.capybara}<h1>Keep the Point</h1></header>
    <p class="talk-title">${esc(D.title)}</p>
    <ol class="how" aria-label="How it works">
      <li><b aria-hidden="true">1</b>Paste your talk</li>
      <li><b aria-hidden="true">2</b>Set your time</li>
      <li><b aria-hidden="true">3</b>Get cue cards that fit</li>
    </ol>`;

  function mainScreen() {
    app.innerHTML = `
      <div class="page">
        ${header()}
        <section class="hero" aria-label="Time limit">
          <p class="big num" id="big" aria-live="polite"></p>
          <ul class="chips" id="chips"></ul>
          <p class="nofit-note" id="nofit" hidden></p>
          <div class="limit"><label for="limit-box">Fit it into</label><input id="limit-box" class="num" type="text" inputmode="numeric" value="${fmt(limit)}" /></div>
          <div class="slider-wrap">
            <input class="range" id="range" type="range" min="30" max="160" step="5" value="${limit}" aria-label="Time limit" />
            <div class="scale num" aria-hidden="true"><span>0:30</span><span>1:00</span><span>1:30</span><span>2:00</span><span>2:40</span></div>
          </div>
          <span class="hint">Try it: drag to cut the talk</span>
        </section>
        <div class="wide">
          <div class="card card--plain">
            <div></div>
            <div><h2 id="talk-h">Your talk</h2><p class="sub">Tap a card to edit it. Pink means cut, yellow means said in the short version.</p></div>
            <aside class="note"><b>Required points</b><ul class="points" id="points"></ul>
              <div class="side-actions"><button class="btn btn--go" type="button" id="open-cues">Open cue cards</button><button class="linkbtn" type="button">Rehearse the talk</button></div></aside>
          </div>
          <ol class="talk" id="talk" aria-labelledby="talk-h"></ol>
          <div class="card card--plain"><div></div><div class="end"><button class="btn" type="button">+ Add card</button><button class="btn" type="button">Paste an outline</button></div></div>
          <div class="card card--plain"><div></div><p class="foot">${D.capybara}<span>Timed by a very patient capybara.</span></p></div>
        </div>
      </div>`;
    const range = document.getElementById('range');
    const box = document.getElementById('limit-box');
    range.addEventListener('input', () => { limit = Number(range.value); box.value = fmt(limit); update(); });
    box.addEventListener('input', () => {
      const m = /^(\d+):(\d{2})$/.exec(box.value.trim());
      if (!m) return;
      limit = Number(m[1]) * 60 + Number(m[2]);
      range.value = String(limit);
      update();
    });
    document.getElementById('open-cues').addEventListener('click', () => { location.search = '?view=cues'; });
    update();
  }

  function update() {
    const st = step(limit);
    const range = document.getElementById('range');
    range.style.setProperty('--fill', `${((Math.min(160, Math.max(30, limit)) - 30) / 130) * 100}%`);
    range.setAttribute('aria-valuetext', `${fmt(limit)}: ${st.fits ? `talk runs ${fmt(st.total)}` : "can't fit"}`);
    const big = document.getElementById('big');
    const nofit = document.getElementById('nofit');
    if (st.fits) {
      big.className = 'big num';
      big.innerHTML = `<span class="was">${fmt(D.fullSeconds)}</span><span class="to">→</span><span class="now">${fmt(st.total)}</span>`;
      big.setAttribute('aria-label', `${fmt(D.fullSeconds)} cut to ${fmt(st.total)}`);
      nofit.hidden = true;
    } else {
      big.className = 'big big--bad num';
      big.textContent = `${fmt(limit)} is too tight`;
      big.removeAttribute('aria-label');
      nofit.hidden = false;
      nofit.textContent = `Every required point needs at least ${fmt(st.total)} (${st.over}s more). Raise the limit or untag a point.`;
    }
    const chipCls = (c) => (c.includes('shortened') ? 'c-short' : c.includes('cut') ? 'c-cut' : '');
    document.getElementById('chips').innerHTML = st.fits ? st.chips.map((c) => `<li class="${chipCls(c)}">${esc(c)}</li>`).join('') : '';

    document.getElementById('points').innerHTML = D.requiredPoints.map((p) => {
      const by = D.cards.filter((c) => c.tags.includes(p) && cardState(c, st) !== 'cut').map((c) => c.title);
      return `<li class="${by.length ? '' : 'miss'}">${esc(p)}: ${esc(by.join(', ') || 'not covered')}</li>`;
    }).join('');

    document.getElementById('talk').innerHTML = D.cards.map((c) => {
      const s = cardState(c, st);
      const sp = spoken(c, s);
      let note;
      if (s === 'cut') note = `<b class="pink">Cut</b>${esc(reason(c, st))}<br /><button class="linkbtn" type="button">Keep this card</button>`;
      else if (s === 'short') note = `<b>Short version</b>Said in ${sp.seconds}s instead of ${c.seconds}s.${c.tags.length ? ` Covers ${esc(c.tags.join(', '))}.` : ''}`;
      else note = c.tags.length ? `<b>Covers ${esc(c.tags.join(', '))}</b>` : `<b>Priority ${c.priority}</b>Optional`;
      const body = c.id === EDITING ? editHtml(c) : `
        <h3 class="card__title">${esc(c.title)}</h3>
        <p class="card__text">${esc(c.text)}</p>
        ${s === 'short' ? `<p class="short"><span>${esc(c.short.text)}</span></p>` : ''}`;
      return `<li class="card card--${s}" ${c.id === EDITING ? 'id="thinking"' : ''}>
        <div class="card__gutter"><span class="card__n num">${c.id}</span><span class="card__secs num">${sp.seconds}s</span></div>
        <div>${body}</div>
        <aside class="note">${note}</aside>
      </li>`;
    }).join('');
  }

  function editHtml(c) {
    const tags = D.requiredPoints.map((p) => `<label><input type="checkbox" ${c.tags.includes(p) ? 'checked' : ''} /> ${esc(p)}</label>`).join('');
    return `<div class="edit">
      <div class="two"><label class="f">Title<input type="text" value="${esc(c.title)}" /></label><label class="f">Seconds<input class="num" type="number" value="${c.seconds}" /></label></div>
      <label class="f" style="margin-top:10px">What you'll say<textarea rows="4">${esc(c.text)}</textarea></label>
      <div class="row">${tags}</div>
      <div class="row"><label><input type="checkbox" /> Always keep</label><label>Priority <select><option>—</option></select></label></div>
      <div class="row"><button class="ai" type="button" aria-busy="true" disabled><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Thinking…</button><button class="btn" type="button">Done</button></div>
    </div>`;
  }

  function cueScreen() {
    const st = step(105);
    const items = cueItems(st);
    const body = items.map((it) => {
      if (it.kind === 'cut') {
        const secs = it.cards.reduce((t, c) => t + c.seconds, 0);
        return `<li class="tape">✂ Cut here: ${it.cards.map((c) => esc(c.title)).join(', ')} <span class="num">(${secs}s)</span></li>`;
      }
      const sp = spoken(it.card, it.state);
      return `<li class="ic">
        ${it.state === 'short' ? `<span class="ic__tab num">Shortened ${it.card.seconds}s → ${sp.seconds}s</span>` : ''}
        <div class="ic__head"><span class="ic__n num" aria-label="Card ${it.n}">${it.n}</span><h3 class="ic__title">${esc(it.card.title)}</h3><span class="ic__secs num">${sp.seconds}s</span></div>
        ${it.bridge ? `<p class="ic__bridge">${esc(it.bridge)} <span class="num">(~${D.bridge.seconds}s)</span></p>` : ''}
        <p class="ic__text">${esc(sp.text)}</p>
        ${it.card.tags.length ? `<div class="ic__tags">Covers ${esc(it.card.tags.join(', '))}</div>` : ''}
      </li>`;
    }).join('');
    app.innerHTML = `
      <div class="page">
        ${header()}
        <div class="cue-head"><h2>Cue cards</h2><div class="end" style="margin:0"><button class="btn btn--go" type="button">Print cue cards</button><button class="btn" type="button" id="back">Back</button></div></div>
        <ol class="deck">${body}
          <li class="sticky num"><b>Total ${fmt(st.total)}</b>${st.chips[0]} · limit ${fmt(105)}<br />The bridge line adds ~${D.bridge.seconds}s.</li>
        </ol>
      </div>`;
    document.getElementById('back').addEventListener('click', () => { location.search = ''; });
  }

  (view() === 'cues' ? cueScreen : mainScreen)();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: 'center' });
})();
