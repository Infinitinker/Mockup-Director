/**
 * Turntable animation export (GIF / animated WebP / MP4).
 *
 * Pipeline per frame (frames are streamed – only the encoded output is kept in memory):
 *  1. stage.beginAnimation() computes ONE framing that fits the union of all frames for the
 *     content box (output size minus margins); frames are rendered transparently, supersampled
 *     (up to 2×) for clean edges.
 *  2. The frame is downscaled into the output canvas over the background (painted once):
 *     transparent, the scene background, or white (MP4 has no alpha).
 *  3. The output canvas goes straight into the encoder; the event loop gets a turn after every
 *     frame so the UI (progress bar, Cancel button) stays responsive.
 * The stage is always restored (try/finally), also on errors and cancellation.
 */
import type { AnimationFormat, AnimationSettings, BackgroundSettings, StageAPI } from '../../core/types';
import { paintBackground } from '../exporter';
import { AnimationCancelled, AnimationError } from './errors';
import { GifAnimationEncoder } from './gif';
import { AnimatedWebpWriter } from './webp';
import { Mp4Writer, mp4EncodingAvailable } from './mp4';
import { frameCountOf, normaliseAnimationSettings, outputSizeOf } from './settings';
import { frameDelays, turntableAngles } from './turntable';

export { AnimationCancelled, AnimationError, isAnimationCancelled } from './errors';
export { mp4EncodingAvailable } from './mp4';
export { defaultFpsFor, frameCountOf, maxFpsFor, maxMarginFor, maxSizeFor, normaliseAnimationSettings, outputSizeOf } from './settings';
export { turntableAngles } from './turntable';

export type AnimationPhase = 'prepare' | 'palette' | 'frames' | 'finalize';

export interface AnimationProgress {
  phase: AnimationPhase;
  /** Frames done in this phase. */
  done: number;
  /** Frames in this phase. */
  total: number;
}

export interface AnimationExportOptions {
  /** Scene preview background (used for background 'scene'). */
  background: BackgroundSettings;
  /** Can the engine encode WebP stills? (supportsWebpEncoding() from ../exporter). */
  webpSupported: boolean;
  onProgress?: (p: AnimationProgress) => void;
  signal?: AbortSignal;
}

export interface AnimationResult {
  blob: Blob;
  format: AnimationFormat;
  width: number;
  height: number;
  frames: number;
}

/** Pixel budget of one supersampled render (keeps per-frame GPU readback reasonable). */
const MAX_RENDER_PIXELS = 6_000_000;
/** Global GIF palette: number of evenly spaced frames sampled before encoding. */
const PALETTE_SAMPLES = 8;

const QUALITY_WEBP: Record<AnimationSettings['quality'], number> = { low: 0.6, medium: 0.8, high: 0.92 };

/** MIME type and file extension of an animation format. */
export function animationMime(format: AnimationFormat): string {
  return format === 'mp4' ? 'video/mp4' : `image/${format}`;
}

/** Save-dialog filter for an animation format. */
export function animationFileFilter(format: AnimationFormat): { name: string; extensions: string[] } {
  const names: Record<AnimationFormat, string> = { gif: 'GIF', webp: 'WebP', mp4: 'MP4' };
  return { name: names[format], extensions: [format] };
}

