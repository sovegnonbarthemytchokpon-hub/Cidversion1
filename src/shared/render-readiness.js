/*
 * Render readiness gate.
 *
 * The application has several legacy boot paths (classic scripts, module
 * scripts and background data refreshes). This small module gives them one
 * shared contract: the shell can render immediately while styles, fonts and
 * data-driven DOM updates settle in the background.
 */

// Readiness is only meant to prevent a layout flash. It must never wait for
// remote images, analytics or an unavailable font and leave the visitor under
// a white screen.
const FRAME_TIMEOUT = 40;
const MINIMUM_BOOT_MS = 80;

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 16);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, FRAME_TIMEOUT);
  });
}

function waitForStylesheets() {
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  if (!links.length) return Promise.resolve();

  return Promise.all(links.map((link) => new Promise((resolve) => {
    if (link.sheet) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      link.removeEventListener('load', finish);
      link.removeEventListener('error', finish);
      resolve();
    };
    link.addEventListener('load', finish, { once: true });
    link.addEventListener('error', finish, { once: true });
    setTimeout(finish, 120);
  })));
}

async function waitForFonts() {
  if (!document.fonts || !document.fonts.ready) return;
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 100))
    ]);
  } catch (_) {
    // A font failure should not leave the application permanently covered.
  }
}

function readLayout() {
  const elements = {
    header: document.querySelector('.site-header'),
    headerInner: document.querySelector('.site-header .header-inner'),
    banner: document.getElementById('topBanner'),
    title: document.getElementById('matrixPageTitle'),
    cross: document.getElementById('redCross'),
    results: document.getElementById('results'),
    navigation: document.querySelector('.category-bar')
  };
  const signature = [];

  Object.entries(elements).forEach(([name, element]) => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    signature.push([
      name,
      Math.round(rect.left * 100) / 100,
      Math.round(rect.top * 100) / 100,
      Math.round(rect.width * 100) / 100,
      Math.round(rect.height * 100) / 100,
      computed.display,
      computed.visibility
    ].join(':'));
  });

  /*
   * The bottom navigation is part of the shell contract too. It was
   * previously omitted from the readiness signature, allowing the app to be
   * revealed while its final bottom geometry was still settling.
   */
  const viewport = window.visualViewport;
  signature.push([
    'viewport',
    Math.round((window.innerHeight || 0) * 100) / 100,
    Math.round((viewport?.height || 0) * 100) / 100,
    Math.round((viewport?.offsetTop || 0) * 100) / 100
  ].join(':'));

  return signature.join('|');
}

function waitForShellToSettle() {
  /*
   * `load` only says that resources finished. It does not guarantee that the
   * last async component has finished mounting its real DOM. Keep the shell
   * covered while the mounted surfaces stay quiet for a short window so the
   * visitor never sees an intermediate feed height.
   */
    return new Promise((resolve) => {
    const observed = [
      document.body,
      document.querySelector('.site-header'),
      document.querySelector('.category-bar'),
      document.getElementById('results')
    ].filter(Boolean);
    let quietTimer = 0;
    let maxTimer = 0;
    let frame = 0;
    let previous = readLayout();
    let settled = false;
    let mutationObserver;
    let resizeObserver;

    const cleanup = () => {
      settled = true;
      window.clearTimeout(quietTimer);
      window.clearTimeout(maxTimer);
      if (frame && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame);
      }
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.visualViewport?.removeEventListener('resize', markDirty);
      window.visualViewport?.removeEventListener('scroll', markDirty);
    };

    const finish = () => {
      if (settled) return;
      cleanup();
      resolve();
    };

    const check = () => {
      frame = 0;
      if (settled) return;
      const current = readLayout();
      if (current === previous) finish();
      else {
        previous = current;
        schedule();
      }
    };

    const schedule = () => {
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => {
        if (typeof requestAnimationFrame === 'function') {
          frame = requestAnimationFrame(check);
        } else {
          check();
        }
      }, 60);
    };

    const markDirty = () => {
      previous = readLayout();
      schedule();
    };

    mutationObserver = new MutationObserver(markDirty);
    observed.forEach((element) => {
      mutationObserver.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
        childList: true,
        subtree: true,
        characterData: true
      });
    });

    resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(markDirty)
      : null;
    [document.querySelector('.site-header'),
      document.querySelector('.category-bar'),
      document.getElementById('results')]
      .filter(Boolean)
      .forEach((element) => resizeObserver?.observe(element));
    window.visualViewport?.addEventListener('resize', markDirty, { passive: true });
    window.visualViewport?.addEventListener('scroll', markDirty, { passive: true });

    maxTimer = window.setTimeout(finish, 420);
    schedule();
  });
}

