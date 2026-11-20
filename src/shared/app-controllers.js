/*
 * Core application controller.
 *
 * Navigation is owned by categories-view.js and startup by bootstrap.js.
 * This file contains only the remaining legacy-compatible actions required by
 * the existing home, archive and interaction surfaces.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Activate native-app mode so header/footer become fixed app chrome and content scrolls inside #results
  try {
    document.body.classList.add('native-app');
    // ensure results container exists and will be the main scrollable pane
    const results = document.getElementById('results');
    if (results) {
      // make results the primary scrolling region (improve accessibility)
      results.setAttribute('role', 'main');
      results.setAttribute('tabindex', '0');
    }
  } catch (e) { console.warn('Failed to enable native-app mode', e); }

});

// show first-visit modal to ask visitor to choose country + language and persist choices
document.addEventListener('DOMContentLoaded', () => {
  const firstVisitModal = document.getElementById('firstVisitModal');
  const fvCountry = document.getElementById('fvCountry');
  const fvLang = document.getElementById('fvLang');
  const fvSkip = document.getElementById('fvSkip');
  const fvSave = document.getElementById('fvSave');
  const firstVisitClose = document.getElementById('firstVisitClose');

  // The first-visit surface is intentionally removed during bootstrap so it
  // can never interrupt the native page shell.
  if (!firstVisitModal || !fvCountry || !fvLang || !fvSkip || !fvSave || !firstVisitClose) {
    return;
  }

  // Check if this is the first visit (no saved country/language)
  const savedCountry = localStorage.getItem('firstVisitCountry');
  const savedLang = localStorage.getItem('firstVisitLang');
  const isFirstVisit = !savedCountry || !savedLang;

  if (isFirstVisit) {
    firstVisitModal.style.display = 'flex';
    firstVisitModal.setAttribute('aria-hidden', 'false');
  }

  // Skip button
  fvSkip.addEventListener('click', () => {
    firstVisitModal.style.display = 'none';
    firstVisitModal.setAttribute('aria-hidden', 'true');
  });

  // Save button
  fvSave.addEventListener('click', () => {
    const selectedCountry = fvCountry.value;
    const selectedLang = fvLang.value;
    
    if (selectedCountry && selectedLang) {
      localStorage.setItem('firstVisitCountry', selectedCountry);
      localStorage.setItem('firstVisitLang', selectedLang);
      firstVisitModal.style.display = 'none';
      firstVisitModal.setAttribute('aria-hidden', 'true');
    }
  });

  // Close button
  firstVisitClose.addEventListener('click', () => {
    firstVisitModal.style.display = 'none';
    firstVisitModal.setAttribute('aria-hidden', 'true');
  });

  // Close modal when clicking outside
  firstVisitModal.addEventListener('click', (e) => {
    if (e.target === firstVisitModal) {
      firstVisitModal.style.display = 'none';
      firstVisitModal.setAttribute('aria-hidden', 'true');
    }
  });

  // Close modal when pressing Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && firstVisitModal.style.display === 'flex') {
      firstVisitModal.style.display = 'none';
      firstVisitModal.setAttribute('aria-hidden', 'true');
    }
  });
});

// Force navigation to "Accueil" on first load to ensure visitors land on the accueil view
(function ensureAccueilOnLoad(){
  // bootstrap.js is the only owner of the initial route. Keeping a second
  // load-time click here caused a navigation race and visible view flicker.
  return;
  /*
  function activateAccueil(){
    try {
      const requestedSection = new URLSearchParams(window.location.search).get('section');
      // A deep link already has an intended section. Do not force it through
      // Accueil while the SPA controllers are still registering.
      if (requestedSection && requestedSection !== 'accueil') return;
      const accueilBtn = Array.from(document.querySelectorAll('.category-item')).find(c => c.textContent.trim().toLowerCase() === 'accueil');
      if (!accueilBtn) return;
      // If not already active, trigger its click handler to switch UI to Accueil reliably
      if (!accueilBtn.classList.contains('active')) accueilBtn.click();
      // ensure Accueil-specific UI is visible
      document.body.classList.add('accueil-active');
      const redCross = document.getElementById('redCross');
      if (redCross) { redCross.style.display = 'flex'; redCross.setAttribute('aria-hidden','false'); }
      const topBanner = document.getElementById('topBanner'); if (topBanner) topBanner.style.display = 'flex';
      // hide Matrice-specific controls
      const countryBtns = document.getElementById('countryButtons'); if (countryBtns) countryBtns.style.display = 'none';
    } catch (e) { console.warn('activateAccueil failed', e); }
  }
  if (document.readyState === 'complete') activateAccueil(); else window.addEventListener('load', activateAccueil);
  */
})();

