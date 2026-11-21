/* Study A · Tape measure. Static mock driven by the real sample data (KTP) and its precomputed selections. */
(function () {
  const { fmt, esc, step, cardState, spoken, initialLimit, view, reason, cueItems } = window.KTPU;
  const D = window.KTP;
  const SCALE = 170; // the tape runs 0:00 → 2:50
  const pct = (s) => `${(s / SCALE) * 100}%`;
  const app = document.getElementById('app');
  let limit = initialLimit();

  const header = () => `
    <header class="top">
      <div class="brand">${D.capybara}<h1>Keep the Point</h1></div>
      <p class="talk-title">${esc(D.title)}</p>
    </header>
    <ol class="how" aria-label="How it works">
      <li><b aria-hidden="true">1</b>Paste your talk</li>
      <li><b aria-hidden="true">2</b>Set your time</li>
      <li><b aria-hidden="true">3</b>Get cue cards that fit</li>
    </ol>`;

  const ruler = () => {
    let html = '';
    for (let s = 0; s <= SCALE; s += 5) {
      const cls = s % 15 === 0 ? 'tick tick--major' : s % 5 === 0 && s % 10 === 0 ? 'tick tick--mid' : 'tick';
      html += `<i class="${cls}" style="left:${pct(s)}"></i>`;
      if (s % 15 === 0 && s > 0 && s < SCALE) html += `<span class="tick-label num ${s % 30 ? 'odd' : ''}" style="left:${pct(s)}">${fmt(s)}</span>`;
    }
    return html;
  };

  function mainScreen() {
    app.innerHTML = `
      <div class="page">
        ${header()}
        <section class="hero" aria-label="Time limit">
          <div class="readout">
            <p class="big num" id="big" aria-live="polite"></p>
            <ul class="chips" id="chips"></ul>
            <div class="limit"><label for="limit-box">Limit</label><input id="limit-box" class="num" type="text" inputmode="numeric" value="${fmt(limit)}" /></div>
          </div>
          <p class="nofit-note" id="nofit" hidden></p>
          <div class="tape">
            <div class="lane"><span class="lane__label">Full talk</span><div class="blocks" id="full" aria-hidden="true"></div></div>
            <div class="lane"><span class="lane__label" id="fit-label">Fits</span><div class="blocks" id="fit" aria-hidden="true"></div></div>
            <div class="ruler" aria-hidden="true">${ruler()}</div>
            <div class="track"><div class="limit-line" id="line"></div>
              <input class="range" id="range" type="range" min="30" max="160" step="5" value="${limit}" aria-label="Time limit" />
            </div>
          </div>
          <p class="hint"><strong>Try it:</strong> drag the red line to cut the talk.</p>
        </section>
        <div class="cols">
          <section aria-labelledby="fits-h"><h2 id="fits-h">What fits</h2><ol class="list" id="list"></ol></section>
          <aside class="side">
            <div class="panel"><h2>Required points</h2><ul class="cover" id="cover"></ul></div>
            <div class="panel btns">
              <button class="btn btn--go" type="button" id="open-cues">Open cue cards</button>
              <button class="btn" type="button">Rehearse</button>
            </div>
            <div class="capy-foot">${D.capybara}<span>Timed by a very patient capybara.</span></div>
          </aside>
        </div>
        <section class="editor" aria-labelledby="ed-h"><h2 id="ed-h">Your cards</h2><ol class="ed-grid" id="editor"></ol></section>
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
    const big = document.getElementById('big');
    const nofit = document.getElementById('nofit');
    if (st.fits) {
      big.className = 'big num';
      big.innerHTML = `${fmt(D.fullSeconds)}<span class="arrow">→</span>${fmt(st.total)}`;
      nofit.hidden = true;
    } else {
      big.className = 'big big--bad num';
      big.textContent = `Can't fit ${fmt(limit)}`;
      nofit.hidden = false;
      nofit.textContent = `The shortest talk that keeps every required point is ${fmt(st.total)}, ${st.over}s over. Raise the limit or untag a point.`;
    }
    const chipCls = (c) => (c.includes('shortened') ? 'c-short' : c.includes('cut') ? 'c-cut' : '');
    document.getElementById('chips').innerHTML = st.fits ? st.chips.map((c) => `<li class="${chipCls(c)}">${esc(c)}</li>`).join('') : '';
    document.getElementById('fit-label').textContent = st.fits ? `Fits ${fmt(limit)}` : 'Shortest';

    document.getElementById('full').innerHTML = D.cards.map((c) => {
      const s = cardState(c, st);
      return `<div class="blk ${s === 'cut' ? 'blk--cut' : ''}" style="width:calc(${pct(c.seconds)} - 2px)"><b>${c.id}</b><span>${esc(c.title)}</span></div>`;
    }).join('');
    document.getElementById('fit').innerHTML = D.cards.filter((c) => cardState(c, st) !== 'cut').map((c) => {
      const s = cardState(c, st);
      const sec = spoken(c, s).seconds;
      return `<div class="blk ${s === 'short' ? 'blk--short' : ''} ${st.fits ? '' : 'blk--over'}" style="width:calc(${pct(sec)} - 2px)"><b>${c.id}</b><span>${esc(c.title)}</span></div>`;
    }).join('');
    const line = document.getElementById('line');
    line.style.left = pct(limit);
    line.dataset.time = fmt(limit);
    document.getElementById('range').setAttribute('aria-valuetext', `${fmt(limit)}: ${st.fits ? `talk runs ${fmt(st.total)}` : "can't fit"}`);

    document.getElementById('list').innerHTML = D.cards.map((c) => {
      const s = cardState(c, st);
      const sec = spoken(c, s).seconds;
      const meta = s === 'cut'
        ? `<span class="tag tag--cut">Cut</span>${esc(reason(c, st))}`
        : s === 'short' ? `<span class="tag tag--short">Shortened ${c.seconds}s → ${sec}s</span>${esc(c.tags.join(', ') || `Priority ${c.priority}`)}`
        : esc(c.tags.join(', ') || `Priority ${c.priority}`);
      return `<li class="item item--${s}">
        <span class="item__n num">${c.id}</span><span class="item__t">${esc(c.title)}</span><span class="item__time num">${sec}s</span>
        <span class="item__meta">${meta}</span>
        ${s === 'short' ? `<p class="item__short">“${esc(c.short.text)}”</p>` : ''}
      </li>`;
    }).join('');
    document.getElementById('cover').innerHTML = D.requiredPoints.map((p) => {
      const by = D.cards.filter((c) => c.tags.includes(p) && cardState(c, st) !== 'cut').map((c) => c.title);
      return `<li><span class="p">${esc(p)}</span><span class="by">${esc(by.join(', ') || 'Not covered')}</span></li>`;
    }).join('');
    document.getElementById('editor').innerHTML = D.cards.map((c) => editorCard(c, cardState(c, st))).join('');
  }

  function editorCard(c, s) {
    const thinking = c.id === '4';
    const tags = D.requiredPoints.map((p) => `<label><input type="checkbox" ${c.tags.includes(p) ? 'checked' : ''} /> ${esc(p)}</label>`).join('');
    return `<li class="ed ed--${s}" ${thinking ? 'id="thinking"' : ''}>
      <div class="ed__top"><span class="ed__n num">${c.id}</span>
        <input class="ed__title" type="text" value="${esc(c.title)}" aria-label="Card ${c.id} title" />
        <span class="ed__secs"><input type="number" class="num" value="${c.seconds}" aria-label="Card ${c.id} seconds" />s</span></div>
      <textarea rows="3" aria-label="Card ${c.id} spoken text">${esc(c.text)}</textarea>
      <div class="ed__row">${tags}</div>
      <div class="ed__row"><label><input type="checkbox" /> Always keep</label>
        <label>Priority <select aria-label="Card ${c.id} priority"><option>${c.priority ?? '—'}</option></select></label>
        ${c.short ? '' : thinking
          ? '<button class="ai" type="button" aria-busy="true" disabled><span class="spin" aria-hidden="true"></span>Thinking…</button>'
          : '<button class="ai" type="button">✨ Shorten</button>'}</div>
      ${c.short ? `<div class="ed__short"><b>Short version · ${c.short.seconds}s</b> “${esc(c.short.text)}”</div>` : ''}
    </li>`;
  }

  function cueScreen() {
    const st = step(105);
    const items = cueItems(st);
    const body = items.map((it) => {
      if (it.kind === 'cut') {
        const secs = it.cards.reduce((t, c) => t + c.seconds, 0);
        return `<li class="cutmark">✂ Cut here: ${it.cards.map((c) => esc(c.title)).join(', ')} <span class="num">(${secs}s)</span></li>`;
      }
      const sp = spoken(it.card, it.state);
      return `<li class="stub ${it.state === 'short' ? 'stub--short' : ''}">
        <div class="stub__n num" aria-label="Card ${it.n}">${it.n}</div>
        <div class="stub__body">
          ${it.bridge ? `<p class="bridge">${esc(it.bridge)} <small class="num">~${D.bridge.seconds}s</small></p>` : ''}
          <div class="stub__head"><h3 class="stub__title">${esc(it.card.title)}</h3><span class="stub__time num">${sp.seconds}s</span></div>
          <p class="stub__text">${esc(sp.text)}</p>
          <div class="stub__bar" aria-hidden="true"><i style="width:${(sp.seconds / 46) * 100}%"></i></div>
          <div class="stub__tags">${it.state === 'short' ? `Shortened ${it.card.seconds}s → ${sp.seconds}s` : ''}${it.card.tags.length ? `${it.state === 'short' ? ' · ' : ''}Covers ${esc(it.card.tags.join(', '))}` : ''}</div>
        </div>
      </li>`;
    }).join('');
    app.innerHTML = `
      <div class="page">
        ${header()}
        <div class="cues">
          <aside class="rail">
            <h2>Cue cards</h2>
            <p class="big num">${fmt(st.total)}</p>
            <p class="num">of ${fmt(105)} · ${st.chips.join(', ')}</p>
            <div class="btns"><button class="btn btn--go" type="button">Print cue cards</button><button class="btn" type="button" id="back">Back</button></div>
          </aside>
          <div>
            <ol class="stubs">${body}</ol>
            <p class="total num"><b>Total ${fmt(st.total)}</b> · ${st.chips[0]} · limit ${fmt(105)} · bridge line adds ~${D.bridge.seconds}s</p>
          </div>
        </div>
      </div>`;
    document.getElementById('back').addEventListener('click', () => { location.search = ''; });
  }

  (view() === 'cues' ? cueScreen : mainScreen)();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: 'center' });
})();