/*
 * Optional, safe "real content" gate. Callers (bootstrap) register the
 * synchronous component-shell mount; it must never wait for a remote payload.
 * A hard timeout guarantees that a slow block cannot cover ready siblings.
 */
const EXTRA_READINESS_TIMEOUT_MS = 900;
const extraReadiness = [];
const registerContentReady = (promise) => {
  if (promise && typeof promise.then === 'function') {
    const capped = Promise.race([
      promise,
      new Promise((resolve) => window.setTimeout(resolve, EXTRA_READINESS_TIMEOUT_MS))
    ]).catch(() => {});
    extraReadiness.push(capped);
  }
};

export async function waitForRenderReadiness() {
  /*
   * `load` includes optional images, remote fonts and third-party assets.
   * None of those are required to paint the fixed shell or cached cards.
   * Keep only a short stylesheet/font grace period and one layout frame in
   * the first-paint path; data refreshes continue independently.
   */
  await Promise.all([
    waitForStylesheets(),
    waitForFonts(),
    nextFrame()
  ]);
  await Promise.race([
    waitForShellToSettle(),
    new Promise((resolve) => window.setTimeout(resolve, 180))
  ]);

  // Component shells are reserved before reveal. Their data can continue to
  // hydrate independently without turning a slow request into a white frame.
  if (extraReadiness.length) {
    await Promise.all(extraReadiness);
  }

  // Force a real style/layout pass, then require two equal snapshots. This
  // prevents the first visible frame from using pre-font or pre-DOM-update
  // dimensions and then jumping a moment later.
  let previous = '';
  let stableFrames = 0;
  for (let attempt = 0; attempt < 3 && stableFrames < 2; attempt += 1) {
    await nextFrame();
    const current = readLayout();
    if (current && current === previous) stableFrames += 1;
    else stableFrames = 0;
    previous = current;
  }

  // One final read is intentional: it flushes the exact computed dimensions
  // that the first visible frame will use.
  readLayout();
  return true;
}

let revealPromise = null;

export function revealApplication() {
  if (window.__cidRenderReady === true) return Promise.resolve();
  if (revealPromise) return revealPromise;

  revealPromise = (async () => {
    const startedAt = Number(window.__cidBootStartedAt) || performance.now();
    const elapsed = performance.now() - startedAt;
    const remaining = Math.max(0, MINIMUM_BOOT_MS - elapsed);
    if (remaining > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, remaining));
    }
    document.documentElement.classList.add('cid-render-ready');
    document.documentElement.classList.remove('cid-render-pending');
    window.__cidRenderReady = true;
    if (document.body) document.body.setAttribute('aria-busy', 'false');
  })();
  return revealPromise;
}

const api = { waitForRenderReadiness, revealApplication, readLayout };
window.__cidRenderReadiness = api;
window.__cidRevealApplication = revealApplication;
window.__cidRegisterContentReady = registerContentReady;

// Set the pending state as soon as this module is evaluated. The inline CSS
// also defaults to pending, so there is no visible flash before this runs.
document.documentElement.classList.add('cid-render-pending');

/*
 * Last-resort safety net. It is intentionally armed only after the native
 * load boundary: revealing before that point lets a late stylesheet or image
 * move the shell when the browser progress bar reaches 100%.
 */
const revealAfterNativeLoad = () => {
  window.setTimeout(() => {
    if (!window.__cidRenderReady) revealApplication();
  }, 1800);
};

if (document.readyState === 'complete') {
  revealAfterNativeLoad();
} else {
  window.addEventListener('load', revealAfterNativeLoad, { once: true });
}