// Plant du pied wiring: open Matrice / Croix / Boules rejetées sections when buttons clicked
(function(){
  function clickCategoryByName(name) {
    const normalizedName = name.toLowerCase();
    const item = Array.from(document.querySelectorAll('.category-item, .category-item.button, .category-bar .inner > *')).find((el) => {
      const label = (el.textContent || '').trim().toLowerCase();
      return label === normalizedName || (normalizedName === 'croix' && label.startsWith('croix'));
    });
    if (item) {
      try { item.click(); return; } catch(e){}
    }
    // fallback: trigger known IDs
    if (name.toLowerCase() === 'matrice') {
      const btn = document.getElementById('plantMatriceBtn');
      if (btn) btn.click();
    } else if (normalizedName === 'croix' || normalizedName === 'croix nationale') {
      const btn = document.getElementById('submenuCroix') || document.getElementById('categoryCrossButton');
      if (btn) btn.click();
    } else if (name.toLowerCase() === 'boules rejetées' || name.toLowerCase() === 'boules rejetees') {
      const btn = document.getElementById('categoryRejectedButton');
      if (btn) btn.click();
    }
  }

  const matBtn = document.getElementById('plantMatriceBtn');
  const croixBtn = document.getElementById('plantCroixBtn');
  const rejBtn = document.getElementById('plantRejectedBtn');

  if (matBtn) matBtn.addEventListener('click', (e) => {
    e.preventDefault();
    clickCategoryByName('Matrice');
    // ensure Matrice view scrolls results into view
    setTimeout(() => { const el = document.getElementById('results'); if (el) el.scrollIntoView({behavior:'smooth', block:'start'}); }, 180);
    // ensure the calculator panel remains hidden when using the plant du pied Matrice shortcut
    try { const panel = document.getElementById('matrixCalculatorPanel'); if (panel) panel.style.display = 'none'; } catch(_) {}
  });

  if (croixBtn) croixBtn.addEventListener('click', (e) => {
    e.preventDefault();
    clickCategoryByName('Croix nationale');
    // ensure cross visible
    setTimeout(() => { const rc = document.getElementById('redCross'); if (rc) rc.scrollIntoView({behavior:'smooth', block:'center'}); }, 220);
  });

  if (rejBtn) rejBtn.addEventListener('click', (e) => {
    e.preventDefault();
    clickCategoryByName('Boules rejetées');
    // if modal exists, open it and also copy all boules (best-effort)
    setTimeout(() => {
      const modal = document.getElementById('rejectedModal');
      if (modal && typeof window.toggleRejected === 'function') window.toggleRejected(true);
      // give modal a short moment to render then trigger copy function if available
      setTimeout(() => {
        try {
          if (typeof window.copyAllRejected === 'function') window.copyAllRejected();
        } catch (err) { console.warn('auto copyAllRejected failed', err); }
      }, 300);
    }, 200);
  });
})();

// Croix remains hidden until the Croix category is chosen explicitly.

// Toggle archive modal (kept in sync with main.js updateArchiveDisplay)
const toggleArchive = (open) => {
  const archiveModal = document.getElementById('archiveModal');
  if (!archiveModal) return;
  const isOpen = archiveModal.classList.contains('open');
  const shouldOpen = (typeof open === 'boolean') ? open : !isOpen;
  if (shouldOpen) {
    archiveModal.classList.add('open');
    archiveModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    window.cidSetDocumentScrollLocked?.(true);
    document.body.classList.add('archive-active');
    // request main display update (main.js defines updateArchiveDisplay)
    if (typeof window.updateArchiveDisplay === 'function') window.updateArchiveDisplay();
    setTimeout(() => document.getElementById('archiveClose').focus(), 100);
  } else {
    archiveModal.classList.remove('open');
    archiveModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.body.classList.remove('archive-active');
    window.cidResetScrollLock?.({ resetSurfaces: false });
  }
};

