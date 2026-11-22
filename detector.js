// detector.js — finds black bars that are baked into the video picture.
//
// How it works:
//   1. Draw the current frame into a small canvas (256 px wide).
//   2. Walk rows from the top and from the bottom; a row is "bar" when almost
//      every pixel is near-black.
//   3. Per frame we keep min(top, bottom) as the bar size. Dark scene content
//      can only make bars look BIGGER than they really are, while logos or
//      subtitles in a bar can only make them look SMALLER. So the smallest
//      value seen over a short window of frames is a safe (never over-cropping)
//      estimate of the real bar.
(() => {
  'use strict';

  const SAMPLE_W = 256;          // analysis width in px
  const MAX_SAMPLE_H = 720;      // analysis height: the video's own rows, up to 720
  const ROW_TOLERANCE = 0.02;    // a "black" row may still have up to 2% bright pixels (noise, tiny logos)
  const EDGE_IGNORE = 0.01;      // ignore 1% at the left/right edges (encoder edge junk)
  const MAX_BAR = 0.30;          // a bar bigger than 30% per side = treat frame as "too dark to judge"
  const OVERLAY_MIN_DIFF = 0.015; // bars differing by more than 1.5% of height -> check for an overlay
  const OVERLAY_BLACK_COLS = 0.6; // ...and accept it when >= 60% of columns in the thin bar are fully black

  function luma(d, i) {
    return (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8;
  }

  /**
   * Analyse RGBA pixel data.
   * @returns {{status:'ok'|'dark', top?:number, bottom?:number, bar?:number}}
   *          top/bottom/bar are fractions of the frame height.
   */
  function analyze(data, w, h, blackLevel) {
    const maxBright = Math.max(1, Math.floor(w * ROW_TOLERANCE));
    const x0 = Math.floor(w * EDGE_IGNORE);
    const x1 = w - x0;

    const isBlackRow = (y) => {
      let bright = 0;
      const off = y * w * 4;
      for (let x = x0; x < x1; x++) {
        if (luma(data, off + x * 4) > blackLevel && ++bright > maxBright) return false;
      }
      return true;
    };

    let top = 0;
    while (top < h && isBlackRow(top)) top++;
    if (top === h) return { status: 'dark' };          // whole frame black (fade, DRM, loading)

    let bottom = 0;
    while (bottom < h && isBlackRow(h - 1 - bottom)) bottom++;

    const t = top / h, b = bottom / h;
    let bar = Math.min(t, b);
    if (bar > MAX_BAR) return { status: 'dark', top: t, bottom: b };

    // Overlay check: text or a logo printed inside one bar ("Listen on Spotify",
    // a channel watermark) makes that bar look thinner than it is. Look at the
    // thin side over the thick bar's height: if most columns there are black
    // from top to bottom, the bright bits are an overlay and the thick, clean
    // bar is the real one.
    let overlay = false;
    const big = Math.max(top, bottom), small = Math.min(top, bottom);
    if (big - small >= Math.max(2, h * OVERLAY_MIN_DIFF) && big / h <= MAX_BAR) {
      const rows = big - 1;                       // allow 1 row of normal letterbox asymmetry
      const y0 = top < bottom ? 0 : h - rows;     // the thin side holds the overlay
      if (blackColumnShare(data, w, y0, rows, x0, x1, blackLevel) >= OVERLAY_BLACK_COLS) {
        bar = rows / h;
        overlay = true;
      }
    }
    return { status: 'ok', top: t, bottom: b, bar, overlay };
  }

  /** Share of columns that are black in every row of the band [y0, y0+rows). */
  function blackColumnShare(data, w, y0, rows, x0, x1, blackLevel) {
    let black = 0;
    for (let x = x0; x < x1; x++) {
      let ok = true;
      for (let y = y0; y < y0 + rows; y++) {
        if (luma(data, (y * w + x) * 4) > blackLevel) { ok = false; break; }
      }
      if (ok) black++;
    }
    return black / (x1 - x0);
  }

  class FrameSampler {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this.blocked = false;   // true when the browser refuses to let us read frames (DRM)
    }

    measure(video, blackLevel) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return { status: 'nodata' };
      if (this.blocked) return { status: 'blocked' };

      // Narrow but tall: horizontal detail doesn't matter, vertical precision
      // decides how exactly the bar edge is found (1 row = 1/h of the height).
      const w = SAMPLE_W;
      const h = Math.max(16, Math.min(vh, MAX_SAMPLE_H));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      let data;
      try {
        this.ctx.drawImage(video, 0, 0, w, h);
        data = this.ctx.getImageData(0, 0, w, h).data;
      } catch (e) {
        this.blocked = true;
        return { status: 'blocked' };
      }
      return analyze(data, w, h, blackLevel);
    }
  }

  class BarTracker {
    constructor({ windowSize = 8, minSamples = 4 } = {}) {
      this.windowSize = windowSize;
      this.minSamples = minSamples;
      this.reset();
    }
    reset() {
      this.samples = [];
      this.last = null;
    }
    push(m) {
      this.last = m;
      if (!m || m.status !== 'ok') return;
      this.samples.push({ bar: m.bar, overlay: !!m.overlay });
      if (this.samples.length > this.windowSize) this.samples.shift();
    }
    get count() {
      return this.samples.length;
    }
    /** @returns {null | {bar:number, overlay:boolean}} bar = per-side fraction of frame height */
    estimate() {
      if (this.samples.length < this.minSamples) return null;
      let best = this.samples[0];
      for (const s of this.samples) if (s.bar < best.bar) best = s;
      return { bar: best.bar, overlay: best.overlay };
    }
  }

  globalThis.YTUWDetector = { analyze, FrameSampler, BarTracker };
})();
