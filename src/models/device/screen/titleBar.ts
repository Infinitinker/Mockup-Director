/**
 * The browser window's generic title bar, drawn on a canvas: window buttons, back and forward, the
 * address pill with a padlock and a domain, and the menu.
 */
import type * as THREE from 'three';
import { clamp } from '../../../core/math';
import { makeCanvas, modelTexture } from '../../textures';

interface ChromePalette {
  bar: string;
  line: string;
  pill: string;
  pillLine: string;
  text: string;
  icon: string;
  body: string;
  buttonsGray: [string, string, string];
}

export const PALETTES: Record<'light' | 'dark', ChromePalette> = {
  light: {
    bar: '#ececef',
    line: '#cfd1d6',
    pill: '#ffffff',
    pillLine: '#d5d7dc',
    text: '#3b3e44',
    icon: '#7f828a',
    body: '#dcdde1',
    buttonsGray: ['#c3c5ca', '#c3c5ca', '#c3c5ca'],
  },
  dark: {
    bar: '#2c2d31',
    line: '#18191c',
    pill: '#1c1d20',
    pillLine: '#3b3c41',
    text: '#d9dadd',
    icon: '#8e9097',
    body: '#26272b',
    buttonsGray: ['#55575d', '#55575d', '#55575d'],
  },
};

/** Muted generic red / amber / green window buttons. */
const BUTTON_COLORS: [string, string, string] = ['#e5695e', '#e8b64c', '#5fbd65'];

/** Rounded-rectangle path (CanvasRenderingContext2D.roundRect needs Safari 16+). */
function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  g.lineTo(x + w, y + h - rr);
  g.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  g.lineTo(x + rr, y + h);
  g.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  g.lineTo(x, y + rr);
  g.arc(x + rr, y + rr, rr, Math.PI, (3 * Math.PI) / 2);
  g.closePath();
}

/**
 * Window chrome bar drawn on a per-build canvas (wMm × hMm area): window buttons, back/forward
 * chevrons, centered address pill with a small padlock + domain, a "more" menu and a separator.
 * Drawn upright; CanvasTexture keeps flipY = true, so v = 0 is the bottom of the drawing.
 */
export function chromeTexture(
  wMm: number,
  hMm: number,
  pal: ChromePalette,
  buttons: string,
  address: string,
): THREE.CanvasTexture {
  const wPx = 3072;
  const hPx = clamp(Math.round((wPx * hMm) / wMm), 24, 1024);
  const { canvas, g } = makeCanvas(wPx, hPx);
  if (g) {
    const u = hPx;
    const cy = hPx / 2;
    g.fillStyle = pal.bar;
    g.fillRect(0, 0, wPx, hPx);
    g.fillStyle = pal.line;
    g.fillRect(0, hPx - Math.max(2, u * 0.025), wPx, Math.max(2, u * 0.025));

    let x = u * 0.5;
    if (buttons !== 'none') {
      const cols = buttons === 'color' ? BUTTON_COLORS : pal.buttonsGray;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(x + i * u * 0.4, cy, u * 0.125, 0, Math.PI * 2);
        g.fillStyle = cols[i];
        g.fill();
      }
      x += 2 * u * 0.4 + u * 0.6;
    }

    // Back / forward chevrons.
    g.strokeStyle = pal.icon;
    g.lineWidth = Math.max(2, u * 0.055);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const ch = u * 0.13;
    for (let i = 0; i < 2; i++) {
      const dir = i === 0 ? -1 : 1;
      const px = x + i * u * 0.5;
      g.beginPath();
      g.moveTo(px - dir * ch * 0.5, cy - ch);
      g.lineTo(px + dir * ch * 0.5, cy);
      g.lineTo(px - dir * ch * 0.5, cy + ch);
      g.stroke();
    }
    x += u * 0.5 + u * 0.4;

    // "More" menu: three dots on the right.
    g.fillStyle = pal.icon;
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.arc(wPx - u * 0.6, cy + i * u * 0.13, u * 0.04, 0, Math.PI * 2);
      g.fill();
    }

    if (address !== 'none') {
      const right = wPx - u * 1.1;
      const pw = Math.min(wPx * 0.5, right - x - u * 0.3);
      if (pw > u) {
        const ph = u * 0.58;
        const pl = clamp((wPx - pw) / 2, x + u * 0.2, right - pw);
        roundRectPath(g, pl, cy - ph / 2, pw, ph, ph / 2);
        g.fillStyle = pal.pill;
        g.fill();
        g.lineWidth = Math.max(1.5, u * 0.018);
        g.strokeStyle = pal.pillLine;
        g.stroke();

        const text = address === 'empty' ? '' : address;
        if (text) {
          let fs = Math.round(u * 0.29);
          const font = (s: number) => `500 ${s}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
          g.font = font(fs);
          while (g.measureText(text).width > pw - u * 1.2 && fs > 8) {
            fs -= 1;
            g.font = font(fs);
          }
          const tw = g.measureText(text).width;
          const lockW = u * 0.16;
          const gap = u * 0.1;
          const start = pl + pw / 2 - (lockW + gap + tw) / 2;
          // Generic padlock: shackle arc + body.
          const lx = start + lockW / 2;
          g.strokeStyle = pal.icon;
          g.lineWidth = Math.max(1.5, u * 0.03);
          g.beginPath();
          g.arc(lx, cy - u * 0.03, lockW * 0.32, Math.PI, 0);
          g.stroke();
          g.fillStyle = pal.icon;
          roundRectPath(g, start, cy - u * 0.03, lockW, u * 0.13, u * 0.025);
          g.fill();
          g.fillStyle = pal.text;
          g.textAlign = 'left';
          g.textBaseline = 'middle';
          g.fillText(text, start + lockW + gap, cy + u * 0.01);
        }
      }
    }
  }
  return modelTexture(canvas);
}
