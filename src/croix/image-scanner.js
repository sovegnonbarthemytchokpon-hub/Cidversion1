// image-scanner.js
// Adds image scanning + digit-position analysis and automatic alignment for the redCross numbers.

(function(){
  // helper: connected components simple extractor (binary image)
  function findBlobs(imgData, w, h, thresh=180) {
    const data = imgData.data;
    const visited = new Uint8Array(w*h);
    const blobs = [];
    const idx = (x,y)=> y*w + x;
    for (let y=0;y<h;y++){
      for (let x=0;x<w;x++){
        const i = idx(x,y);
        if (visited[i]) continue;
        const off = i*4;
        const lum = (data[off]+data[off+1]+data[off+2]) / 3;
        if (lum < thresh) { visited[i]=1; continue; } // background darker -> skip
        // flood fill
        const stack=[i]; visited[i]=1;
        let minX=x, maxX=x, minY=y, maxY=y, sumX=0,sumY=0,count=0;
        while(stack.length){
          const p = stack.pop();
          const px = p % w, py = Math.floor(p / w);
          const poff = p*4;
          const pl = (data[poff]+data[poff+1]+data[poff+2]) / 3;
          if (pl < thresh) continue;
          sumX += px; sumY += py; count++;
          if (px<minX) minX=px; if(px>maxX) maxX=px;
          if (py<minY) minY=py; if(py>maxY) maxY=py;
          const nbs = [[1,0],[-1,0],[0,1],[0,-1]];
          for (let nb of nbs){
            const nx=px+nb[0], ny=py+nb[1];
            if (nx<0||ny<0||nx>=w||ny>=h) continue;
            const ni = idx(nx,ny);
            if (visited[ni]) continue;
            visited[ni]=1;
            stack.push(ni);
          }
        }
        if (count>8) { // filter tiny noise
          blobs.push({minX,maxX,minY,maxY, cx: sumX/count, cy: sumY/count, area:count});
        }
      }
    }
    return blobs;
  }

  // Analyze an image file and return detected digit blobs (sorted right-to-left / top-to-bottom)
  async function analyzeImageFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          // draw into an offscreen canvas at a manageable size
          const maxDim = 1200;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(300, Math.round(img.width * scale));
          const h = Math.max(300, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          // draw with slight blur reduction and increase contrast by drawing to gray then threshold
          ctx.drawImage(img, 0, 0, w, h);
          // convert to imageData and simple adaptive threshold
          let imgData = ctx.getImageData(0,0,w,h);
          // compute average luminance to set threshold
          let sum = 0; const data = imgData.data;
          for (let i=0;i<data.length;i+=4) sum += (data[i]+data[i+1]+data[i+2])/3;
          const avg = sum / (data.length/4);
          const thresh = Math.max(120, Math.min(220, Math.round(avg * 1.05)));
          // enhance contrast by stretching pixels
          for (let i=0;i<data.length;i+=4) {
            for (let c=0;c<3;c++) {
              let v = data[i+c];
              v = ((v - avg) * 1.2) + avg;
              data[i+c] = Math.max(0, Math.min(255, v));
            }
          }
          ctx.putImageData(imgData,0,0);
          // re-read and find blobs
          imgData = ctx.getImageData(0,0,w,h);
          const blobs = findBlobs(imgData, w, h, thresh);
          // post-process: keep largest N (8) and sort by vertical then horizontal to map to cross layout
          blobs.sort((a,b) => {
            // prefer higher area
            if (b.area !== a.area) return b.area - a.area;
            // then by cy ascending
            if (a.cy !== b.cy) return a.cy - b.cy;
            return a.cx - b.cx;
          });
          // filter by size to remove huge background blobs (heuristic)
          const filtered = blobs.filter(b => b.area < (w*h*0.7));
          // choose up to 12 candidates (in case extra marks) and then cluster into 8 main digits
          const candidates = filtered.slice(0,12);
          if (!candidates.length) return resolve([]);
          // cluster by vertical halves and left/right to map to eight positions
          // compute center and normalize to 0..1
          const norm = candidates.map(c => ({...c, nx: c.cx / w, ny: c.cy / h}));
          // attempt to map to 8 slots by projecting onto two axes and grouping
          // create 8 slots roughly where cross numbers live (use percent coordinates similar to CSS default)
          const slotPercents = [
            {left:0.34, top:0.26}, // n1
            {left:0.50, top:0.38}, // n2
            {left:0.66, top:0.26}, // n3
            {left:0.64, top:0.50}, // n4
            {left:0.66, top:0.72}, // n5
            {left:0.50, top:0.64}, // n6
            {left:0.34, top:0.72}, // n7
            {left:0.36, top:0.50}  // n8
          ];
          // assign candidate to nearest slot (Euclidean) deterministically
          const assigned = slotPercents.map((s, i) => ({ slotIndex: i, cx: s.left * w, cy: s.top * h, candidate: null, dist: Infinity }));
          norm.forEach(c => {
            let bestIdx = -1; let bestD = Infinity;
            assigned.forEach((s, idx) => {
              const dx = (c.cx - s.cx), dy = (c.cy - s.cy);
              const d = Math.hypot(dx, dy);
              if (d < bestD) { bestD = d; bestIdx = idx; }
            });
            if (bestIdx !== -1) {
              const s = assigned[bestIdx];
              // if slot empty or this candidate is better (closer and larger area) replace
              if (!s.candidate || (bestD < s.dist && c.area >= (s.candidate.area || 0))) {
                s.candidate = c;
                s.dist = bestD;
              }
            }
          });
          // build resulting positions (percent values), default to slot if no candidate found
          const results = assigned.map((s,i) => {
            if (s.candidate) {
              return { slot: i+1, leftPct: (s.candidate.cx / w) * 100, topPct: (s.candidate.cy / h) * 100, area: s.candidate.area };
            }
            // fallback to default slot positions
            return { slot: i+1, leftPct: slotPercents[i].left * 100, topPct: slotPercents[i].top * 100, area: 0 };
          });
          resolve(results);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = (e) => reject(new Error('Image load failed'));
      // create objectURL to load image
      img.src = URL.createObjectURL(file);
    });
  }

  // apply alignment using blobs result: set percent left/top on DOM numbers and apply right-align micro-adjustments
  function applyAlignmentFromBlobs(blobs) {
    const rc = document.getElementById('redCross');
    if (!rc || !Array.isArray(blobs) || blobs.length === 0) return;
    const nums = Array.from(rc.querySelectorAll('.cross-numbers .num')).slice(0,8);
    if (nums.length < 8) return;
    // ensure deterministic mapping by slot order
    blobs.sort((a,b) => a.slot - b.slot);
    blobs.slice(0,8).forEach((b, i) => {
      try {
        const el = nums[i];
        // place slightly to the right for "aligner à droite" intent: nudge +1.8% of width to the right except center column
        let left = b.leftPct;
        const isCenterCol = Math.abs(left - 50) < 6;
        const rightNudge = isCenterCol ? 0 : 1.8; // percent
        left = Math.min(98, Math.max(2, left + rightNudge));
        const top = b.topPct;
        el.style.setProperty('left', left.toFixed(2) + '%', 'important');
        el.style.setProperty('top', top.toFixed(2) + '%', 'important');
        // micro-adjust font-size relative to detected blob area (bigger area -> slightly larger font)
        if (b.area && b.area > 0) {
          const scale = 1 + Math.min(0.35, Math.max(0, Math.log10(b.area + 1) / 3));
          // compute base font from computed style then scale
          const cs = window.getComputedStyle(el);
          const baseFs = parseFloat(cs.fontSize) || 40;
          el.style.setProperty('font-size', Math.round(baseFs * scale) + 'px', 'important');
          el.style.setProperty('line-height', '1', 'important');
        }
        // ensure transform keeps centered anchor but we moved left/top already
        el.style.setProperty('transform', 'translate(-50%,-50%)', 'important');
        el.style.setProperty('pointer-events','none','important');
      } catch(e){}
    });

    // After placing, apply symmetry corrections: ensure 9 and 0 face each other horizontally
    try {
      const el9 = nums.find(n => (n.textContent||'').trim() === '9');
      const el0 = nums.find(n => (n.textContent||'').trim() === '0');
      if (el9 && el0) {
        const rcRect = rc.getBoundingClientRect();
        const getPercent = (el) => {
          const leftRaw = el.style.left || getComputedStyle(el).left || '50%';
          const topRaw = el.style.top || getComputedStyle(el).top || '50%';
          const l = String(leftRaw).trim().replace('%',''); const t = String(topRaw).trim().replace('%','');
          return { left: parseFloat(l) || 50, top: parseFloat(t) || 50 };
        };
        const p9 = getPercent(el9);
        const center = 50;
        const dist = Math.abs(p9.left - center);
        const mirroredLeft = Math.max(2, Math.min(98, center - dist));
        // put 0 on mirrored left at same vertical
        el0.style.setProperty('left', mirroredLeft.toFixed(2) + '%', 'important');
        el0.style.setProperty('top', p9.top.toFixed(2) + '%', 'important');
        el0.style.setProperty('transform', 'translate(-50%,-50%) translateY(-1mm)', 'important'); // micro-raise
      }
    } catch(e){}

    // persist the positions canonical for current cross date so alignment is reused
    try {
      const rcDate = document.getElementById('redCrossDate');
      const dateKey = (rcDate && rcDate.textContent) ? rcDate.textContent.replace(/\s+/g,'_').slice(0,30) : (new Date()).toISOString().slice(0,10);
      const positions = Array.from(nums.slice(0,8)).map(el => ({
        text: (el.textContent||'').trim(),
        left: parseFloat(String(el.style.left || getComputedStyle(el).left || '50%').replace('%','')) || 50,
        top: parseFloat(String(el.style.top || getComputedStyle(el).top || '50%').replace('%','')) || 50
      }));
      try {
        window.cidProgrammeState = window.cidProgrammeState || { selectedDate: null, removedDigits: [], positions: Object.create(null), canonical: Object.create(null) };
        window.cidProgrammeState.positions[dateKey] = { positions, savedAt: new Date().toISOString() };
      } catch(_) {}
      // also store a latest pointer
      try { window.cidProgrammeState.positions.latest = { positions, savedAt: new Date().toISOString(), date: dateKey }; } catch(_) {}
    } catch(e){}
  }

  // wire to existing image scan flow by looking for file input created in app-controllers.js
  document.addEventListener('click', (e) => {
    // if user clicked the imageScanBtn we ensure the scanner uses enhanced analysis
    const scanBtn = document.getElementById('imageScanBtn');
    if (!scanBtn) return;
    if (e.target !== scanBtn) return;
    // find the hidden input added by app-controllers.js (it appends an input earlier)
    const input = Array.from(document.querySelectorAll('input[type="file"]')).find(i => i.accept && i.accept.includes('image'));
    if (!input) return;
    // attach enhanced change handler only once
    if (input.__scannerEnhanced) return;
    input.__scannerEnhanced = true;
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        // analyze file
        const blobs = await analyzeImageFile(file);
        if (!blobs || !blobs.length) {
          alert('Aucun chiffre détecté sur l\'image fournie. Essayez une photo plus nette ou recadrée sur la croix.');
          input.value = '';
          return;
        }
        // apply alignment adjustments to DOM
        applyAlignmentFromBlobs(blobs);
        alert('Alignement automatique appliqué aux chiffres de la croix.');
      } catch (err) {
        console.error('Analyse image échouée', err);
        alert('Échec de l\'analyse de l\'image. Essayez une photo plus nette ou rapprochée des chiffres.');
      } finally {
        input.value = '';
      }
    });
  });

})();