/** Render and encode the turntable animation of the current stage. */
export async function exportAnimation(stage: StageAPI, raw: AnimationSettings, opts: AnimationExportOptions): Promise<AnimationResult> {
  const s = normaliseAnimationSettings(raw, { webp: opts.webpSupported, mp4: mp4EncodingAvailable() });
  if (s.format !== raw.format) {
    throw raw.format === 'webp' ? webpUnsupported() : mp4Unsupported();
  }
  if (!stage.beginAnimation) {
    throw new AnimationError('unsupported', {
      pl: 'Eksport animacji wymaga podglądu 3D (WebGL).',
      en: 'Animation export needs the 3D view (WebGL).',
    });
  }
  const signal = opts.signal;
  const checkAbort = () => {
    if (signal?.aborted) throw new AnimationCancelled();
  };
  const progress = (phase: AnimationPhase, done: number, total: number) => opts.onProgress?.({ phase, done, total });

  const { width: W, height: H } = outputSizeOf(s);
  const margin = Math.min(s.margin, Math.max(0, Math.floor((Math.min(W, H) - 2) / 2)));
  const cw = Math.max(1, W - 2 * margin);
  const ch = Math.max(1, H - 2 * margin);
  const factor = Math.max(1, Math.min(2, Math.sqrt(MAX_RENDER_PIXELS / (cw * ch))));
  const rw = Math.max(1, Math.round(cw * factor));
  const rh = Math.max(1, Math.round(ch * factor));
  const angles = turntableAngles(s);
  const n = angles.length;
  const fps = s.fps;
  progress('prepare', 0, n);

  const opaque = s.format === 'mp4';
  const wantScene = s.background === 'scene';
  const delaysCs = frameDelays(n, fps, 100);
  const delaysMs = frameDelays(n, fps, 1000);

  // Everything that allocates (canvases, the MP4 encoder) happens inside the try block, so the
  // finally clause releases it on every path – errors and cancellation included.
  let bg: HTMLCanvasElement | null = null;
  let render: HTMLCanvasElement | null = null;
  let out: HTMLCanvasElement | null = null;
  let gif: GifAnimationEncoder | null = null;
  let webp: AnimatedWebpWriter | null = null;
  let mp4: Mp4Writer | null = null;
  let session: ReturnType<NonNullable<StageAPI['beginAnimation']>> | null = null;
  let finished = false;
  try {
    checkAbort();

    // Background (painted once, reused for every frame).
    if (opaque || (wantScene && opts.background.mode !== 'transparent')) {
      bg = createCanvas(W, H);
      const g = get2d(bg);
      if (opaque) {
        // MP4 has no alpha: start from white so a (partly) transparent scene background can never
        // leave undefined pixels behind.
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, W, H);
      }
      if (wantScene) paintBackground(g, opts.background, W, H, opaque);
    }
    const transparentOut = !bg;

    // Encoder.
    if (s.format === 'gif') {
      gif = new GifAnimationEncoder({
        width: W,
        height: H,
        transparent: transparentOut,
        matte: matteFor(opts.background),
        dither: s.dither,
        palette: s.palette,
      });
    } else if (s.format === 'webp') {
      webp = new AnimatedWebpWriter(W, H);
    } else {
      try {
        mp4 = await Mp4Writer.create(W, H, fps, s.quality);
      } catch (e) {
        throw new AnimationError('mp4-unsupported', mp4UnsupportedText(), e);
      }
      if (!mp4) throw mp4Unsupported();
    }

    const renderCanvas = (render = createCanvas(rw, rh));
    const outCanvas = (out = createCanvas(W, H));
    const og = get2d(outCanvas, s.format === 'gif');
    checkAbort();
    session = stage.beginAnimation({ angles, width: rw, height: rh, useViewZoomPan: s.useViewZoomPan });
    const frame = (i: number) => {
      session!.renderFrame(i, renderCanvas);
      og.clearRect(0, 0, W, H);
      if (bg) og.drawImage(bg, 0, 0);
      og.imageSmoothingEnabled = true;
      og.imageSmoothingQuality = 'high';
      og.drawImage(renderCanvas, 0, 0, rw, rh, margin, margin, cw, ch);
    };

    // GIF with a global palette: analyse a few evenly spaced frames first.
    if (gif?.needsPaletteSamples) {
      const count = Math.min(n, PALETTE_SAMPLES);
      for (let k = 0; k < count; k++) {
        checkAbort();
        frame(Math.floor((k * n) / count));
        gif.addPaletteSample(og.getImageData(0, 0, W, H).data);
        progress('palette', k + 1, count);
        await yieldToUi();
      }
    }

    for (let i = 0; i < n; i++) {
      checkAbort();
      frame(i);
      if (gif) {
        gif.addFrame(og.getImageData(0, 0, W, H).data, delaysCs[i]);
      } else if (webp) {
        const blob = await canvasToBlob(outCanvas, 'image/webp', QUALITY_WEBP[s.quality]);
        if (blob.type && blob.type !== 'image/webp') throw webpUnsupported();
        webp.addFrame(new Uint8Array(await blob.arrayBuffer()), delaysMs[i]);
      } else if (mp4) {
        await mp4.addFrame(outCanvas);
      }
      progress('frames', i + 1, n);
      await yieldToUi();
    }
    // The 3D work is done – give the viewport back before the (possibly slower) finishing step.
    session.end();
    session = null;

    checkAbort();
    progress('finalize', 0, 1);
    await yieldToUi();
    let blob: Blob;
    if (gif) blob = gif.finish();
    else if (webp) blob = webp.finish();
    else blob = await mp4!.finish();
    finished = true;
    // Cancel pressed while the file was being finished: do not hand the file to the save dialog.
    checkAbort();
    progress('finalize', 1, 1);
    if (!blob.size) throw encodeFailed();
    return { blob, format: s.format, width: W, height: H, frames: n };
  } catch (e) {
    if (e instanceof AnimationError || e instanceof AnimationCancelled) throw e;
    if (e && typeof e === 'object' && 'text' in e) throw e; // localized stage errors
    console.error('[mockup-director] animation export failed', e);
    throw new AnimationError('encode-failed', {
      pl: `Nie udało się utworzyć animacji (${errorText(e)}).`,
      en: `Could not create the animation (${errorText(e)}).`,
    }, e);
  } finally {
    session?.end();
    if (mp4 && !finished) void mp4.cancel();
    if (render) release(render);
    if (out) release(out);
    if (bg) release(bg);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Let the browser paint and handle input (rAF while visible). When the window is hidden / minimised,
 * rAF does not fire and timers are throttled to about one per second, so a MessageChannel task is
 * used instead – the export keeps its speed in the background.
 */
function yieldToUi(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof document !== 'undefined' && document.hidden && typeof MessageChannel === 'function') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
      return;
    }
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    setTimeout(go, 34);
  });
}

