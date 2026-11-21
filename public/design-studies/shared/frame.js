/* Renders each [data-frame] as an iframe at its true size (e.g. 1440×1000), scaled to fit its box. */
(function () {
  for (const box of document.querySelectorAll('[data-frame]')) {
    const w = Number(box.dataset.w);
    const h = Number(box.dataset.h);
    const iframe = document.createElement('iframe');
    iframe.src = box.dataset.frame;
    iframe.title = box.dataset.title || 'Preview';
    iframe.loading = 'lazy';
    iframe.style.width = `${w}px`;
    iframe.style.height = `${h}px`;
    box.append(iframe);
    const fit = () => {
      const s = box.clientWidth / w;
      iframe.style.transform = `scale(${s})`;
      box.style.height = `${h * s}px`;
    };
    new ResizeObserver(fit).observe(box);
    fit();
  }
})();
