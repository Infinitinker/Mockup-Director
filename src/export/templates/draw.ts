/**
 * A pen for a 2D canvas that works in millimeters: lines, rectangles, circles and text, with an optional backdrop
 * behind text.
 */

const FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Arial, sans-serif';

/** Draws on a 2D canvas at k pixels per millimeter. */
export class Draw {
  readonly g: CanvasRenderingContext2D;
  /** px per mm */
  readonly k: number;
  constructor(g: CanvasRenderingContext2D, k: number) {
    this.g = g;
    this.k = k;
  }

  /** mm → px */
  px(mm: number): number {
    return mm * this.k;
  }

  /** A line width in mm that is never thinner than 1 px. */
  lineMm(mm: number): number {
    return Math.max(mm, 1 / this.k);
  }

  stroke(color: string, widthMm: number, dashMm: readonly number[]): void {
    this.g.strokeStyle = color;
    this.g.lineWidth = Math.max(1, widthMm * this.k);
    this.g.setLineDash(dashMm.map((v) => v * this.k));
    this.g.lineCap = 'butt';
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.g.strokeRect(this.px(x), this.px(y), this.px(w), this.px(h));
  }

  circle(cx: number, cy: number, r: number): void {
    this.g.beginPath();
    this.g.arc(this.px(cx), this.px(cy), this.px(r), 0, Math.PI * 2);
    this.g.stroke();
  }

  font(sizeMm: number, weight: number): string {
    return `${weight} ${Math.max(1, sizeMm * this.k)}px ${FONT}`;
  }

  /** Text width in mm. */
  measure(text: string, sizeMm: number, weight: number): number {
    this.g.font = this.font(sizeMm, weight);
    return this.g.measureText(text).width / this.k;
  }

  /** Text at a position in mm (absolute). */
  text(
    s: string,
    xMm: number,
    yMm: number,
    sizeMm: number,
    color: string,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
    weight: number,
    backdrop = false,
  ): void {
    this.textAt(s, this.px(xMm), this.px(yMm), sizeMm, color, align, baseline, weight, backdrop);
  }

  /** Text at a position in px in the CURRENT transform (used after translate/rotate). */
  textAt(
    s: string,
    xPx: number,
    yPx: number,
    sizeMm: number,
    color: string,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
    weight: number,
    backdrop = false,
  ): void {
    const g = this.g;
    g.font = this.font(sizeMm, weight);
    g.textAlign = align;
    g.textBaseline = baseline;
    if (backdrop) {
      const w = g.measureText(s).width;
      const h = sizeMm * this.k;
      const pad = h * 0.2;
      const left = align === 'center' ? xPx - w / 2 : align === 'right' || align === 'end' ? xPx - w : xPx;
      const top =
        baseline === 'middle' ? yPx - h / 2 : baseline === 'bottom' || baseline === 'alphabetic' ? yPx - h : yPx;
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(left - pad, top - pad * 0.5, w + pad * 2, h + pad);
    }
    g.fillStyle = color;
    g.fillText(s, xPx, yPx);
  }
}
