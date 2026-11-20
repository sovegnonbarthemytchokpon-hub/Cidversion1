// redCross.js
// Extracted red cross download and long-press behaviour for clarity.

export function downloadRedCrossImage() {
  // delegate to downloadCross logic which now produces a static high-quality image without mutating DOM
  try { const btn = document.getElementById('redCrossBottomBtn'); if (btn) btn.click(); }
  catch(e) { window.open('https://pin.it/1eDW1rAg3', '_blank'); }
}

// attach UI menu and handlers (mirrors previous logic but isolated)
(function(){
  document.addEventListener('click', (e) => {
    const btn = document.getElementById('redCrossBottomBtn');
    if (!btn) return;
    if (e.target === btn) {
      let menu = document.getElementById('redCrossDownloadMenu');
      if (menu) { menu.remove(); return; }
      menu = document.createElement('div');
      menu.id = 'redCrossDownloadMenu';
      menu.style.position = 'absolute';
      menu.style.right = (btn.getBoundingClientRect().right - btn.parentElement.getBoundingClientRect().left + 8) + 'px';
      menu.style.top = (btn.getBoundingClientRect().top - btn.parentElement.getBoundingClientRect().top - 6) + 'px';
      menu.style.background = '#111'; menu.style.color = '#fff'; menu.style.padding = '8px'; menu.style.borderRadius = '8px'; menu.style.zIndex = 12000; menu.style.display = 'flex'; menu.style.gap = '8px';
      const svgBtn = document.createElement('button'); svgBtn.textContent = 'SVG'; svgBtn.style.cssText = 'background:#fff;color:#000;border:none;padding:6px 10px;border-radius:6px';
      const pngBtn = document.createElement('button'); pngBtn.textContent = 'PNG'; pngBtn.style.cssText = svgBtn.style.cssText;
      svgBtn.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); if (window.downloadCanonicalImage) window.downloadCanonicalImage(); menu.remove(); });
      pngBtn.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); if (window.downloadCanonicalImage) window.downloadCanonicalImage(); menu.remove(); });
      menu.appendChild(svgBtn); menu.appendChild(pngBtn);
      const parent = document.getElementById('redCross'); if (parent) parent.appendChild(menu);
      setTimeout(() => {
        document.addEventListener('click', function remover(evt){
          if (!menu.contains(evt.target) && evt.target !== btn) { menu.remove(); document.removeEventListener('click', remover); }
        });
      }, 10);
    }
  });
})();