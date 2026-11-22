// content.js — decides whether to zoom and applies it.
(() => {
  'use strict';
  if (window.__ytuwLoaded) return;
  window.__ytuwLoaded = true;

  const D = globalThis.YTUWDetector;

  const DEFAULTS = {
    enabled: true,
    fullscreenOnly: true,
    minRatio: 1.9,     // content at least this wide (after removing bars) gets zoomed
    blackLevel: 24,    // 0-255; pixels at or below this brightness count as black
    maxCrop: 3,        // % of picture we may crop to remove thin leftover borders
    showToasts: true,
  };
  const TICK_MS = 500;
  const MIN_BARS = 0.03;          // ignore bars totalling < 3% of the frame height
  const MODES = ['auto', 'fill', 'off'];
  const MODE_LABEL = {
    auto: 'Ultrawide: Auto (zoom wide content only)',
    fill: 'Ultrawide: Force fill (may crop)',
    off: 'Ultrawide: Off for this video',
  };

  let settings = { ...DEFAULTS };
  let mode = 'auto';              // per video; Z cycles it
  let video = null;
  let player = null;
  let lastSrc = '';
  let lastTime = -1;
  let adShowing = false;
  let applied = 1;                // scale currently applied
  let lastInfo = {};

  const sampler = new D.FrameSampler();
  const tracker = new D.BarTracker({ windowSize: 8, minSamples: 4 });

  // ---------- settings / popup messaging ----------
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
  if (hasChrome) {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      settings = { ...DEFAULTS, ...s };
      tick();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k in changes) settings[k] = changes[k].newValue;
      update();
    });
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg && msg.type === 'ytuw-status' && (video || window.top === window)) reply(status());
    });
  }

  // ---------- applying the zoom ----------
  // We use our own <style> element (instead of the video's style attribute,
  // which YouTube rewrites constantly).
  const BASE_CSS =
    '.html5-video-player video.html5-main-video{' +
    'transition:transform .35s ease !important;transform-origin:50% 50% !important}';
  const styleEl = document.createElement('style');
  styleEl.id = 'ytuw-style';
  styleEl.textContent = BASE_CSS;

  function ensureStyle() {
    if (!styleEl.isConnected) (document.head || document.documentElement).appendChild(styleEl);
  }

  /** @returns {boolean} true when the applied scale changed */
  function setScale(s) {
    if (!(s > 1.005)) s = 1;
    const diff = Math.abs(s - applied) / applied;
    // Zooming further in from an existing zoom needs a 1% change (avoids jitter);
    // zooming out reacts to small changes so real picture is never hidden for long.
    const needed = s > applied && applied > 1 ? 0.01 : 0.003;
    if (diff < needed) return false;
    applied = s;
    ensureStyle();
    styleEl.textContent = BASE_CSS + (s === 1 ? '' :
      '.html5-video-player{overflow:hidden !important}' +
      `.html5-video-player video.html5-main-video{transform:scale(${s.toFixed(4)}) !important}`);
    return true;
  }

  // ---------- helpers ----------
  function findVideo() {
    return document.querySelector('.html5-video-player video.html5-main-video') ||
           document.querySelector('.html5-video-player video');
  }

  function isFullscreen() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    return !!(fs && video && fs.contains(video));
  }

  function resetVideoState() {
    tracker.reset();
    sampler.blocked = false;
    lastTime = -1;
    mode = 'auto';
  }

  // ---------- decision ----------
  function computeTarget() {
    const out = { scale: 1, reason: '', videoRatio: 0, bar: null, contentRatio: 0, fullscreen: false };
    if (!video || !player) { out.reason = 'No video'; return out; }
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { out.reason = 'Loading'; return out; }

    const av = vw / vh;
    const est = tracker.estimate();
    const bar = est ? est.bar : 0;          // per side, fraction of frame height
    out.videoRatio = av;
    out.bar = est ? bar : null;
    out.overlay = !!(est && est.overlay);
    out.contentRatio = av / (1 - 2 * bar);
    out.fullscreen = isFullscreen();

    if (!settings.enabled) { out.reason = 'Disabled in popup'; return out; }
    if (mode === 'off') { out.reason = 'Off for this video (Z)'; return out; }
    if (adShowing) { out.reason = 'Ad playing'; return out; }
    if (location.pathname.startsWith('/shorts')) { out.reason = 'Shorts'; return out; }
    if (settings.fullscreenOnly && !out.fullscreen) { out.reason = 'Not fullscreen'; return out; }

    const PW = player.clientWidth, PH = player.clientHeight;
    if (!PW || !PH) { out.reason = 'Player hidden'; return out; }

    // Where the picture sits inside the player (YouTube letter/pillar-boxes it).
    let pw, ph;
    if (PW / PH > av) { ph = PH; pw = PH * av; } else { pw = PW; ph = PW / av; }
    const usedBar = 2 * bar < MIN_BARS ? 0 : bar;   // tiny "bars" are just edge noise
    const cw = pw, ch = ph * (1 - 2 * usedBar);     // the real content, without baked-in bars
    const fit = Math.min(PW / cw, PH / ch);         // biggest zoom showing all content
    const fill = Math.max(PW / cw, PH / ch);        // zoom that leaves no border at all

    if (mode === 'fill') {
      out.scale = fill;
      out.reason = 'Force fill (Z)';
      return out;
    }
    if (sampler.blocked) { out.reason = 'Frames unreadable (DRM?)'; return out; }
    if (!est) { out.reason = 'Analysing…'; return out; }

    out.contentRatio = av / (1 - 2 * usedBar);
    if (out.contentRatio < settings.minRatio) {
      out.reason = usedBar ? 'Content not wide, keeping borders' : 'No baked-in bars, keeping borders';
      return out;
    }

    // Content is wide. If filling the screen costs only a sliver of the
    // picture (content shape close to the screen's), fill; otherwise fit.
    const crop = 1 - fit / fill;
    if (crop <= settings.maxCrop / 100) {
      out.scale = fill;
      out.reason = crop > 0.002 ? `Filled screen (cropping ${(crop * 100).toFixed(1)}%)` : 'Zoomed to fill';
    } else {
      out.scale = fit;
      out.reason = fit > 1.005 ? 'Zoomed to fit wide content' : 'Already fits, keeping thin borders';
    }
    return out;
  }

  function update() {
    const prev = applied;
    lastInfo = computeTarget();
    const changed = setScale(lastInfo.scale);
    if (changed && prev === 1 && applied > 1 && mode === 'auto' && lastInfo.fullscreen) {
      toast(`Wide content ${lastInfo.contentRatio.toFixed(2)}:1 → zoom ${applied.toFixed(2)}×`);
    }
  }

  // ---------- main loop ----------
  function tick() {
    const v = findVideo();
    if (v !== video) { video = v; resetVideoState(); }
    if (!video) { player = null; setScale(1); return; }
    player = video.closest('.html5-video-player');

    const src = video.currentSrc || video.src || '';
    if (src !== lastSrc) { lastSrc = src; resetVideoState(); }

    const ad = !!(player && player.classList.contains('ad-showing'));
    if (ad !== adShowing) { adShowing = ad; tracker.reset(); lastTime = -1; }

    if (settings.enabled && !ad && !document.hidden &&
        video.readyState >= 2 && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      tracker.push(sampler.measure(video, settings.blackLevel));
    }
    update();
  }

  setInterval(tick, TICK_MS);
  const onLayoutChange = () => { tick(); setTimeout(tick, 250); setTimeout(tick, 800); };
  document.addEventListener('fullscreenchange', onLayoutChange);
  document.addEventListener('webkitfullscreenchange', onLayoutChange);
  window.addEventListener('resize', () => update());

  // ---------- Z hotkey ----------
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'z' && e.key !== 'Z') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!video) return;
    e.stopPropagation();
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    update();
    toast(MODE_LABEL[mode], true);
  }, true);

  // ---------- on-screen message ----------
  let toastEl = null, toastTimer = 0;
  function toast(text, force) {
    if ((!settings.showToasts && !force) || !player) return;
    if (!toastEl || !player.contains(toastEl)) {
      toastEl = document.createElement('div');
      toastEl.style.cssText =
        'position:absolute;top:28px;left:50%;transform:translateX(-50%);z-index:9999;' +
        'padding:8px 14px;border-radius:6px;background:rgba(0,0,0,.75);color:#fff;' +
        'font:500 15px/1.3 Roboto,Arial,sans-serif;pointer-events:none;' +
        'transition:opacity .3s;opacity:0;white-space:nowrap';
      player.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 2200);
  }

  function status() {
    return {
      ...lastInfo,
      mode,
      applied,
      samples: tracker.count,
      blocked: sampler.blocked,
      settings,
    };
  }

  tick();
})();