/** Matte for GIF anti-aliased / semi-transparent pixels: the scene's main colour, else white. */
function matteFor(bg: BackgroundSettings): [number, number, number] {
  const m = bg.mode !== 'transparent' ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg.color) : null;
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: HTMLCanvasElement, willReadFrequently = false): CanvasRenderingContext2D {
  const g = c.getContext('2d', willReadFrequently ? { willReadFrequently: true } : undefined);
  if (!g) {
    throw new AnimationError('render-failed', {
      pl: 'Za mało pamięci na animację tej wielkości. Zmniejsz rozmiar.',
      en: 'Not enough memory for an animation this large. Reduce the size.',
    });
  }
  return g;
}

function release(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}

function canvasToBlob(c: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(encodeFailed())), mime, quality);
  });
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function encodeFailed(): AnimationError {
  return new AnimationError('encode-failed', {
    pl: 'Nie udało się zakodować animacji (za mało pamięci?).',
    en: 'Could not encode the animation (out of memory?).',
  });
}

function webpUnsupported(): AnimationError {
  return new AnimationError('webp-unsupported', {
    pl: 'Ten system nie potrafi zapisać formatu WebP. Wybierz GIF lub MP4.',
    en: 'WebP encoding is not supported on this system. Please choose GIF or MP4.',
  });
}

function mp4UnsupportedText() {
  return {
    pl: 'Ten system nie potrafi zakodować wideo H.264 (MP4) w tym rozmiarze. Wymagany jest WebView2 / Chromium lub Safari 16.4+ (macOS 13.3+). Wybierz GIF lub zmniejsz rozmiar.',
    en: 'This system cannot encode H.264 video (MP4) at this size. WebView2 / Chromium or Safari 16.4+ (macOS 13.3+) is required. Choose GIF or a smaller size.',
  };
}

function mp4Unsupported(): AnimationError {
  return new AnimationError('mp4-unsupported', mp4UnsupportedText());
}

/** Frame count shown in the UI (same rule as the exporter). */
export function estimatedFrames(s: Pick<AnimationSettings, 'fps' | 'duration'>): number {
  return frameCountOf(s);
}
