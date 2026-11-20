// /src/croix/downloadCross.js
(function(){
  function serializeSvgString(svgString) {
    // ensure proper XML header for some browsers
    return '<?xml version="1.0" encoding="utf-8"?>\n' + svgString;
  }

  function buildCombinedSVG() {
    const rc = document.getElementById('redCross');
    if (!rc) return null;
    // clone node to compute layout without touching the on-screen element
    const cloneRoot = rc.cloneNode(true);
    // force full inlined styles for the clone so snapshot looks identical
    // compute computed styles for key elements and inline minimal necessary attributes
    const computedRootStyle = getComputedStyle(rc);
    const bg = computedRootStyle.backgroundColor || '#800020';
    // create a SVG wrapper of fixed export size (high quality)
    const width = 1200, height = 1200; // larger export for professional output
    const ns = 'http://www.w3.org/2000/svg';
    const wrapper = document.createElementNS(ns,'svg');
    wrapper.setAttribute('xmlns', ns);
    wrapper.setAttribute('width', String(width));
    wrapper.setAttribute('height', String(height));
    wrapper.setAttribute('viewBox', `0 0 ${width} ${height}`);
    // background
    const rect = document.createElementNS(ns,'rect');
    rect.setAttribute('x','0'); rect.setAttribute('y','0'); rect.setAttribute('width', String(width)); rect.setAttribute('height', String(height));
    rect.setAttribute('fill', bg);
    wrapper.appendChild(rect);
    // import and scale original SVG lines
    const originalSvg = rc.querySelector('svg');
    if (originalSvg) {
      const linesGroup = document.createElementNS(ns,'g');
      linesGroup.setAttribute('transform', `translate(${width*0.2},${height*0.2}) scale(${(width*0.6)/100})`);
      Array.from(originalSvg.querySelectorAll('line')).forEach(l => {
        const line = document.createElementNS(ns,'line');
        line.setAttribute('x1', l.getAttribute('x1') || '0');
        line.setAttribute('y1', l.getAttribute('y1') || '0');
        line.setAttribute('x2', l.getAttribute('x2') || '0');
        line.setAttribute('y2', l.getAttribute('y2') || '0');
        // preserve stroke color from computed style but fall back to white/black as needed
        const stroke = getComputedStyle(l).stroke || '#000';
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', '2');
        linesGroup.appendChild(line);
      });
      wrapper.appendChild(linesGroup);
    }
    // render numbers from computed positions (do not change DOM)
    const nums = Array.from(rc.querySelectorAll('.cross-numbers .num'));
    const containerRect = rc.getBoundingClientRect();
    nums.forEach(n => {
      const styles = getComputedStyle(n);
      // calculate center positions based on percentages if present
      let left = n.style.left || styles.left || '50%';
      let top = n.style.top || styles.top || '50%';
      left = String(left).trim().replace('%','');
      top = String(top).trim().replace('%','');
      const x = (parseFloat(left) / 100) * width || width/2;
      const y = (parseFloat(top) / 100) * height || height/2;
      const text = document.createElementNS(ns,'text');
      text.setAttribute('x', String(x));
      text.setAttribute('y', String(y));
      text.setAttribute('text-anchor','middle');
      text.setAttribute('dominant-baseline','central');
      text.setAttribute('fill', styles.color || '#ffffff');
      text.setAttribute('font-family', "Archivo Black, Audiowide, Noto Sans, sans-serif");
      text.setAttribute('font-weight','900');
      // scale font size proportionally using computed font-size
      const fs = parseFloat(styles.fontSize) || 40;
      const scaled = Math.round(fs * (width/380));
      text.setAttribute('font-size', String(Math.max(20, Math.min(220, scaled))));
      text.textContent = n.textContent.trim();
      wrapper.appendChild(text);
    });
    // date and terminaison (snapshot as text)
    const dateEl = rc.querySelector('#redCrossDate');
    if (dateEl && dateEl.textContent.trim()) {
      const d = document.createElementNS(ns,'text');
      d.setAttribute('x', String(width*0.5));
      d.setAttribute('y', String(height*0.06));
      d.setAttribute('text-anchor','middle');
      d.setAttribute('fill', getComputedStyle(dateEl).color || '#000');
      d.setAttribute('font-family', "Archivo Black, Noto Sans, sans-serif");
      d.setAttribute('font-weight','900');
      d.setAttribute('font-size', String(Math.round(28 * (width/380))));
      d.textContent = dateEl.textContent.trim();
      wrapper.appendChild(d);
    }
    // terminaison block (left vertical) - render as rotated group
    const termTitle = rc.querySelector('.term-title');
    const termParen = rc.querySelector('.term-paren');
    if ((termTitle && termTitle.textContent.trim()) || (termParen && termParen.textContent.trim())) {
      const g = document.createElementNS(ns,'g');
      g.setAttribute('transform', `translate(${width*0.06},${height*0.5}) rotate(-90)`);
      if (termTitle && termTitle.textContent.trim()) {
        const t1 = document.createElementNS(ns,'text');
        t1.setAttribute('x','0'); t1.setAttribute('y','0');
        t1.setAttribute('fill', getComputedStyle(termTitle).color || '#000');
        t1.setAttribute('font-family', "Archivo Black, Noto Sans, sans-serif");
        t1.setAttribute('font-weight','900');
        t1.setAttribute('font-size', String(Math.round(20 * (width/380))));
        t1.textContent = termTitle.textContent.trim();
        g.appendChild(t1);
      }
      if (termParen && termParen.textContent.trim()) {
        const t2 = document.createElementNS(ns,'text');
        t2.setAttribute('x','0'); t2.setAttribute('y', String(Math.round(30 * (width/380))));
        t2.setAttribute('fill', getComputedStyle(termParen).color || '#000');
        t2.setAttribute('font-family', "Archivo Black, Noto Sans, sans-serif");
        t2.setAttribute('font-weight','900');
        t2.setAttribute('font-size', String(Math.round(18 * (width/380))));
        t2.textContent = termParen.textContent.trim();
        g.appendChild(t2);
      }
      wrapper.appendChild(g);
    }
    return wrapper.outerHTML;
  }

  // Instead of opening external links, fetch the canonical image and force a download (fallback to html2canvas)
  (function(){
    // Use the provided Wix canonical image URL so downloads match the user's requested image
    const EXTERNAL_CROSS_IMAGE = 'https://static.wixstatic.com/media/5d0fee_c5162490a9294e549aaa3a3452a6cfde~mv2.jpg';

    async function fetchAndDownload(url, filename) {
      try {
        const resp = await fetch(url, { mode: 'cors', cache: 'no-store' });
        if (!resp.ok) throw new Error('Fetch failed');
        const blob = await resp.blob();
        const ext = (blob.type && blob.type.split('/')[1]) || 'jpg';
        const a = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        a.href = objectUrl;
        a.download = filename || `croix.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
        return true;
      } catch (err) {
        console.warn('fetchAndDownload failed, will fallback', err);
        return false;
      }
    }

    async function downloadCanonicalImage() {
      // Preferred: generate a precise SVG snapshot from the DOM and download it
      try {
        const svgString = buildCombinedSVG();
        if (svgString) {
          const svgBlob = new Blob([serializeSvgString(svgString)], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(svgBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'croix.svg';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 3000);
          return;
        }
      } catch (err) {
        console.warn('SVG generation failed, falling back to canvas export', err);
      }
      // Fallback: use html2canvas PNG export if SVG generation not possible
      const el = document.getElementById('redCross');
      if (!el || typeof html2canvas === 'undefined') {
        window.open(EXTERNAL_CROSS_IMAGE, '_blank');
        return;
      }
      try {
        // use a conservative scale to avoid heavy canvas rendering on low-end devices
        const canvas = await html2canvas(el, { backgroundColor: null, scale: 1 });
        canvas.toBlob((blob) => {
          if (!blob) { window.open(EXTERNAL_CROSS_IMAGE, '_blank'); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'croix.png'; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 3000);
        }, 'image/png');
      } catch (e) {
        console.warn('html2canvas fallback failed', e);
        window.open(EXTERNAL_CROSS_IMAGE, '_blank');
      }
    }

    // Export helper to copy canonical PNG to clipboard (falls back to copying URL)
    async function copyCanonicalImageToClipboard() {
      const CANONICAL = '/src/shared/images/croix-canonical.png';
      try {
        // try fetch the image as blob
        const resp = await fetch(CANONICAL, { cache: 'no-store' });
        if (!resp.ok) throw new Error('Fetch failed');
        const blob = await resp.blob();
        // try ClipboardItem if supported
        if (navigator.clipboard && window.ClipboardItem) {
          const item = new ClipboardItem({ [blob.type]: blob });
          await navigator.clipboard.write([item]);
          alert("Image de la croix copiée dans le presse-papiers. Collez-la (Ctrl+V) là où vous écrivez votre prompt.");
          return true;
        }
        // fallback: write URL to clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(`https://cidmap.com${CANONICAL}`);
          alert("Impossible de copier l'image directement — l'URL de l'image a été copiée à la place.");
          return true;
        }
      } catch (err) {
        console.warn('copyCanonicalImageToClipboard failed', err);
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(`https://cidmap.com${CANONICAL}`);
            alert("Copie directe impossible — l'URL de l'image a été copiée.");
            return true;
          }
        } catch(e){}
      }
      alert("Échec de la copie de l'image.");
      return false;
    }

    // expose globally
    window.copyCanonicalImageToClipboard = copyCanonicalImageToClipboard;

    // attach click to the black download button to trigger proper download
    document.addEventListener('click', (e) => {
      const btn = document.getElementById('redCrossBottomBtn');
      const btnClone = document.getElementById('redCrossBottomBtn-clone');
      if (!btn && !btnClone) return;
      if (e.target === btn || e.target === btnClone) {
        e.preventDefault();
        e.stopPropagation();
        downloadCanonicalImage();
      }
    });

    // new: long-press on the cross to capture & download a PNG (falls back to opening canonical image)
    (function(){
      const el = document.getElementById('redCross');
      if (!el || typeof html2canvas === 'undefined') return;
      let holdTimer = null; const HOLD_MS = 800; // slightly larger to avoid accidental heavy exports
      const startHold = (e) => { if (e.type === 'pointerdown' && e.button !== 0) return; holdTimer = setTimeout(async () => {
        try {
          const canvas = await html2canvas(el, { backgroundColor: null, scale: Math.min(2, window.devicePixelRatio || 1) });
          canvas.toBlob((blob) => {
            if (!blob) { window.open('https://pin.it/1eDW1rAg3','_blank'); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'croix.png'; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 3000);
          }, 'image/png');
        } catch (err) { console.warn('export failed', err); window.open('https://pin.it/1eDW1rAg3','_blank'); }
      }, HOLD_MS); };
      const cancelHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
      el.addEventListener('pointerdown', startHold);
      el.addEventListener('pointerup', cancelHold);
      el.addEventListener('pointercancel', cancelHold);
      el.addEventListener('pointerleave', cancelHold);
      el.addEventListener('touchstart', startHold, { passive: true });
      el.addEventListener('touchend', cancelHold, { passive: true });
      el.addEventListener('touchmove', cancelHold, { passive: true });
    })();

    // tighten export: produce a high-resolution static PNG/SVG snapshot without mutating DOM or revealing menus on long-press.
    // ensure generating the image never modifies visible elements or styles.
  })();

  // tighten export: produce a high-resolution static PNG/SVG snapshot without mutating DOM or revealing menus on long-press.
  // ensure generating the image never modifies visible elements or styles.


  /* wire the new copy button in the DOM without mutating visible layout earlier */
  document.addEventListener('click', (e) => {
    const copyBtn = document.getElementById('redCrossCopyImageBtn');
    if (!copyBtn) return;
    if (e.target === copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      copyCanonicalImageToClipboard();
    }
  });

  /* show copy button when user long-presses or clicks the cross (non-interactive numbers remain) */
  (function(){
    const cross = document.getElementById('redCross');
    const copyBtn = document.getElementById('redCrossCopyImageBtn');
    if (!cross || !copyBtn) return;
    // show on pointerenter / touchstart and hide after a short timeout when leaving
    let hideTimer = null;
    const show = () => { copyBtn.style.display = 'inline-flex'; clearTimeout(hideTimer); };
    const scheduleHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => { copyBtn.style.display = 'none'; }, 3500); };
    cross.addEventListener('pointerenter', show); cross.addEventListener('pointerleave', scheduleHide);
    cross.addEventListener('touchstart', show, { passive:true }); cross.addEventListener('touchend', scheduleHide, { passive:true });
  })();
})();
