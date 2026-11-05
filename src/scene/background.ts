/**
 * Preview background (CSS on the viewport wrapper) and the identical 2D-canvas version used for
 * non-transparent exports. The WebGL canvas itself is always transparent.
 */
import type { BackgroundSettings } from '../core/types';

const HEX = /^#[0-9a-f]{6}$/i;
const safe = (c: string, fallback: string) => (HEX.test(c) ? c : fallback);

/** Radial gradient centre (fractions of width / height) – a soft studio "spot" slightly above centre. */
const GRAD_CX = 0.5;
const GRAD_CY = 0.4;

/** Apply the background to an element (inline styles). */
export function applyCssBackground(el: HTMLElement, bg: BackgroundSettings): void {
  const s = el.style;
  s.backgroundSize = '';
  s.backgroundPosition = '';
  s.backgroundImage = '';
  s.backgroundRepeat = '';
  if (bg.mode === 'color') {
    s.backgroundColor = safe(bg.color, '#ffffff');
  } else if (bg.mode === 'gradient') {
    s.backgroundColor = safe(bg.color2, '#dddddd');
    s.backgroundImage = `radial-gradient(circle farthest-corner at ${GRAD_CX * 100}% ${GRAD_CY * 100}%, ${safe(bg.color, '#ffffff')} 0%, ${safe(bg.color2, '#dddddd')} 100%)`;
  } else {
    // Transparent: classic checkerboard (linear-gradient version – works in every WebKit).
    const c = '#d9dadd';
    s.backgroundColor = '#f5f5f6';
    s.backgroundImage = [
      `linear-gradient(45deg, ${c} 25%, transparent 25%)`,
      `linear-gradient(-45deg, ${c} 25%, transparent 25%)`,
      `linear-gradient(45deg, transparent 75%, ${c} 75%)`,
      `linear-gradient(-45deg, transparent 75%, ${c} 75%)`,
    ].join(', ');
    s.backgroundSize = '20px 20px';
    s.backgroundPosition = '0 0, 0 10px, 10px -10px, -10px 0';
  }
}

/**
 * Paint the background into a 2D context (same look as the CSS version).
 * Mode 'transparent' paints nothing.
 */
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, bg: BackgroundSettings): void {
  if (bg.mode === 'color') {
    ctx.fillStyle = safe(bg.color, '#ffffff');
    ctx.fillRect(0, 0, w, h);
  } else if (bg.mode === 'gradient') {
    // CSS "circle farthest-corner": radius = distance from the centre to the farthest corner.
    const cx = w * GRAD_CX;
    const cy = h * GRAD_CY;
    const r = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, safe(bg.color, '#ffffff'));
    g.addColorStop(1, safe(bg.color2, '#dddddd'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
