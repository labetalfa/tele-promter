  (function () {
    'use strict';

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

    const prefersReduceMotion = () =>
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const LS_KEY = 'flowprompter_v1';


    const state = {
      playing: false,
      countdown: false,
      countdownEnabled: true,
      loop: false,
      speed: 28,
      theme: 'def',
      mirror: 'off',
      bandPos: 'mid',
      blurPx: 8,
      vignette: 0.88,
      fontScale: 1,
      lineHeight: 1.52,
      align: 'left',
      loopRaf: null,
      lastTs: 0,
      pos: 0,
      max: 0,
      elapsedMs: 0,
      manualDrag: false,
      dragStartY: 0,
      dragStartPos: 0,
      facing: 'user',
      camOn: false,
      recOn: false,
      audioOn: true,
      pipCorner: 'tr',
      camLayout: 'pip',
      pipSizePct: 26,
      pipOpacity: 1,
      fillCamOpacity: 0.45,
      fillScrimOpacity: 0.38,
      fillTextGlow: 0.42,
      bandHeightPx: 140,
      lineThicknessPx: 2,
      bandFillOpacity: 0.92,
      stream: null,
      recorder: null,
      chunks: [],
      recordBlob: null,
      saveTimer: null,
      camSwitchBusy: false,
      camOpenBusy: false,
      camOpenToken: 0,
      countdownTimeouts: [],
    };

    const els = {
      body: document.body,
      stage: $('#stage'),
      viewport: $('#viewport'),
      track: $('#track'),
      mirrorShell: $('#mirrorShell'),
      script: $('#script'),
      trackTrailer: $('#trackTrailer'),
      readingLayer: $('#readingLayer'),
      blurTop: $('#blurTop'),
      blurBot: $('#blurBot'),
      rlTop: $('#rlTop'),
      rlBot: $('#rlBot'),
      vignette: $('#vignetteEl'),
      countdown: $('#countdown'),
      cdNum: $('#cdNum'),
      pip: $('#pip'),
      pipVideo: $('#pipVideo'),
      pipPh: $('#pipPh'),
      camBackdrop: $('#camBackdrop'),
      camVideoBackdrop: $('#camVideoBackdrop'),
      camScrim: $('#camScrim'),
      taD: $('#textarea-desktop'),
      taM: $('#textarea-mobile'),
      statsD: $('#stats-desktop'),
      statsM: $('#stats-mobile'),
      estD: $('#est-desktop'),
      btnPlay: $('#btn-play'),
      btnReset: $('#btn-reset'),
      progBar: $('#progBar'),
      progFill: $('#progFill'),
      elapsed: $('#elapsed'),
      statusDot: $('#statusDot'),
      speed: $('#speed'),
      speedVal: $('#speedVal'),
      wpmEst: $('#wpmEst'),
      sheetBackdrop: $('#sheetBackdrop'),
      sheets: { editor: $('#sheet-editor'), settings: $('#sheet-settings'), cam: $('#sheet-cam') },
      settingsRoot: $('#settings-root'),
      settingsMobile: $('#settings-mobile'),
      camMobile: $('#cam-mobile-body'),
      mobileBar: $('#mobileBar'),
      panelEditor: $('#panel-editor'),
      panelSettings: $('#panel-settings'),
      tabEditor: $('#tab-editor'),
      tabPrompter: $('#tab-prompter'),
      btnCamTop: $('#btn-cam-top'),
      btnFlipHead: $('#btn-flip-cam-head'),
      btnRecTop: $('#btn-rec-top'),
      btnFs: $('#btn-fs'),
      mobFlipFab: $('#mob-flip-cam-fab'),
      fsExit: $('#fs-exit'),
      transport: $('#transport'),
    };

    function toast(msg) {
      const t = $('#toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(toast._tm);
      toast._tm = setTimeout(() => t.classList.remove('show'), 2200);
    }

    function fmtTime(sec) {
      const s = Math.max(0, Math.floor(sec));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function wpmFromSpeed(spd) {
      if (spd <= 0) return 0;
      return Math.round(70 + (spd / 100) * 150);
    }

    function getReadingLineViewportY() {
      const line = els.readingLayer && els.readingLayer.querySelector('.rl-line');
      const V = els.viewport.clientHeight || 0;
      if (!line || !V) return V * 0.5;
      const vr = els.viewport.getBoundingClientRect();
      const lr = line.getBoundingClientRect();
      const y = lr.top + lr.height / 2 - vr.top;
      return Math.max(4, Math.min(V - 4, y));
    }

    function getScriptAnchorYInTrack() {
      const s = els.script;
      const text = (s.textContent || '').trim();
      const cs = getComputedStyle(s);
      const lhRaw = parseFloat(cs.lineHeight);
      const linePx = Number.isFinite(lhRaw) ? lhRaw : (parseFloat(cs.fontSize) || 24) * 1.52;
      if (!text) return Math.max(linePx * 0.5, 8);
      /** offsetTop transform’dan etkilenmez; getBoundingClientRect kaydırma sırasında bozulur */
      const top = s.offsetTop;
      const h = s.offsetHeight;
      return top + Math.max(linePx * 0.5, h - linePx * 0.5);
    }

    function updateMax() {
      const V = els.viewport.clientHeight;
      if (V <= 0) return;

      if (!els.trackTrailer) {
        state.max = Math.max(0, els.track.scrollHeight - V);
      } else {
        els.trackTrailer.style.height = '0px';
        void els.track.offsetHeight;

        const focusY = getReadingLineViewportY();
        let desiredMax = getScriptAnchorYInTrack() - focusY;
        if (!Number.isFinite(desiredMax)) desiredMax = 0;
        desiredMax = Math.max(0, desiredMax);

        let mechanicalMax = Math.max(0, els.track.scrollHeight - V);
        for (let i = 0; i < 16 && mechanicalMax + 1 < desiredMax; i++) {
          const gap = desiredMax - mechanicalMax;
          const prev = parseFloat(els.trackTrailer.style.height) || 0;
          els.trackTrailer.style.height = prev + Math.max(16, Math.ceil(gap + 4)) + 'px';
          void els.track.offsetHeight;
          mechanicalMax = Math.max(0, els.track.scrollHeight - V);
        }

        state.max = Math.max(0, Math.min(desiredMax, mechanicalMax));
      }

      if (state.pos > state.max) {
        state.pos = state.max;
        applyTransform();
      }
      updateProgress();
    }

    function snapScrollToEnd() {
      updateMax();
      state.pos = state.max;
      applyTransform();
      updateProgress();
    }

    function applyTransform() {
      const y = -state.pos;
      els.track.style.transform = 'translate3d(0,' + y + 'px,0)';
    }

    function setPos(p, syncUi) {
      state.pos = Math.max(0, Math.min(state.max, p));
      applyTransform();
      if (syncUi !== false) updateProgress();
    }

    function updateProgress() {
      const pct = state.max > 0 ? (state.pos / state.max) * 100 : 0;
      els.progFill.style.width = Math.min(100, pct) + '%';
      els.progBar.setAttribute('aria-valuenow', String(Math.round(pct)));
      els.elapsed.textContent = fmtTime(state.elapsedMs / 1000);
    }

    function setPlayUi(playing) {
      const path = playing
        ? 'M7 5h4v14H7V5zm6 0h4v14h-4V5z'
        : 'M8 5v14l11-7z';
      els.btnPlay.querySelector('path').setAttribute('d', path);
      els.btnPlay.setAttribute('aria-pressed', String(playing));
      els.btnPlay.setAttribute('aria-label', playing ? 'Durdur' : 'Oynat');
      els.stage.classList.toggle('playing', playing);
      els.statusDot.className = 'status-dot' + (playing ? ' running' : state.pos > 2 ? ' paused-at' : '');
    }

    function cancelCountdown() {
      state.countdownTimeouts.forEach((id) => clearTimeout(id));
      state.countdownTimeouts = [];
      if (!state.countdown) return;
      state.countdown = false;
      els.countdown.classList.remove('on');
      els.countdown.setAttribute('aria-hidden', 'true');
    }

    function syncText() {
      const v = els.taD.value;
      els.script.textContent = v;
      const words = v.trim() ? v.trim().split(/\s+/).length : 0;
      const stat = words + ' kl · ' + v.length + ' kr';
      els.statsD.textContent = stat;
      els.statsM.textContent = stat;
      const wpm = wpmFromSpeed(state.speed);
      const estSec = wpm > 0 ? Math.round((words / wpm) * 60) : 0;
      const est = fmtTime(estSec);
      els.estD.textContent = est;
      scheduleSave();
      requestAnimationFrame(updateMax);
    }

    function bindTextareas() {
      els.taD.addEventListener('input', () => {
        els.taM.value = els.taD.value;
        syncText();
      });
      els.taM.addEventListener('input', () => {
        els.taD.value = els.taM.value;
        syncText();
      });
    }

    function pause() {
      state.playing = false;
      if (state.loopRaf) cancelAnimationFrame(state.loopRaf);
      state.loopRaf = null;
      state.lastTs = 0;
      setPlayUi(false);
    }

    function tick(ts) {
      if (!state.playing) return;
      if (!state.lastTs) state.lastTs = ts;
      let dt = ts - state.lastTs;
      state.lastTs = ts;
      if (dt > 64) dt = 64;
      if (document.hidden) {
        state.lastTs = 0;
        state.loopRaf = requestAnimationFrame(tick);
        return;
      }
      state.elapsedMs += dt;
      const fs = parseFloat(getComputedStyle(els.script).fontSize) || 24;
      const pxPerSec = (state.speed / 100) * fs * 2.65;
      const delta = (pxPerSec * dt) / 1000;
      if (state.speed <= 0) {
        pause();
        toast('Hız 0 — kaydırma durdu');
        return;
      }
      if (state.max <= 1e-6) {
        state.pos = 0;
        applyTransform();
        updateProgress();
        pause();
        return;
      }
      const next = state.pos + delta;
      if (next >= state.max) {
        snapScrollToEnd();
        if (state.loop) {
          state.pos = 0;
          state.elapsedMs = 0;
          applyTransform();
          updateProgress();
          state.lastTs = 0;
        } else {
          pause();
          toast('Metin sona erdi');
          return;
        }
      } else {
        state.pos = next;
        applyTransform();
        updateProgress();
      }
      state.loopRaf = requestAnimationFrame(tick);
    }

    /** Oynatta zaten sona gidildiyse (pozisyon max’ta): tekrar oynatmada hemen "sona erdi". */
    const PLAY_END_EPS = 1;

    function startScroll() {
      if (state.speed <= 0) {
        toast('Hız 0 — kaydırma başlamaz');
        return;
      }
      updateMax();

      if (state.max <= 1e-6) {
        toast('Kaydırılacak metin bulunmadı — birkaç kelime yazın.');
        return;
      }

      const atEndNonLoop =
        !state.loop && state.pos >= state.max - PLAY_END_EPS;
      if (atEndNonLoop) {
        state.pos = 0;
        state.elapsedMs = 0;
        applyTransform();
        updateProgress();
      }

      state.playing = true;
      state.lastTs = 0;
      setPlayUi(true);
      state.loopRaf = requestAnimationFrame(tick);
    }

    function runCountdown() {
      if (prefersReduceMotion()) {
        startScroll();
        return;
      }
      cancelCountdown();
      state.countdown = true;
      els.countdown.classList.add('on');
      els.countdown.setAttribute('aria-hidden', 'false');
      let n = 3;
      els.cdNum.textContent = String(n);
      const step = () => {
        if (!state.countdown) return;
        n--;
        if (n <= 0) {
          els.countdown.classList.remove('on');
          els.countdown.setAttribute('aria-hidden', 'true');
          state.countdown = false;
          startScroll();
        } else {
          els.cdNum.textContent = String(n);
          state.countdownTimeouts.push(setTimeout(step, 900));
        }
      };
      state.countdownTimeouts.push(setTimeout(step, 900));
    }

    function togglePlay() {
      if (state.countdown) {
        cancelCountdown();
        return;
      }
      if (state.playing) {
        pause();
        return;
      }
      if (state.countdownEnabled && state.pos < 1) runCountdown();
      else startScroll();
    }

    function resetPlay() {
      cancelCountdown();
      pause();
      state.pos = 0;
      state.elapsedMs = 0;
      applyTransform();
      updateProgress();
    }

    function seekClientX(clientX) {
      const r = els.progBar.getBoundingClientRect();
      const w = r.width || 1;
      const t = Math.max(0, Math.min(1, (clientX - r.left) / w));
      setPos(t * state.max);
    }

    function applyFocusChrome() {
      const h = Math.max(56, Math.min(260, state.bandHeightPx));
      const th = Math.max(1, Math.min(12, state.lineThicknessPx));
      document.documentElement.style.setProperty('--band-h', 'clamp(52px, ' + h + 'px, 280px)');
      document.documentElement.style.setProperty('--rl-line-h', th + 'px');
      document.documentElement.style.setProperty('--band-fill-op', String(state.bandFillOpacity));
      requestAnimationFrame(updateMax);
    }

    function applyFillGlow() {
      const active = state.camOn && state.camLayout === 'fill';
      const g = Math.max(0, Math.min(1, state.fillTextGlow));
      if (active && g > 0.04) {
        const spread = Math.round(6 + g * 28);
        const a = Math.min(0.82, 0.2 + g * 0.55);
        els.script.style.textShadow = '0 0.06em .12em rgba(0,0,0,' + Math.min(.95, a + .15) + '), 0 .12em ' + spread + 'px rgba(0,0,0,' + a + ')';
      } else {
        els.script.style.textShadow = 'none';
      }
    }

    function syncCamPanelsFromState() {
      const layouts = '[data-cam-layout]';
      const keys = ['pip-size', 'pip-op', 'fill-vid-op', 'fill-scrim', 'fill-glow'];
      [els.settingsRoot, els.settingsMobile, els.camMobile].forEach((panel) => {
        if (!panel) return;
        const box = panel.querySelector('.js-cam-settings');
        if (!box) return;
        box.querySelectorAll(layouts).forEach((b) => {
          const on = b.dataset.camLayout === state.camLayout;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        const pipOpts = box.querySelector('.cam-pip-opts');
        const fillOpts = box.querySelector('.cam-fill-opts');
        if (pipOpts) pipOpts.hidden = state.camLayout === 'fill';
        if (fillOpts) fillOpts.hidden = state.camLayout !== 'fill';
        keys.forEach((k) => {
          const inp = box.querySelector('[data-k="' + k + '"]');
          const lab = box.querySelector('[data-v="' + k + '"]');
          if (!inp) return;
          if (k === 'pip-size') {
            inp.value = String(Math.round(state.pipSizePct));
            if (lab) lab.textContent = Math.round(state.pipSizePct) + '%';
          } else if (k === 'pip-op') {
            inp.value = String(Math.round(state.pipOpacity * 100));
            if (lab) lab.textContent = Math.round(state.pipOpacity * 100) + '%';
          } else if (k === 'fill-vid-op') {
            inp.value = String(Math.round(state.fillCamOpacity * 100));
            if (lab) lab.textContent = Math.round(state.fillCamOpacity * 100) + '%';
          } else if (k === 'fill-scrim') {
            inp.value = String(Math.round(state.fillScrimOpacity * 100));
            if (lab) lab.textContent = Math.round(state.fillScrimOpacity * 100) + '%';
          } else if (k === 'fill-glow') {
            inp.value = String(Math.round(state.fillTextGlow * 100));
            if (lab) lab.textContent = Math.round(state.fillTextGlow * 100) + '%';
          }
        });
        box.querySelectorAll('[data-pip-pos]').forEach((b) => {
          b.classList.toggle('on', b.dataset.pipPos === state.pipCorner);
        });
        box.querySelectorAll('[data-facing]').forEach((b) => {
          const on = b.dataset.facing === state.facing;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        });
      });
    }

    function updateCamFlipHeadUi() {
      const tip = state.facing === 'user' ? 'Arka kameraya geç' : 'Ön (selfie) kameraya geç';
      const shortNext = state.facing === 'user' ? 'Arkaya geç' : 'Öne geç';
      const show = state.camOn;
      if (els.btnFlipHead) {
        els.btnFlipHead.hidden = !show;
        const lbl = els.btnFlipHead.querySelector('.flip-lbl');
        if (lbl) lbl.textContent = shortNext;
        els.btnFlipHead.title = tip;
        els.btnFlipHead.setAttribute('aria-label', tip);
      }
      if (els.mobFlipFab) {
        els.mobFlipFab.hidden = !show;
        const cap = els.mobFlipFab.querySelector('.fab-cap');
        if (cap) cap.textContent = shortNext;
        els.mobFlipFab.title = tip;
        els.mobFlipFab.setAttribute('aria-label', tip);
      }
    }

    function setCamLayout(layout) {
      state.camLayout = layout === 'fill' ? 'fill' : 'pip';
      syncCamPanelsFromState();
      applyCamVisuals();
      scheduleSave();
    }

    function applyCamVisuals() {
      const fillActive = state.camOn && state.camLayout === 'fill';
      els.pip.classList.toggle('pip-off', !state.camOn || fillActive);
      els.stage.style.setProperty('--pip-ui-op', String(state.pipOpacity));
      els.pip.style.width = state.pipSizePct + '%';
      els.camVideoBackdrop.style.opacity = String(state.fillCamOpacity);
      els.camScrim.style.opacity = fillActive ? String(state.fillScrimOpacity) : '0';
      els.camBackdrop.style.visibility = fillActive ? 'visible' : 'hidden';
      els.camBackdrop.classList.toggle('on', fillActive);
      els.camScrim.classList.toggle('on', fillActive && state.fillScrimOpacity > 0.02);
      els.stage.classList.toggle('cam-fill-behind', fillActive);
      applyFillGlow();
      placePip(state.pipCorner);
    }

    function onDelegatedCamChange(ev) {
      const inp = ev.target;
      if (!(inp instanceof HTMLInputElement)) return;
      if (!inp.closest('.js-cam-settings') || !inp.dataset.k) return;
      const k = inp.dataset.k;
      const v = parseFloat(inp.value);
      if (k === 'pip-size') {
        state.pipSizePct = Math.max(15, Math.min(48, Math.round(v)));
      } else if (k === 'pip-op') {
        state.pipOpacity = Math.max(0.2, Math.min(1, v / 100));
      } else if (k === 'fill-vid-op') {
        state.fillCamOpacity = Math.max(0.08, Math.min(1, v / 100));
      } else if (k === 'fill-scrim') {
        state.fillScrimOpacity = Math.max(0, Math.min(0.94, v / 100));
      } else if (k === 'fill-glow') {
        state.fillTextGlow = Math.max(0, Math.min(1, v / 100));
      } else return;
      syncCamPanelsFromState();
      applyCamVisuals();
      scheduleSave();
    }

    function onDelegatedCamClick(ev) {
      const ly = ev.target.closest('[data-cam-layout]');
      if (ly && ly.closest('.js-cam-settings')) {
        ev.preventDefault();
        setCamLayout(ly.dataset.camLayout);
        return;
      }
      const pos = ev.target.closest('[data-pip-pos]');
      if (pos && pos.closest('.js-cam-settings')) {
        state.pipCorner = pos.dataset.pipPos;
        [els.settingsRoot, els.settingsMobile, els.camMobile].forEach((panel) => {
          if (!panel) return;
          const bx = panel.querySelector('.js-cam-settings');
          if (!bx) return;
          bx.querySelectorAll('[data-pip-pos]').forEach((b) =>
            b.classList.toggle('on', b.dataset.pipPos === state.pipCorner),
          );
        });
        placePip(state.pipCorner);
        scheduleSave();
        return;
      }
      const faceBtn = ev.target.closest('[data-facing]');
      if (faceBtn && faceBtn.closest('.js-cam-settings')) {
        ev.preventDefault();
        void switchCameraFacing(faceBtn.dataset.facing);
      }
    }

    function wireCamDelegation() {
      [els.settingsRoot, els.settingsMobile, els.camMobile].forEach((par) => {
        if (!par || par.dataset.camWire) return;
        par.dataset.camWire = '1';
        par.addEventListener('input', onDelegatedCamChange);
        par.addEventListener('click', onDelegatedCamClick);
      });
    }

    function buildSettings(html) {
      els.settingsRoot.innerHTML = html;
      els.settingsMobile.innerHTML = html;
    }

    function initSettingsUi() {
      const html = `
        <div class="field">
          <label>Oynatma</label>
          <div class="row" style="margin-bottom:8px">
            <span class="meta">Geri sayım</span>
            <button type="button" class="chip on" data-action="toggle-cd" aria-pressed="true">Açık</button>
          </div>
          <div class="row">
            <span class="meta">Döngü</span>
            <button type="button" class="chip" data-action="toggle-loop" aria-pressed="false">Kapalı</button>
          </div>
        </div>
        <div class="field">
          <label>Tipografi</label>
          <div class="row" style="margin-bottom:8px"><span>Yazı boyutu</span>
            <div class="range-wrap"><input type="range" data-k="font" min="0.65" max="1.65" step="0.02" value="1" /></div>
            <span class="val" data-v="font">100%</span>
          </div>
          <div class="row"><span>Satır aralığı</span>
            <div class="range-wrap"><input type="range" data-k="lh" min="1.1" max="2.4" step="0.02" value="1.52" /></div>
            <span class="val" data-v="lh">1.52</span>
          </div>
          <div class="field" style="margin-top:10px"><span class="meta">Hiza</span>
            <div class="chip-group" style="margin-top:8px">
              <button type="button" class="chip on" data-align="left">Sol</button>
              <button type="button" class="chip" data-align="center">Orta</button>
              <button type="button" class="chip" data-align="right">Sağ</button>
            </div>
          </div>
          <label style="margin-top:10px;display:block;font-size:.72rem;font-weight:700;letter-spacing:.08em;color:var(--muted)">Yazı tipi</label>
          <select data-k="face" style="margin-top:6px">
            <option value="fr">Fraunces (okuma)</option>
            <option value="dm">DM Sans</option>
            <option value="mono">JetBrains Mono</option>
          </select>
        </div>
        <div class="field">
          <label>Odak çizgisi ve bölge</label>
          <div class="chip-group">
            <button type="button" class="chip" data-band="top">Üstte</button>
            <button type="button" class="chip on" data-band="mid">Ortada</button>
            <button type="button" class="chip" data-band="bot">Altta</button>
          </div>
          <div class="row" style="margin-top:10px"><span>Bölge yüksekliği</span>
            <div class="range-wrap"><input type="range" data-k="band-hpx" min="72" max="240" step="4" value="140" /></div>
            <span class="val" data-v="band-hpx">140px</span>
          </div>
          <div class="row"><span>Çizgi kalınlığı</span>
            <div class="range-wrap"><input type="range" data-k="line-th" min="1" max="8" step="0.5" value="2" /></div>
            <span class="val" data-v="line-th">2px</span>
          </div>
          <div class="row"><span>Bölge dolgu opaklığı</span>
            <div class="range-wrap"><input type="range" data-k="band-op" min="20" max="100" step="2" value="92" /></div>
            <span class="val" data-v="band-op">92%</span>
          </div>
          <div class="row"><span>Kenar bulanıklığı</span>
            <div class="range-wrap"><input type="range" data-k="blur" min="0" max="18" step="0.5" value="8" /></div>
            <span class="val" data-v="blur">8px</span>
          </div>
          <div class="row"><span>Vinyet</span>
            <div class="range-wrap"><input type="range" data-k="vig" min="0" max="100" value="88" /></div>
            <span class="val" data-v="vig">88%</span>
          </div>
        </div>
        <div class="field js-cam-settings">
          <label>Kamera görünümü</label>
          <p class="meta" style="line-height:1.5;margin:-2px 0 10px">Tam ekran: kamera tüm sahneyi doldurur; şerit ve metin kenarı ile yazı üstte kalır. PiP: küçük önizleme.</p>
          <span class="meta" style="display:block;margin-bottom:6px;text-transform:none;letter-spacing:0;font-weight:600;color:var(--text)">Kamera yönü</span>
          <div class="chip-group" style="margin-bottom:12px;width:100%">
            <button type="button" class="chip on" data-facing="user" aria-pressed="true" title="Selfie kamerası">Ön</button>
            <button type="button" class="chip" data-facing="environment" aria-pressed="false" title="Ana arka kamera">Arka</button>
          </div>
          <div class="chip-group" style="margin-bottom:12px">
            <button type="button" class="chip on" data-cam-layout="pip">Küçük (PiP)</button>
            <button type="button" class="chip" data-cam-layout="fill">Tam ekran arkada</button>
          </div>
          <div class="cam-pip-opts">
            <div class="row"><span>PiP genişliği</span>
              <div class="range-wrap"><input type="range" data-k="pip-size" min="15" max="48" step="1" value="26" /></div>
              <span class="val" data-v="pip-size">26%</span>
            </div>
            <div class="row"><span>PiP saydamlığı</span>
              <div class="range-wrap"><input type="range" data-k="pip-op" min="25" max="100" step="2" value="100" /></div>
              <span class="val" data-v="pip-op">100%</span>
            </div>
            <span class="meta" style="display:block;margin-top:10px;margin-bottom:6px">Konum</span>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:4px">
              <button type="button" class="chip small-chip" title="Sol üst" data-pip-pos="tl">↖</button>
              <button type="button" class="chip small-chip" title="Üst orta" data-pip-pos="tc">↑</button>
              <button type="button" class="chip small-chip" title="Sağ üst" data-pip-pos="tr">↗</button>
              <button type="button" class="chip small-chip" title="Sol orta" data-pip-pos="ml">←</button>
              <button type="button" class="chip small-chip" title="Merkez" data-pip-pos="cc">◎</button>
              <button type="button" class="chip small-chip" title="Sağ orta" data-pip-pos="mr">→</button>
              <button type="button" class="chip small-chip" title="Sol alt" data-pip-pos="bl">↙</button>
              <button type="button" class="chip small-chip" title="Alt orta" data-pip-pos="bc">↓</button>
              <button type="button" class="chip small-chip" title="Sağ alt" data-pip-pos="br">↘</button>
            </div>
          </div>
          <div class="cam-fill-opts" hidden>
            <div class="row"><span>Görüntü saydamlığı</span>
              <div class="range-wrap"><input type="range" data-k="fill-vid-op" min="15" max="100" step="2" value="45" /></div>
              <span class="val" data-v="fill-vid-op">45%</span>
            </div>
            <div class="row"><span>Koyu şerit (okuma)</span>
              <div class="range-wrap"><input type="range" data-k="fill-scrim" min="0" max="92" step="2" value="38" /></div>
              <span class="val" data-v="fill-scrim">38%</span>
            </div>
            <div class="row"><span>Metin gölgesi</span>
              <div class="range-wrap"><input type="range" data-k="fill-glow" min="0" max="100" step="5" value="42" /></div>
              <span class="val" data-v="fill-glow">42%</span>
            </div>
          </div>
        </div>
        <div class="field">
          <label>Ayna</label>
          <div class="chip-group">
            <button type="button" class="chip on" data-mirror="off">Kapalı</button>
            <button type="button" class="chip" data-mirror="h">Yatay</button>
            <button type="button" class="chip" data-mirror="v">Dikey</button>
            <button type="button" class="chip" data-mirror="hv">Çapraz</button>
          </div>
        </div>
        <div class="field">
          <label>Tema</label>
          <div class="theme-dots" role="radiogroup" aria-label="Renk teması">
            <button type="button" class="theme-dot td-def" data-theme="def" aria-checked="true" title="Varsayılan"></button>
            <button type="button" class="theme-dot td-amber" data-theme="amber" aria-checked="false" title="Amber"></button>
            <button type="button" class="theme-dot td-studio" data-theme="studio" aria-checked="false" title="Yüksek kontrast"></button>
            <button type="button" class="theme-dot td-light" data-theme="light" aria-checked="false" title="Açık"></button>
            <button type="button" class="theme-dot td-green" data-theme="green" aria-checked="false" title="Yeşil"></button>
            <button type="button" class="theme-dot td-blue" data-theme="blue" aria-checked="false" title="Mavi"></button>
          </div>
        </div>
        <div class="field">
          <label>Süre</label>
          <div class="meta js-est">0:00 tahmini</div>
        </div>
        <div class="field">
          <label>Kısayollar</label>
          <div class="meta" style="line-height:1.6">Boşluk: oynat · Ok ↑↓: hız · R: sıfırla · F: tam ekran · C: kamera aç/kapa · V: ön ↔ arka kamera</div>
        </div>`;
      buildSettings(html);
      wireSettingsPanels(els.settingsRoot);
      wireSettingsPanels(els.settingsMobile);
      wireCamDelegation();
    }

    function wireSettingsPanels(root) {
      root.querySelector('[data-action="toggle-cd"]').addEventListener('click', (e) => {
        state.countdownEnabled = !state.countdownEnabled;
        e.currentTarget.setAttribute('aria-pressed', String(state.countdownEnabled));
        e.currentTarget.textContent = state.countdownEnabled ? 'Açık' : 'Kapalı';
        e.currentTarget.classList.toggle('on', state.countdownEnabled);
        mirrorChip(root, e.currentTarget);
        scheduleSave();
      });
      root.querySelector('[data-action="toggle-loop"]').addEventListener('click', (e) => {
        state.loop = !state.loop;
        e.currentTarget.setAttribute('aria-pressed', String(state.loop));
        e.currentTarget.textContent = state.loop ? 'Açık' : 'Kapalı';
        e.currentTarget.classList.toggle('on', state.loop);
        mirrorChip(root, e.currentTarget);
        scheduleSave();
      });

      const fontR = root.querySelector('[data-k="font"]');
      const lhR = root.querySelector('[data-k="lh"]');
      const blurR = root.querySelector('[data-k="blur"]');
      const vigR = root.querySelector('[data-k="vig"]');
      const face = root.querySelector('[data-k="face"]');

      const bindRange = (input, fmt, apply) => {
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          root.querySelector('[data-v="' + input.dataset.k + '"]').textContent = fmt(v);
          apply(v);
          syncParallelRange(input);
          scheduleSave();
        });
      };

      bindRange(fontR, (v) => Math.round(v * 100) + '%', (v) => {
        state.fontScale = v;
        document.documentElement.style.setProperty('--fz', 'calc(' + v + ' * clamp(22px, 2.35vw + 14px, 52px))');
        updateMax();
      });
      bindRange(lhR, (v) => v.toFixed(2), (v) => {
        state.lineHeight = v;
        els.script.style.lineHeight = String(v);
        updateMax();
      });
      bindRange(blurR, (v) => v + 'px', (v) => {
        state.blurPx = v;
        document.documentElement.style.setProperty('--blur', v + 'px');
      });
      bindRange(vigR, (v) => Math.round(v) + '%', (v) => {
        state.vignette = v / 100;
        els.vignette.style.opacity = String(v / 100);
      });

      const bandHpx = root.querySelector('[data-k="band-hpx"]');
      const lineTh = root.querySelector('[data-k="line-th"]');
      const bandOp = root.querySelector('[data-k="band-op"]');
      if (bandHpx) {
        bindRange(bandHpx, (v) => Math.round(v) + 'px', (v) => {
          state.bandHeightPx = v;
          applyFocusChrome();
        });
      }
      if (lineTh) {
        bindRange(lineTh, (v) => (Math.round(v * 2) / 2).toFixed(1).replace(/\.0$/, '') + 'px', (v) => {
          state.lineThicknessPx = v;
          applyFocusChrome();
        });
      }
      if (bandOp) {
        bindRange(bandOp, (v) => Math.round(v) + '%', (v) => {
          state.bandFillOpacity = Math.max(0.06, Math.min(1, v / 100));
          applyFocusChrome();
        });
      }

      face.addEventListener('change', () => {
        const map = { fr: '"Fraunces",Georgia,serif', dm: '"DM Sans",system-ui,sans-serif', mono: '"JetBrains Mono",monospace' };
        els.script.style.fontFamily = map[face.value] || map.fr;
        syncParallelSelect(face);
        scheduleSave();
      });

      root.querySelectorAll('[data-align]').forEach((b) => {
        b.addEventListener('click', () => {
          root.querySelectorAll('[data-align]').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          els.script.style.textAlign = b.dataset.align;
          mirrorAlign(root, b.dataset.align);
          scheduleSave();
        });
      });

      root.querySelectorAll('[data-band]').forEach((b) => {
        b.addEventListener('click', () => {
          setBand(b.dataset.band, root);
          scheduleSave();
        });
      });

      root.querySelectorAll('[data-mirror]').forEach((b) => {
        b.addEventListener('click', () => setMirror(b.dataset.mirror, root));
      });

      root.querySelectorAll('[data-theme]').forEach((b) => {
        b.addEventListener('click', () => setTheme(b.dataset.theme, root));
      });
    }

    function mirrorChip(root, el) {
      const action = el.getAttribute('data-action');
      const panels = [els.settingsRoot, els.settingsMobile];
      panels.forEach((p) => {
        if (p === root) return;
        const o = p.querySelector('[data-action="' + action + '"]');
        if (!o) return;
        o.setAttribute('aria-pressed', el.getAttribute('aria-pressed'));
        o.textContent = el.textContent;
        o.classList.toggle('on', el.classList.contains('on'));
      });
    }

    function mirrorAlign(root, al) {
      [els.settingsRoot, els.settingsMobile].forEach((p) => {
        if (p === root) return;
        p.querySelectorAll('[data-align]').forEach((x) => x.classList.toggle('on', x.dataset.align === al));
      });
    }

    function syncParallelRange(input) {
      const k = input.dataset.k;
      const v = input.value;
      [els.settingsRoot, els.settingsMobile].forEach((p) => {
        const o = p.querySelector('[data-k="' + k + '"]');
        if (o && o !== input) {
          o.value = v;
          const lab = p.querySelector('[data-v="' + k + '"]');
          if (lab) {
            if (k === 'font') lab.textContent = Math.round(parseFloat(v) * 100) + '%';
            else if (k === 'lh') lab.textContent = parseFloat(v).toFixed(2);
            else if (k === 'blur') lab.textContent = parseFloat(v) + 'px';
            else if (k === 'vig') lab.textContent = Math.round(parseFloat(v)) + '%';
            else if (k === 'band-hpx') lab.textContent = Math.round(parseFloat(v)) + 'px';
            else if (k === 'line-th') {
              const nv = Math.round(parseFloat(v) * 2) / 2;
              lab.textContent = (nv % 1 ? nv.toFixed(1) : nv) + 'px';
            }
            else if (k === 'band-op') lab.textContent = Math.round(parseFloat(v)) + '%';
          }
        }
      });
    }

    function syncParallelSelect(sel) {
      const v = sel.value;
      [els.settingsRoot, els.settingsMobile].forEach((p) => {
        const o = p.querySelector('[data-k="face"]');
        if (o && o !== sel) o.value = v;
      });
    }

    function setBand(pos, root) {
      state.bandPos = pos;
      const map = { top: [0.35, 2.2], mid: [1, 1], bot: [2.2, 0.35] };
      const g = map[pos] || map.mid;
      els.rlTop.style.flexGrow = String(g[0]);
      els.rlBot.style.flexGrow = String(g[1]);
      [els.settingsRoot, els.settingsMobile].forEach((p) => {
        p.querySelectorAll('[data-band]').forEach((b) => b.classList.toggle('on', b.dataset.band === pos));
      });
      requestAnimationFrame(updateMax);
    }

    function setMirror(m, root) {
      state.mirror = m;
      els.stage.classList.remove('mirror-h', 'mirror-v', 'mirror-hv');
      if (m === 'h') els.stage.classList.add('mirror-h');
      else if (m === 'v') els.stage.classList.add('mirror-v');
      else if (m === 'hv') els.stage.classList.add('mirror-hv');
      [els.settingsRoot, els.settingsMobile].forEach((p) => {
        p.querySelectorAll('[data-mirror]').forEach((b) => b.classList.toggle('on', b.dataset.mirror === m));
      });
      scheduleSave();
    }

    function setTheme(t, root) {
      state.theme = t;
      els.body.className = els.body.className.replace(/\btheme-\w+/g, '').trim();
      if (t !== 'def') els.body.classList.add('theme-' + (t === 'studio' ? 'studio' : t === 'light' ? 'light' : t));
      [els.settingsRoot, els.settingsMobile].forEach((p) => {
        p.querySelectorAll('[data-theme]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.theme === t)));
      });
      scheduleSave();
    }

    function updateWpmLabel() {
      const w = wpmFromSpeed(state.speed);
      els.speedVal.textContent = String(Math.round(state.speed));
      els.wpmEst.textContent = w ? '~' + w + ' wpm' : '—';
      $$('.js-est').forEach((estEl) => {
        const words = els.taD.value.trim() ? els.taD.value.trim().split(/\s+/).length : 0;
        const sec = w > 0 ? Math.round((words / w) * 60) : 0;
        estEl.textContent = fmtTime(sec) + ' tahmini';
      });
    }

    function openSheet(name) {
      const sh = els.sheets[name];
      if (!sh) return;
      els.sheetBackdrop.hidden = false;
      requestAnimationFrame(() => els.sheetBackdrop.classList.add('open'));
      sh.classList.add('open');
      sh.setAttribute('aria-hidden', 'false');
      $$('.mobile-bar button').forEach((b) => b.setAttribute('data-active', String(b.dataset.sheet === name)));
    }

    function closeSheets() {
      els.sheetBackdrop.classList.remove('open');
      setTimeout(() => { els.sheetBackdrop.hidden = true; }, 220);
      Object.values(els.sheets).forEach((sh) => {
        sh.classList.remove('open');
        sh.setAttribute('aria-hidden', 'true');
      });
      $$('.mobile-bar button').forEach((b) => b.removeAttribute('data-active'));
    }

    function applyTab(mode) {
      const ed = mode === 'editor';
      els.tabEditor.setAttribute('aria-selected', String(ed));
      els.tabPrompter.setAttribute('aria-selected', String(!ed));
      if (window.matchMedia('(max-width:820px)').matches) {
        if (ed) openSheet('editor');
        else closeSheets();
      } else {
        els.panelEditor.hidden = !ed;
        els.panelSettings.hidden = false;
      }
      requestAnimationFrame(() => {
        updateMax();
        updateDockMetrics();
      });
    }

    async function toggleCam() {
      if (state.camOpenBusy) return;
      if (state.camOn) return stopCam();
      const token = ++state.camOpenToken;
      state.camOpenBusy = true;
      els.pip.hidden = false;
      els.camBackdrop.style.visibility = 'hidden';
      els.pipPh.style.display = 'flex';
      els.pipVideo.style.display = 'none';
      els.camVideoBackdrop.style.display = 'block';
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: state.audioOn,
        });
        if (token !== state.camOpenToken) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        state.stream = s;
        state.camOn = true;
        els.pipVideo.srcObject = s;
        els.camVideoBackdrop.srcObject = s;
        await Promise.all([
          els.pipVideo.play().catch(() => {}),
          els.camVideoBackdrop.play().catch(() => {}),
        ]);
        if (token !== state.camOpenToken) {
          s.getTracks().forEach((t) => t.stop());
          state.stream = null;
          state.camOn = false;
          return;
        }
        els.pipPh.style.display = 'none';
        els.pipVideo.style.display = 'block';
        els.btnCamTop.setAttribute('aria-pressed', 'true');
        els.btnRecTop.hidden = false;
        syncCamPanelsFromState();
        applyCamVisuals();
        updateCamFlipHeadUi();
        toast('Kamera hazır');
      } catch (e) {
        if (token === state.camOpenToken) {
          els.pip.hidden = true;
          els.camVideoBackdrop.srcObject = null;
          state.camOn = false;
          updateCamFlipHeadUi();
          toast('Kamera izni gerekli');
        }
      } finally {
        if (token === state.camOpenToken) {
          state.camOpenBusy = false;
          buildCamPanel();
          scheduleSave();
        }
      }
    }

    function stopCam() {
      state.camOpenToken++;
      state.camOpenBusy = false;
      if (state.recOn) stopRec();
      if (state.stream) {
        state.stream.getTracks().forEach((t) => t.stop());
        state.stream = null;
      }
      els.pipVideo.srcObject = null;
      els.camVideoBackdrop.srcObject = null;
      state.camOn = false;
      els.pip.hidden = true;
      els.btnCamTop.setAttribute('aria-pressed', 'false');
      els.btnRecTop.hidden = true;
      updateCamFlipHeadUi();
      applyCamVisuals();
      buildCamPanel();
      scheduleSave();
    }

    function buildCamPanel() {
      const html =
        `
        <div class="field">
          <button type="button" class="btn primary" style="width:100%;margin-bottom:8px" data-cam-toggle>Kamerayı ${state.camOn ? 'kapat' : 'aç'}</button>
          <button type="button" class="btn danger-soft" style="width:100%;margin-bottom:16px;display:${state.camOn ? 'flex' : 'none'}" data-rec-toggle>${state.recOn ? 'Kaydı durdur' : 'Kayıt başlat'}</button>
          <button type="button" class="chip${state.audioOn ? ' on' : ''}" style="width:100%;margin-bottom:4px" data-audio>${state.audioOn ? 'Kayıtta ses açık' : 'Kayıtta ses kapalı'}</button>
          <p class="meta" style="line-height:1.45;margin:8px 0 0;font-size:.7rem">Ön/arka seçimi aşağıdaki &quot;Kamera görünümü&quot; bloğundadır.</p>
        </div>
        `;
      els.camMobile.innerHTML = html;
      const srcBlk = $('.js-cam-settings', els.settingsRoot);
      if (srcBlk) els.camMobile.appendChild(srcBlk.cloneNode(true));
      els.camMobile.querySelector('[data-cam-toggle]').addEventListener('click', () => toggleCam());
      const recBtn = els.camMobile.querySelector('[data-rec-toggle]');
      if (recBtn) recBtn.addEventListener('click', () => toggleRec());
      els.camMobile.querySelector('[data-audio]').addEventListener('click', (e) => {
        const wantAudio = !state.audioOn;
        state.audioOn = wantAudio;
        e.currentTarget.textContent = state.audioOn ? 'Kayıtta ses açık' : 'Kayıtta ses kapalı';
        e.currentTarget.classList.toggle('on', state.audioOn);
        if (state.stream) {
          const tracks = state.stream.getAudioTracks();
          if (tracks.length) {
            tracks.forEach((t) => (t.enabled = state.audioOn));
          } else if (state.audioOn && state.camOn) {
            toast('Ses için kamera yeniden açılıyor…');
            void refreshCamStream();
          }
        }
        scheduleSave();
      });
      syncCamPanelsFromState();
    }

    function placePip(corner) {
      const pad = 12;
      const p = els.pip.style;
      p.top = p.bottom = p.left = p.right = 'auto';
      p.margin = '';
      p.transform = '';
      switch (corner) {
        case 'tl':
          p.top = pad + 'px';
          p.left = pad + 'px';
          break;
        case 'tr':
          p.top = pad + 'px';
          p.right = pad + 'px';
          break;
        case 'bl':
          p.bottom = pad + 'px';
          p.left = pad + 'px';
          break;
        case 'br':
          p.bottom = pad + 'px';
          p.right = pad + 'px';
          break;
        case 'tc':
          p.top = pad + 'px';
          p.left = '50%';
          p.transform = 'translateX(-50%)';
          break;
        case 'bc':
          p.bottom = pad + 'px';
          p.left = '50%';
          p.transform = 'translateX(-50%)';
          break;
        case 'ml':
          p.top = '50%';
          p.left = pad + 'px';
          p.marginTop = ''; // Safari
          p.transform = 'translateY(-50%)';
          break;
        case 'mr':
          p.top = '50%';
          p.right = pad + 'px';
          p.transform = 'translateY(-50%)';
          break;
        case 'cc':
        default:
          p.top = '50%';
          p.left = '50%';
          p.transform = 'translate(-50%,-50%)';
          break;
      }
    }

    async function refreshCamStream() {
      if (!state.camOn || state.camSwitchBusy || state.camOpenBusy) return;
      state.camSwitchBusy = true;
      const wasRec = state.recOn;
      try {
        if (wasRec) await waitRecorderSilentlyDetached();
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: state.audioOn,
        });
        if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
        state.stream = s;
        els.pipVideo.srcObject = s;
        els.camVideoBackdrop.srcObject = s;
        await Promise.all([
          els.pipVideo.play().catch(() => {}),
          els.camVideoBackdrop.play().catch(() => {}),
        ]);
        if (wasRec) startRec();
      } catch (_) {
        toast('Kamera akışı yenilenemedi');
        if (wasRec && state.stream) startRec();
      } finally {
        state.camSwitchBusy = false;
        buildCamPanel();
      }
    }

    /**
     * MediaRecorder.stop asenkron: hemen ardından getUserMedia (özellikle mobil)
     * bazen yarış yapıyor. Kamera çevirmeden önce kaydı sessiz bitirip inactive bekliyoruz.
     */
    function waitRecorderSilentlyDetached() {
      state.recOn = false;
      els.btnRecTop.setAttribute('aria-pressed', 'false');
      const rec = state.recorder;
      if (!rec || rec.state === 'inactive') {
        state.recorder = null;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const finish = () => {
          state.recorder = null;
          resolve();
        };
        try {
          rec.ondataavailable = null;
          rec.onstop = finish;
          rec.stop();
        } catch (_) {
          finish();
        }
      });
    }

    async function switchCameraFacing(nextFacing) {
      if (nextFacing !== 'user' && nextFacing !== 'environment') return;
      if (state.facing === nextFacing) return;
      if (state.camSwitchBusy) {
        toast('Kamera geçişi sürüyor…');
        return;
      }
      const prevFacing = state.facing;
      state.facing = nextFacing;
      syncCamPanelsFromState();
      scheduleSave();
      if (!state.camOn) {
        updateCamFlipHeadUi();
        return;
      }
      state.camSwitchBusy = true;
      const resumeRecording = state.recOn;
      try {
        if (resumeRecording) {
          toast('Kayıt yeni kamerayla yeniden başlıyor');
          await waitRecorderSilentlyDetached();
        }
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: state.audioOn,
        });
        if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
        state.stream = s;
        els.pipVideo.srcObject = s;
        els.camVideoBackdrop.srcObject = s;
        await Promise.all([
          els.pipVideo.play().catch(() => {}),
          els.camVideoBackdrop.play().catch(() => {}),
        ]);
        const camLabel = state.facing === 'user' ? 'Ön kamera' : 'Arka kamera';
        if (resumeRecording) startRec();
        toast(resumeRecording && state.recOn ? camLabel + ' — kayıt sürüyor' : camLabel);
      } catch (e) {
        state.facing = prevFacing;
        syncCamPanelsFromState();
        scheduleSave();
        toast('Bu kamera seçilemedi veya izin yok');
        if (resumeRecording && state.stream && state.camOn) startRec();
      } finally {
        state.camSwitchBusy = false;
        syncCamPanelsFromState();
        buildCamPanel();
        updateCamFlipHeadUi();
      }
    }

    async function flipCam() {
      return switchCameraFacing(state.facing === 'user' ? 'environment' : 'user');
    }

    function toggleRec() {
      state.recOn ? stopRec() : startRec();
    }

    function startRec() {
      if (!state.stream || !window.MediaRecorder) {
        toast('Kayıt desteklenmiyor');
        return;
      }
      state.chunks = [];
      state.recordBlob = null;
      const types = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
      let mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      try {
        state.recorder = new MediaRecorder(state.stream, mime ? { mimeType: mime } : undefined);
      } catch (e) {
        toast('Kayıt başlatılamadı');
        return;
      }
      state.recorder.ondataavailable = (e) => {
        if (e.data.size) state.chunks.push(e.data);
      };
      state.recorder.onstop = () => {
        state.recordBlob = new Blob(state.chunks, { type: mime || 'video/webm' });
        downloadBlob(state.recordBlob);
        toast('Kayıt indirildi');
      };
      state.recorder.start(200);
      state.recOn = true;
      els.btnRecTop.setAttribute('aria-pressed', 'true');
      syncCamPanelsFromState();
      buildCamPanel();
    }

    function stopRec() {
      if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
      state.recOn = false;
      els.btnRecTop.setAttribute('aria-pressed', 'false');
      buildCamPanel();
    }

    function downloadBlob(blob) {
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = 'flowprompter-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.webm';
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
    }

    function syncFullscreenUi() {
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      els.btnFs.setAttribute('aria-pressed', String(fs));
      if (els.fsExit) els.fsExit.hidden = !fs;
      document.documentElement.classList.toggle('is-fullscreen', fs);
    }

    function goFullscreen() {
      const el = document.documentElement;
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fs) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) {
          Promise.resolve(req.call(el)).catch(() => toast('Tam ekran desteklenmiyor'));
        } else toast('Tam ekran desteklenmiyor');
      } else {
        const ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) ex.call(document);
      }
    }

    function updateDockMetrics() {
      let h = 0;
      if (els.transport) h += els.transport.offsetHeight || 0;
      if (els.mobileBar && getComputedStyle(els.mobileBar).display !== 'none')
        h += els.mobileBar.offsetHeight || 0;
      document.documentElement.style.setProperty('--dock-h', Math.max(72, h) + 'px');
    }

    function scheduleSave() {
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(savePrefs, 350);
    }

    function savePrefs() {
      try {
        const dFace = els.settingsRoot.querySelector('[data-k="face"]');
        const payload = {
          text: els.taD.value,
          speed: state.speed,
          theme: state.theme,
          mirror: state.mirror,
          band: state.bandPos,
          countdown: state.countdownEnabled,
          loop: state.loop,
          font: state.fontScale,
          lh: state.lineHeight,
          blur: state.blurPx,
          vig: state.vignette,
          align: els.script.style.textAlign || 'left',
          face: dFace ? dFace.value : 'fr',
          pip: state.pipCorner,
          facing: state.facing,
          audio: state.audioOn,
          camLayout: state.camLayout,
          pipSizePct: state.pipSizePct,
          pipOpacity: state.pipOpacity,
          fillCamOpacity: state.fillCamOpacity,
          fillScrimOpacity: state.fillScrimOpacity,
          fillTextGlow: state.fillTextGlow,
          bandHeightPx: state.bandHeightPx,
          lineThicknessPx: state.lineThicknessPx,
          bandFillOpacity: state.bandFillOpacity,
        };
        localStorage.setItem(LS_KEY, JSON.stringify(payload));
      } catch (e) {}
    }

    function syncPlaybackToggles() {
      [els.settingsRoot, els.settingsMobile].forEach((p) => {
        const cd = p.querySelector('[data-action="toggle-cd"]');
        if (cd) {
          cd.setAttribute('aria-pressed', String(state.countdownEnabled));
          cd.textContent = state.countdownEnabled ? 'Açık' : 'Kapalı';
          cd.classList.toggle('on', state.countdownEnabled);
        }
        const lp = p.querySelector('[data-action="toggle-loop"]');
        if (lp) {
          lp.setAttribute('aria-pressed', String(state.loop));
          lp.textContent = state.loop ? 'Açık' : 'Kapalı';
          lp.classList.toggle('on', state.loop);
        }
      });
    }

    function loadPrefs() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const p = JSON.parse(raw);
        if (p.text) {
          els.taD.value = p.text;
          els.taM.value = p.text;
        }
        if (p.speed != null) {
          state.speed = +p.speed;
          els.speed.value = String(state.speed);
        }
        if (p.theme) setTheme(p.theme, els.settingsRoot);
        if (p.mirror) setMirror(p.mirror, els.settingsRoot);
        if (p.band) setBand(p.band, els.settingsRoot);
        if (typeof p.countdown === 'boolean') state.countdownEnabled = p.countdown;
        if (typeof p.loop === 'boolean') state.loop = p.loop;
        if (p.font != null) {
          state.fontScale = +p.font;
          const r = els.settingsRoot.querySelector('[data-k="font"]');
          if (r) {
            r.value = String(p.font);
            document.documentElement.style.setProperty('--fz', 'calc(' + p.font + ' * clamp(22px, 2.35vw + 14px, 52px))');
          }
        }
        if (p.lh != null) {
          state.lineHeight = +p.lh;
          els.script.style.lineHeight = String(p.lh);
          const r = els.settingsRoot.querySelector('[data-k="lh"]');
          if (r) r.value = String(p.lh);
        }
        if (p.blur != null) {
          state.blurPx = +p.blur;
          document.documentElement.style.setProperty('--blur', p.blur + 'px');
          const r = els.settingsRoot.querySelector('[data-k="blur"]');
          if (r) r.value = String(p.blur);
        }
        if (p.vig != null) {
          const frac = p.vig > 1 ? p.vig / 100 : p.vig;
          state.vignette = frac;
          els.vignette.style.opacity = String(frac);
          const r = els.settingsRoot.querySelector('[data-k="vig"]');
          if (r) r.value = String(Math.round(frac * 100));
        }
        if (p.align) {
          els.script.style.textAlign = p.align;
          [els.settingsRoot, els.settingsMobile].forEach((root) => {
            root.querySelectorAll('[data-align]').forEach((x) => x.classList.toggle('on', x.dataset.align === p.align));
          });
        }
        if (p.face) {
          const map = { fr: '"Fraunces",Georgia,serif', dm: '"DM Sans",system-ui,sans-serif', mono: '"JetBrains Mono",monospace' };
          [els.settingsRoot, els.settingsMobile].forEach((root) => {
            const s = root.querySelector('[data-k="face"]');
            if (s) s.value = p.face;
          });
          els.script.style.fontFamily = map[p.face] || map.fr;
        }
        if (p.pip) state.pipCorner = p.pip;
        if (p.facing) state.facing = p.facing;
        if (p.audio === false) state.audioOn = false;
        if (p.camLayout === 'fill' || p.camLayout === 'pip') state.camLayout = p.camLayout;
        if (p.pipSizePct != null) state.pipSizePct = Math.max(15, Math.min(48, +p.pipSizePct));
        if (p.pipOpacity != null) state.pipOpacity = Math.max(0.15, Math.min(1, +p.pipOpacity));
        if (p.fillCamOpacity != null) state.fillCamOpacity = Math.max(0.05, Math.min(1, +p.fillCamOpacity));
        if (p.fillScrimOpacity != null) state.fillScrimOpacity = Math.max(0, Math.min(0.96, +p.fillScrimOpacity));
        if (p.fillTextGlow != null) state.fillTextGlow = Math.max(0, Math.min(1, +p.fillTextGlow));
        if (p.bandHeightPx != null) state.bandHeightPx = Math.max(56, Math.min(280, +p.bandHeightPx));
        if (p.lineThicknessPx != null) state.lineThicknessPx = Math.max(1, Math.min(12, +p.lineThicknessPx));
        if (p.bandFillOpacity != null) state.bandFillOpacity = Math.max(0.05, Math.min(1, +p.bandFillOpacity));
        const _setR = (k, val) => {
          const r = els.settingsRoot.querySelector('[data-k="' + k + '"]');
          if (r && val != null) r.value = String(val);
        };
        _setR('band-hpx', Math.round(state.bandHeightPx));
        _setR('line-th', state.lineThicknessPx);
        _setR('band-op', Math.round(state.bandFillOpacity * 100));
        syncPlaybackToggles();
        applyFocusChrome();
        syncCamPanelsFromState();
        applyCamVisuals();
        updateCamFlipHeadUi();
      } catch (e) {}
    }

    function bindGlobal() {
      els.btnPlay.addEventListener('click', togglePlay);
      els.btnReset.addEventListener('click', resetPlay);
      els.btnCamTop.addEventListener('click', toggleCam);
      els.btnRecTop.addEventListener('click', toggleRec);
      if (els.btnFlipHead)
        els.btnFlipHead.addEventListener('click', () => void flipCam());
      if (els.mobFlipFab)
        els.mobFlipFab.addEventListener('click', () => void flipCam());
      els.btnFs.addEventListener('click', goFullscreen);
      if (els.fsExit) els.fsExit.addEventListener('click', goFullscreen);

      els.speed.addEventListener('input', () => {
        state.speed = +els.speed.value;
        updateWpmLabel();
        scheduleSave();
        if (state.playing && state.speed <= 0) {
          pause();
          toast('Hız 0 — kaydırma durdu');
        }
      });

      let progPointer = false;
      els.progBar.addEventListener('pointerdown', (e) => {
        progPointer = true;
        els.progBar.setPointerCapture(e.pointerId);
        seekClientX(e.clientX);
      });
      els.progBar.addEventListener('pointermove', (e) => {
        if (progPointer) seekClientX(e.clientX);
      });
      els.progBar.addEventListener('pointerup', (e) => {
        progPointer = false;
        try { els.progBar.releasePointerCapture(e.pointerId); } catch (x) {}
      });
      els.progBar.addEventListener('pointercancel', () => {
        progPointer = false;
      });
      els.progBar.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const step = state.max * 0.02;
          setPos(state.pos + (e.key === 'ArrowRight' ? step : -step));
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (Object.values(els.sheets).some((sh) => sh.classList.contains('open'))) {
            closeSheets();
            return;
          }
          const fs = document.fullscreenElement || document.webkitFullscreenElement;
          if (fs) goFullscreen();
        }
        if (e.target.closest('textarea') || e.target.closest('input')) return;
        if (e.code === 'Space') {
          e.preventDefault();
          togglePlay();
        } else if (e.code === 'ArrowUp') {
          e.preventDefault();
          state.speed = Math.min(100, state.speed + 5);
          els.speed.value = String(state.speed);
          updateWpmLabel();
          scheduleSave();
        } else if (e.code === 'ArrowDown') {
          e.preventDefault();
          state.speed = Math.max(0, state.speed - 5);
          els.speed.value = String(state.speed);
          updateWpmLabel();
          scheduleSave();
        } else if (e.code === 'KeyV' && state.camOn) {
          e.preventDefault();
          void flipCam();
        } else if (e.code === 'KeyR') resetPlay();
        else if (e.code === 'KeyF') goFullscreen();
        else if (e.code === 'KeyC') toggleCam();
      });

      window.addEventListener('resize', () => {
        requestAnimationFrame(updateMax);
        updateDockMetrics();
      });
      document.addEventListener('fullscreenchange', syncFullscreenUi);
      document.addEventListener('webkitfullscreenchange', syncFullscreenUi);
      if (window.ResizeObserver && els.readingLayer) {
        new ResizeObserver(() => requestAnimationFrame(updateMax)).observe(els.readingLayer);
      }
      if (window.ResizeObserver) {
        new ResizeObserver(() => updateMax()).observe(els.track);
        new ResizeObserver(() => updateMax()).observe(els.viewport);
        if (els.transport) new ResizeObserver(() => updateDockMetrics()).observe(els.transport);
        if (els.mobileBar) new ResizeObserver(() => updateDockMetrics()).observe(els.mobileBar);
      }

      els.sheetBackdrop.addEventListener('click', closeSheets);
      $$('[data-close-sheet]').forEach((b) => b.addEventListener('click', closeSheets));

      els.mobileBar.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-sheet]');
        if (!btn) return;
        if (btn.dataset.sheet === 'cam') {
          buildCamPanel();
          openSheet('cam');
        } else openSheet(btn.dataset.sheet);
      });

      els.tabEditor.addEventListener('click', () => applyTab('editor'));
      els.tabPrompter.addEventListener('click', () => applyTab('prompter'));

      /* Manual scroll drag on stage while paused */
      els.stage.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.pip')) return;
        if (e.target.closest('.cam-switch-fab')) return;
        if (state.playing || state.countdown) return;
        state.manualDrag = true;
        state.dragStartY = e.clientY;
        state.dragStartPos = state.pos;
        els.stage.setPointerCapture(e.pointerId);
      });
      els.stage.addEventListener('pointermove', (e) => {
        if (!state.manualDrag) return;
        const dy = e.clientY - state.dragStartY;
        setPos(state.dragStartPos - dy);
      });
      els.stage.addEventListener('pointerup', endDrag);
      els.stage.addEventListener('pointercancel', endDrag);

      /* Pinch resize font */
      let pinchDist = null;
      els.stage.addEventListener(
        'touchstart',
        (e) => {
          if (e.touches.length === 2)
            pinchDist = Math.hypot(
              e.touches[1].clientX - e.touches[0].clientX,
              e.touches[1].clientY - e.touches[0].clientY,
            );
        },
        { passive: true },
      );
      els.stage.addEventListener(
        'touchmove',
        (e) => {
          if (e.touches.length !== 2 || pinchDist == null) return;
          const d = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
          const ratio = d / pinchDist;
          if (Math.abs(ratio - 1) < 0.03) return;
          const base = els.settingsRoot.querySelector('[data-k="font"]');
          if (!base) return;
          let nv = parseFloat(base.value) * ratio;
          nv = Math.max(0.65, Math.min(1.65, Math.round(nv * 100) / 100));
          const sv = String(nv);
          $$('#settings-root [data-k="font"], #settings-mobile [data-k="font"]').forEach((sl) => {
            sl.value = sv;
            sl.dispatchEvent(new Event('input', { bubbles: true }));
          });
          pinchDist = d;
        },
        { passive: true },
      );
      els.stage.addEventListener('touchend', () => { pinchDist = null; }, { passive: true });
    }

    function endDrag(e) {
      state.manualDrag = false;
      try {
        if (e && e.pointerId != null) els.stage.releasePointerCapture(e.pointerId);
      } catch (x) {}
    }

    function syncParallelAfterLoad() {
      [els.settingsRoot, els.settingsMobile].forEach((p) => {
        const face = els.settingsRoot.querySelector('[data-k="face"]');
        const fm = p.querySelector('[data-k="face"]');
        if (face && fm && fm !== face) fm.value = face.value;
        ['font', 'lh', 'blur', 'vig', 'band-hpx', 'line-th', 'band-op'].forEach((k) => {
          const a = els.settingsRoot.querySelector('[data-k="' + k + '"]');
          const b = p.querySelector('[data-k="' + k + '"]');
          if (a && b && a !== b) {
            b.value = a.value;
            b.dispatchEvent(new Event('input'));
          }
        });
      });
    }

    if (prefersReduceMotion()) els.body.classList.add('reduce-motion');

    initSettingsUi();
    bindTextareas();
    bindGlobal();
    loadPrefs();
    syncParallelAfterLoad();
    syncText();
    updateWpmLabel();
    updateDockMetrics();
    syncFullscreenUi();
    requestAnimationFrame(updateMax);
    applyFocusChrome();
    syncCamPanelsFromState();
    applyCamVisuals();
    updateCamFlipHeadUi();
    buildCamPanel();
    applyTab(window.matchMedia('(max-width:820px)').matches ? 'prompter' : 'editor');
  })();