// NEW: Prebuild inline auth panel at startup so "Compte" button shows the registration form instantly.
(function wireProfileButtonInlinePanel(){
  try {
    const profileBtn = document.getElementById('profileBtn');
    if (!profileBtn) return;
    // Profile is a native SPA view mounted in #results. Keep this early
    // return so the legacy inline form below can never create a popup or a
    // second authentication surface.
    // The legacy auth iframe/panel is deliberately unreachable. Compte must
    // always be mounted by profile-native.js as a full-page route.
    if (typeof window.showProfileView !== 'function') return;
    if (typeof window.showProfileView === 'function') {
      const openNativeProfile = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        try { window.cidStartViewTransition?.('Compte'); } catch (_) {}
        Promise.resolve(window.showProfileView())
          .catch((error) => console.warn('Opening native profile failed', error))
          .finally(() => { try { window.cidFinishViewTransition?.(); } catch (_) {} });
      };
      profileBtn.addEventListener('click', openNativeProfile);
      window.openInlineAuthPanel = window.showProfileView;
      return;
    }
    const authModal = document.getElementById('authModal');
    const authIframe = document.getElementById('authIframe');
    const authClose = document.getElementById('authClose');

    // The Profile section owns the complete auth/referral experience. Keep
    // the legacy inline form as a fallback only for pages that do not expose
    // the shared profile modal.
    if (authModal && authIframe) {
      const openProfile = () => {
        try { window.cidStartViewTransition?.('Compte'); } catch (_) {}
        authIframe.src = '/src/auth/auth.html';
        authModal.style.display = 'flex';
        authModal.classList.add('open');
        authModal.setAttribute('aria-hidden', 'false');
        window.cidSetDocumentScrollLocked?.(true);
        setTimeout(() => authClose && authClose.focus(), 80);
        try { window.cidFinishViewTransition?.(); } catch (_) {}
      };
      const closeProfile = () => {
        authModal.style.display = 'none';
        authModal.classList.remove('open');
        authModal.setAttribute('aria-hidden', 'true');
        authIframe.src = 'about:blank';
        document.body.style.overflow = '';
        profileBtn.removeAttribute('aria-pressed');
      };
      profileBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openProfile();
      });
      authClose && authClose.addEventListener('click', closeProfile);
      authModal.addEventListener('click', (event) => {
        if (event.target === authModal) closeProfile();
      });
      window.openInlineAuthPanel = openProfile;
      return;
    }

    // create container area under the main white area (near results) if not present
    let inlineContainer = document.getElementById('inlineAuthContainer');
    if (!inlineContainer) {
      inlineContainer = document.createElement('div');
      inlineContainer.id = 'inlineAuthContainer';
      inlineContainer.style.maxWidth = '920px';
      inlineContainer.style.margin = '12px auto';
      inlineContainer.style.background = '#ffffff';
      inlineContainer.style.borderRadius = '12px';
      inlineContainer.style.boxShadow = '0 8px 30px rgba(2,6,23,0.06)';
      inlineContainer.style.padding = '12px';
      inlineContainer.style.display = 'none';
      inlineContainer.style.zIndex = '1150';
      // place it immediately above the results area
      const results = document.getElementById('results');
      if (results && results.parentNode) results.parentNode.insertBefore(inlineContainer, results);
      else document.body.insertBefore(inlineContainer, document.body.firstChild);
    }

    // build inline auth UI immediately (prebuilt so click is fast)
    (function buildInlineAuthUI() {
      if (inlineContainer.querySelector('.inline-auth-card')) return;
      const card = document.createElement('div');
      card.className = 'inline-auth-card';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '10px';
      card.style.alignItems = 'stretch';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:900;font-size:16px;color:#0A1840">Se connecter / S'inscrire</div>
          <button id="inlineAuthCloseBtn" aria-label="Retour" style="background:transparent;border:none;font-size:24px;cursor:pointer">‹</button>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:220px">
            <label style="display:block;font-weight:700;margin-bottom:6px">Email</label>
            <input id="inlineEmail" type="email" style="width:100%;padding:10px;border-radius:8px;border:1px solid #eee" autocomplete="email"/>
          </div>
          <div style="flex:1;min-width:180px">
            <label style="display:block;font-weight:700;margin-bottom:6px">Mot de passe</label>
            <input id="inlinePassword" type="password" style="width:100%;padding:10px;border-radius:8px;border:1px solid #eee" autocomplete="current-password"/>
          </div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <button id="inlineGoogleBtn" style="flex:0 0 auto;background:#fff;border:1px solid #e6e7eb;color:#111;display:flex;align-items:center;gap:10px;justify-content:center;padding:10px;border-radius:10px;cursor:pointer;">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style="width:18px;height:18px;"/> Se connecter avec Google
          </button>
          <div style="flex:1"></div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:4px;">
          <button id="inlineLoginBtn" class="copy-button" style="background:#0962D6;color:#fff;padding:10px 12px;border-radius:10px;font-weight:800">Se connecter</button>
          <button id="inlineSignupBtn" class="copy-button" style="background:#fff;color:#0962D6;border:1px solid rgba(9,98,214,0.12);padding:10px 12px;border-radius:10px;font-weight:800">S'inscrire</button>
        </div>
        <div id="inlineAuthMessage" style="min-height:18px;color:#D62828;font-weight:700;"></div>
      `;
      inlineContainer.appendChild(card);

      // close handler
      const closeBtn = document.getElementById('inlineAuthCloseBtn');
      closeBtn && closeBtn.addEventListener('click', () => { inlineContainer.style.display = 'none'; document.body.style.overflow = ''; profileBtn.removeAttribute('aria-pressed'); });

      // Use the same Supabase auth boundary as likes and comments.
      document.getElementById('inlineGoogleBtn').addEventListener('click', async () => {
        const msg = document.getElementById('inlineAuthMessage');
        msg.textContent = '';
        try {
          // Prefer the helper signInWithGoogle from /src/auth/auth.js if available
          if (typeof window.cidAuth?.signInWithGoogle === 'function') {
            await window.cidAuth.signInWithGoogle();
            msg.style.color = '#10b981'; msg.textContent = 'Connexion via Google…';
            setTimeout(() => { inlineContainer.style.display = 'none'; profileBtn.removeAttribute('aria-pressed'); }, 600);
            return;
          }
          // Fallback: try firebase.auth provider if global firebase present
          if (window.firebase && firebase.auth && window.CIDGROUP_FIREBASE_CONFIG?.apiKey) {
            try {
              const provider = new firebase.auth.GoogleAuthProvider();
              provider.setCustomParameters({ prompt: 'select_account' });
              await firebase.auth().signInWithPopup(provider);
              msg.style.color = '#10b981'; msg.textContent = 'Connecté via Google.';
              setTimeout(() => { inlineContainer.style.display = 'none'; profileBtn.removeAttribute('aria-pressed'); }, 600);
              return;
            } catch (err) {
              console.warn('inline Google sign-in fallback failed', err);
            }
          }
          msg.style.color = '#D62828'; msg.textContent = 'Connexion Google indisponible.';
        } catch (err) {
          console.warn('inlineGoogleBtn click failed', err);
          msg.style.color = '#D62828'; msg.textContent = err && err.message ? err.message : 'Erreur Google';
        }
      });

      // Login and signup use the same remote account session as the social
      // feed. Never report a local-only fake account as connected.
      document.getElementById('inlineLoginBtn').addEventListener('click', async (e) => {
        try {
          const mail = document.getElementById('inlineEmail').value.trim();
          const pw = document.getElementById('inlinePassword').value;
          const msg = document.getElementById('inlineAuthMessage');
          msg.textContent = '';
          if (!mail || !pw) { msg.textContent = 'Veuillez saisir email et mot de passe.'; return; }
          // Supabase is the account provider used by the social feed.
          if (typeof window.cidAuth?.signInWithPassword === 'function') {
            await window.cidAuth.signInWithPassword(mail, pw);
            msg.style.color = '#10b981'; msg.textContent = 'Connexion réussie.';
            setTimeout(() => { inlineContainer.style.display = 'none'; profileBtn.removeAttribute('aria-pressed'); }, 700);
            return;
          }
          // Use Firebase only when it is genuinely configured.
          if (window.firebase && firebase.auth && window.CIDGROUP_FIREBASE_CONFIG?.apiKey) {
            try {
              await firebase.auth().signInWithEmailAndPassword(mail, pw);
              msg.style.color = '#10b981'; msg.textContent = 'Connecté, redirection…';
              setTimeout(() => { window.location.reload(); }, 500);
              return;
            } catch (err) {
              // If auth.js provided nicer showError, use it; otherwise show message
              msg.style.color = '#D62828'; msg.textContent = (err && err.message) ? err.message : 'Échec de la connexion.';
              return;
            }
          }
          msg.style.color = '#D62828';
          msg.textContent = 'La connexion du compte est indisponible pour le moment.';
        } catch (e) {
          console.warn(e);
          const msg = document.getElementById('inlineAuthMessage');
          if (msg) {
            msg.style.color = '#D62828';
            msg.textContent = e?.message || 'Échec de la connexion.';
          }
        }
      });

      document.getElementById('inlineSignupBtn').addEventListener('click', async (e) => {
        try {
          const mail = document.getElementById('inlineEmail').value.trim();
          const pw = document.getElementById('inlinePassword').value;
          const msg = document.getElementById('inlineAuthMessage');
          msg.textContent = '';
          if (!mail || !pw) { msg.textContent = 'Veuillez saisir email et mot de passe.'; return; }
          if (pw.length < 6) { msg.textContent = 'Le mot de passe doit faire au moins 6 caractères.'; return; }

          const signupBtnEl = document.getElementById('inlineSignupBtn');
          // immediate visual feedback
          const prevLabel = signupBtnEl.textContent;
          signupBtnEl.disabled = true;
          signupBtnEl.style.opacity = '0.6';
          signupBtnEl.textContent = 'Création…';

          if (typeof window.cidAuth?.signUpWithPassword === 'function') {
            await window.cidAuth.signUpWithPassword(mail, pw);
            msg.style.color = '#10b981'; msg.textContent = 'Compte créé avec succès.';
            setTimeout(() => { inlineContainer.style.display = 'none'; profileBtn.removeAttribute('aria-pressed'); }, 700);
            return;
          }
          // Use Firebase Auth create user only when it is genuinely configured.
          if (window.firebase && firebase.auth && window.CIDGROUP_FIREBASE_CONFIG?.apiKey) {
            try {
              const userCred = await firebase.auth().createUserWithEmailAndPassword(mail, pw);
              // Optionally set a default displayName if not provided
              try { if (userCred && userCred.user && !userCred.user.displayName) await userCred.user.updateProfile({ displayName: mail.split('@')[0] }); } catch(_) {}
              msg.style.color = '#10b981'; msg.textContent = 'Compte créé, redirection…';
              setTimeout(() => { window.location.reload(); }, 500);
              return;
            } catch (err) {
              msg.style.color = '#D62828'; msg.textContent = (err && err.message) ? err.message : 'Échec de l\'inscription.';
              return;
            } finally {
              // restore button state if we didn't redirect
              try { signupBtnEl.disabled = false; signupBtnEl.style.opacity = ''; signupBtnEl.textContent = prevLabel; } catch(_) {}
            }
          }

          msg.style.color = '#D62828';
          msg.textContent = 'La création du compte est indisponible pour le moment.';

          // restore button
          try { signupBtnEl.disabled = false; signupBtnEl.style.opacity = ''; signupBtnEl.textContent = prevLabel; } catch(_) {}
        } catch (e) {
          console.warn(e);
          const msg = document.getElementById('inlineAuthMessage');
          if (msg) {
            msg.style.color = '#D62828';
            msg.textContent = e?.message || 'Échec de la création du compte.';
          }
          const signupBtnEl = document.getElementById('inlineSignupBtn');
          if (signupBtnEl) {
            signupBtnEl.disabled = false;
            signupBtnEl.style.opacity = '';
            signupBtnEl.textContent = "S'inscrire";
          }
        }
      });
    })();

    // Toggle visibility on profile button click (now instantaneous because UI is prebuilt)
    profileBtn.addEventListener('click', (e) => {
      try {
        if (inlineContainer.style.display === 'none' || !inlineContainer.style.display) {
          try { window.cidStartViewTransition?.('Compte'); } catch (_) {}
          inlineContainer.style.display = 'block';
          profileBtn.setAttribute('aria-pressed', 'true');
          document.body.style.overflow = '';
          setTimeout(() => { const input = document.getElementById('inlineEmail'); if (input) input.focus(); }, 80);
          try { window.cidFinishViewTransition?.(); } catch (_) {}
        } else {
          inlineContainer.style.display = 'none';
          profileBtn.removeAttribute('aria-pressed');
        }
      } catch (err) { console.warn('Opening inline auth panel failed', err); }
    });

    // expose helper to open inline auth panel programmatically and optionally show the signup tab
    window.openInlineAuthPanel = function({ showSignup = false } = {}) {
      try {
        if (!inlineContainer) return;
        inlineContainer.style.display = 'block';
        profileBtn.setAttribute('aria-pressed', 'true');
        document.body.style.overflow = '';
        setTimeout(() => {
          try {
            const input = document.getElementById('inlineEmail'); if (input) input.focus();
            // switch to signup UI when requested
            if (showSignup) {
              // reveal signup by clicking the signup button in the inline UI if present
              const signupBtn = document.getElementById('inlineSignupBtn');
              if (signupBtn) {
                // ensure signup form-centric state: focus email field
                setTimeout(() => { try { signupBtn.focus(); } catch(_){} }, 60);
              }
            }
          } catch(e){}
        }, 80);
      } catch (e) { console.warn('openInlineAuthPanel failed', e); }
    };

  } catch (e) {
    console.warn('wireProfileButtonInlinePanel failed', e);
  }
})();

document.addEventListener('click', (e) => {
  const modal = document.getElementById('archiveModal');
  if (!modal) return;
  if (e.target === modal) toggleArchive(false);
});

document.getElementById('archiveClose').addEventListener('click', () => toggleArchive(false));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('archiveModal').classList.contains('open')) {
    toggleArchive(false);
  }
});

/* modify category click behavior to show country buttons when Matrice clicked
   and push history state so browser Back returns to previous section */
(function(){
  // categories-view.js is the sole owner of category navigation. The former
  // local category handler duplicated every click and history transition.
  // Keep this legacy block inert: registering it makes one tap run two route
  // controllers, producing delayed repainting and competing history entries.
  return;
  const categoryItems = [];
  function activateCategory(item, pushHistory = true) {
    if (!item) return;
    // ensure clicked category stays blue: clear others and set active on this one
    document.querySelectorAll('.category-item.active').forEach(a => a.classList.remove('active'));
    item.classList.add('active');
    // mark body as "accueil" when Accueil clicked, used to hide UI chrome on main white area
    if (item.textContent.trim().toLowerCase() === 'accueil') document.body.classList.add('accueil-active');
    else document.body.classList.remove('accueil-active');
    
    const key = item.textContent.trim().toLowerCase();
    const redCross = document.getElementById('redCross');
    if (key === 'accueil') {
      document.body.classList.add('accueil-active');
      const topBanner = document.getElementById('topBanner'); if (topBanner) topBanner.style.display = 'flex';
      const countryBtns = document.getElementById('countryButtons'); if (countryBtns) countryBtns.style.display = 'none';
      const resultsEl = document.getElementById('results'); if (resultsEl) resultsEl.innerHTML = '';
      if (redCross) { 
        const now = new Date();
        const rcDate = document.getElementById('redCrossDate');
        if (rcDate) {
          const saved = window.cidProgrammeState?.selectedDate || null;
          if (!saved && (!rcDate.textContent || rcDate.textContent.trim() === '')) {
      rcDate.textContent = now.toLocaleDateString(window.cidTranslation?.current?.() || 'fr', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
          }
        }
        redCross.style.display = 'flex'; redCross.setAttribute('aria-hidden','false'); 
        const sundayBtn = document.getElementById('redCrossSundayBtn');
        if (sundayBtn) {
          if (now.getDay() === 0) { sundayBtn.classList.add('show'); sundayBtn.setAttribute('aria-hidden','false'); }
          else { sundayBtn.classList.remove('show'); sundayBtn.setAttribute('aria-hidden','true'); }
        }
      }
      const elsToHide = ['currentDateTime','nextAvailableTime','nextDay','drawNumber'];
      elsToHide.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      const h1 = document.querySelector('h1'); if (h1) h1.style.display = 'none';
      document.body.classList.add('accueil-active');
      toggleArchive(false);
      return;
    }
    if (key === 'matrice') {
      document.body.classList.remove('accueil-active');
      const countryBtns = document.getElementById('countryButtons');
      if (countryBtns) { countryBtns.style.display = 'block'; renderCountryButtons(); }
      const elsToShow = ['currentDateTime','nextAvailableTime','nextDay','drawNumber'];
      elsToShow.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
      const h1 = document.querySelector('h1'); if (h1) h1.style.display = '';
      const firstBtn = countryBtns && countryBtns.querySelector('.country-filter-btn[data-country="Tous"]');
      if (firstBtn) firstBtn.classList.add('active');
      if (!generatedResults) generateLottoResults();
      const showBtn = document.getElementById('showArchiveButton'); if (showBtn) { showBtn.style.display = 'none'; }
      toggleArchive(false);
      displayResults(generatedResults || []);
      const resultsEl = document.getElementById('results');
      if (resultsEl) resultsEl.scrollIntoView({behavior: 'smooth', block: 'start'});
      document.body.classList.add('matrice-active');
      return;
    }
    if (key.startsWith('croix')) {
      if (topBanner) try { document.getElementById('topBanner').style.display = 'none'; } catch(_) {}
      document.body.classList.remove('accueil-active');
      const countryBtns = document.getElementById('countryButtons'); if (countryBtns) countryBtns.style.display = 'none';
      const resultsEl = document.getElementById('results'); if (resultsEl) resultsEl.innerHTML = '';
      if (redCross) {
          const saved = window.cidProgrammeState?.selectedDate || null;
        const rcDate = document.getElementById('redCrossDate');
        if (rcDate) {
          if (saved && (!rcDate.textContent || rcDate.textContent.trim() === '')) {
      rcDate.textContent = new Date(saved).toLocaleDateString(window.cidTranslation?.current?.() || 'fr', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
          } else if (!saved && (!rcDate.textContent || rcDate.textContent.trim() === '')) {
      rcDate.textContent = new Date().toLocaleDateString(window.cidTranslation?.current?.() || 'fr', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
          }
        }
        redCross.style.display = 'flex'; redCross.setAttribute('aria-hidden','false');
        redCross.style.marginTop = '36px';
      }
      const elsToHide = ['currentDateTime','nextAvailableTime','nextDay','drawNumber'];
      elsToHide.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      const h1 = document.querySelector('h1'); if (h1) h1.style.display = 'none';
      document.body.classList.remove('matrice-active');
      toggleArchive(false);
      return;
    }
    // default
    document.body.classList.remove('accueil-active');
    if (countryBtns) countryBtns.style.display = 'none';
    if (redCross) { redCross.style.display = 'none'; redCross.setAttribute('aria-hidden','true'); }
    document.body.classList.remove('matrice-active');
  }

  // Attach click handlers that push state
  categoryItems.forEach(item => {
    item.addEventListener('click', (ev) => {
      // Determine current active category before change for history state
      const prev = document.querySelector('.category-item.active')?.textContent?.trim() || 'accueil';
      // activate visually (and run view logic)
      activateCategory(item, true);
      // push history state so Back returns to previous label
      try {
        const state = { from: prev, to: item.textContent.trim() };
        const title = item.textContent.trim();
        const url = new URL(window.location.href);
        // include section param so deep links are bookmarkable
        url.searchParams.set('section', title.toLowerCase());
        history.pushState(state, title, url.toString());
      } catch (e) {
        // ignore history failures
      }
    });
  });

  // Listen for back/forward navigation and restore previous category
  window.addEventListener('popstate', (ev) => {
    try {
      const state = ev.state || {};
      // prefer section param in URL if present
      const params = new URLSearchParams(location.search);
      const sectionParam = params.get('section');
      const targetLabel = sectionParam || (state.to || state.from) || 'accueil';
      const target = Array.from(document.querySelectorAll('.category-item')).find(el => (el.textContent||'').trim().toLowerCase() === (targetLabel||'').toLowerCase());
      if (target) {
        activateCategory(target, false);
      } else {
        // fallback: activate Accueil
        const accueil = Array.from(document.querySelectorAll('.category-item')).find(c => c.textContent.trim().toLowerCase() === 'accueil');
        if (accueil) activateCategory(accueil, false);
      }
    } catch (e) {
      console.warn('popstate handling failed', e);
    }
  });

  // On initial load, if URL has section param, activate it without pushing history
  (function restoreFromUrl() {
    // bootstrap.js is the sole initial-route owner.
    return;
    /*
    try {
      const params = new URLSearchParams(location.search);
      const sectionParam = params.get('section');
      if (!sectionParam) return;
      const initial = Array.from(document.querySelectorAll('.category-item')).find(el => (el.textContent||'').trim().toLowerCase() === sectionParam.toLowerCase());
      if (initial) activateCategory(initial, false);
    } catch(e){}
    */
  })();
})();

// wire the new category-bar Horaires button to open the schedule modal
const catSchedBtn = document.getElementById('categoryScheduleButton');
if (catSchedBtn) {
  catSchedBtn.addEventListener('click', (e) => {
    // prevent also toggling active state via the generic category-item handler
    // allow propagation so schedule is clearly tied to all categories (including Accueil/Croix)
    // (no stopPropagation)
    // visually mark button as active briefly
    document.querySelectorAll('.category-item.active').forEach(a => a.classList.remove('active'));
    catSchedBtn.classList.add('active');
    toggleSchedule(true);
  });
}

const showScheduleBtn = document.getElementById('showScheduleButton');
if (showScheduleBtn) showScheduleBtn.addEventListener('click', () => toggleSchedule(true));

// schedule modal handling and rendering
const scheduleRules = [
  {genDay: 0, note: "Dimanche → Généré samedi à 16:00 avec la date du dimanche"},
  {genDay: 1, note: "Lundi → Généré dimanche à 16:00 avec la date du lundi"},
  {genDay: 2, note: "Mardi → Généré lundi à 16:00 avec la date du mardi"},
  {genDay: 3, note: "Mercredi → Généré mardi à 16:00 avec la date du mercredi"},
  {genDay: 4, note: "Jeudi → Généré mercredi à 16:00 avec la date du jeudi"},
  {genDay: 5, note: "Vendredi → Généré jeudi à 16:00 avec la date du vendredi"},
  {genDay: 6, note: "Samedi → Généré vendredi à 16:00 avec la date du samedi"}
];

// create a vertically scrollable column for network buttons
const sheet = document.getElementById('scheduleSheet');
const strip = document.createElement('div');
strip.style.display = 'flex';
strip.style.flexDirection = 'column';
strip.style.gap = '8px';
strip.style.alignItems = 'stretch';
strip.style.overflowY = 'auto';
strip.style.scrollBehavior = 'smooth';
strip.style.padding = '8px';
strip.style.webkitOverflowScrolling = 'touch';
strip.style.maxHeight = '56vh';
strip.style.width = '100%';

// Append only when the optional schedule sheet exists. The previous
// unconditional append aborted the whole module on the PWA shell.
if (sheet) sheet.appendChild(strip);

// Official shell compatibility hook.
// Legacy instructions are retained for persistence and non-shell behaviors,
// but they can no longer mutate the official header or bottom navigation.
window.applyInstruction = function(instruction) {
  if (!instruction || typeof instruction !== 'string') return;
  const cmd = instruction.toLowerCase();
  // set light blue overall theme
  if (cmd.includes('bleu clair') || cmd.includes('light blue')) {
    document.documentElement.style.setProperty('--main-bg-color', '#E6F4FF');
  }
  // matrix background -> white and columns blue
  if (cmd.includes('arrière-plan de matrice') || cmd.includes('fond matrice') || cmd.includes('matrice')) {
    // Do not override column background colors to avoid doubling white/blue backgrounds.
    // Only adjust text color for better contrast when Matrice theme is requested.
    document.querySelectorAll('.country-section').forEach(el => el.style.color = '#ffffff');
  }
  // make cross date stable on "Accueil" (do not overwrite)
  if (cmd.includes('date de la croix ne doit pas changer') || cmd.includes('date croix ne change pas')) {
    window.__lockRedCrossDate = true;
  }
  // set copy button white with blue label
  if (cmd.includes('bouton du clique en blanc') || cmd.includes('bouton blanc')) {
    document.querySelectorAll('.copy-button, #showArchiveButton, .fb-btn').forEach(b => {
      b.style.background = '#ffffff';
      b.style.color = '#0A84FF';
      b.style.border = '1px solid rgba(10,132,255,0.12)';
    });
  }
  // place Matrice button second in category bar
  if (cmd.includes('bouton matrice') && cmd.includes('deuxième') || cmd.includes('mettre matrice à côté de l accueil')) {
    const inner = document.querySelector('.category-bar .inner');
    if (inner) {
      const accueil = Array.from(inner.children).find(c => c.textContent.trim().toLowerCase() === 'accueil');
      const matrice = Array.from(inner.children).find(c => c.textContent.trim().toLowerCase() === 'matrice');
      if (accueil && matrice) inner.insertBefore(matrice, accueil.nextSibling);
    }
  }
  // apply persisted locks and reflect changes immediately in saved state
  try { localStorage.setItem('uiInstructionLast', JSON.stringify({ instruction, appliedAt: new Date().toISOString() })); } catch(e){}
};

// Local-storage conversation instructions are intentionally NOT re-applied to
// the page. Previously an auditor re-injected locally saved conversation
// colours/instructions into the site header and theme at startup. Removed to
// keep the header in its normal state.

// At the end of the file: on load check URL to auto-open inline auth for signup
(function autoOpenInlineAuthFromUrl(){
  try {
    const params = new URLSearchParams(window.location.search || '');
    const showSignup = params.get('showSignup') === '1' || params.get('action') === 'signup' || params.get('auth') === 'signup';
    // If param present, open the inline auth panel and prefer signup flow
    if (showSignup) {
      // Defer slightly to allow inline UI to build
      setTimeout(() => {
        try {
          if (typeof window.openInlineAuthPanel === 'function') window.openInlineAuthPanel({ showSignup: true });
          // also simulate clicking the inline signup button to emphasise sign-up action
          const signupBtn = document.getElementById('inlineSignupBtn');
          if (signupBtn) {
            // ensure email focus
            const emailIn = document.getElementById('inlineEmail');
            if (emailIn) emailIn.focus();
            // optional visual cue
            signupBtn.classList.add('active');
            setTimeout(() => signupBtn.classList.remove('active'), 900);
          }
        } catch (e) {}
      }, 260);
    }
  } catch (e){}
})();

// Also allow the main "Boules rejetées" category item to auto-copy all boules when clicked (best-effort).
(function wireCategoryRejectedAutoCopy(){
  return;
  try {
    const btn = Array.from(document.querySelectorAll('.category-item')).find(c => (c.textContent||'').trim().toLowerCase() === 'boules rejetées');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // wait for the rejected modal to open then trigger copy
      setTimeout(() => {
        try {
          if (typeof window.copyAllRejected === 'function') window.copyAllRejected();
        } catch (err) { console.warn('category rejected auto-copy failed', err); }
      }, 600);
    });
  } catch (e) { console.warn('wireCategoryRejectedAutoCopy init failed', e); }
})();

// Add helper to navigate to Accueil and wire global close handlers
(function ensureCloseReturnsToAccueil(){
  // Modal and route owners now close themselves. The old capture listener
  // forced every close affordance to Accueil after an arbitrary 80ms delay,
  // which broke deep-view Back navigation and made taps feel ignored.
  return;
  function navigateToAccueil() {
    try {
      const accueilBtn = Array.from(document.querySelectorAll('.category-item')).find(c => c.textContent.trim().toLowerCase() === 'accueil');
      if (accueilBtn) {
        // use click to ensure all existing handlers run
        accueilBtn.click();
        // make sure redCross visible (behaviour expected on Accueil)
        const rc = document.getElementById('redCross');
        if (rc) { rc.style.display = 'flex'; rc.setAttribute('aria-hidden','false'); }
      } else {
        // fallback: reload root
        window.location.href = '/index.html';
      }
    } catch (e) {
      console.warn('navigateToAccueil failed', e);
      try { window.location.href = '/index.html'; } catch(_) {}
    }
  }

  // When any element with class "modal-close" is clicked, navigate to Accueil after closing.
  document.addEventListener('click', (ev) => {
    try {
      const t = ev.target;
      if (!t) return;
      // match common close buttons by class or id
      if (t.classList && t.classList.contains('modal-close')) {
        // give existing modal-close handlers a tick to run then navigate
        setTimeout(() => navigateToAccueil(), 80);
        return;
      }
      // inline auth close buttons (various IDs used across modules)
      const inlineCloseIds = ['inlineAuthCloseBtn', 'authClose', 'firstVisitClose', 'installHelpClose', 'archiveClose', 'rejectedClose', 'methodeClose', 'scheduleClose', 'authCloseBtn', 'authCloseButton'];
      if (t.id && inlineCloseIds.includes(t.id)) {
        setTimeout(() => navigateToAccueil(), 80);
        return;
      }
      // also handle aria/role-close buttons that use data-close attribute
      if (t.getAttribute && t.getAttribute('data-close') !== null) {
        setTimeout(() => navigateToAccueil(), 80);
        return;
      }
    } catch (e) { /* ignore */ }
  }, { capture: true, passive: true });

  // Additionally, when the auth iframe requests close via postMessage, ensure we return to Accueil
  window.addEventListener('message', (ev) => {
    try {
      if (!ev.data) return;
      if (typeof ev.data === 'object' && ev.data.action === 'close') {
        // short delay to allow modal close logic to run
        setTimeout(() => navigateToAccueil(), 80);
      }
    } catch (e) {}
  });

  // When inline auth panel close button exists and is wired elsewhere, also ensure its handler triggers accueil
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const inlineClose = document.getElementById('inlineAuthCloseBtn');
      if (inlineClose) {
        inlineClose.addEventListener('click', () => {
          // ensure inline close logic runs first (existing handlers), then navigate
          setTimeout(() => navigateToAccueil(), 80);
        });
      }
    } catch (e) { /* ignore */ }
  });
})();
