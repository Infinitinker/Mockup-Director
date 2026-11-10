/**
 * Sizing SVG artwork before it is drawn: the intrinsic size of an SVG document from its width, height or
 * viewBox, and its root tag rewritten to an exact pixel size.
 */

/**
 * Rewrite the root <svg> tag with width/height = (tw, th) px. If it has no viewBox, one is added
 * from its intrinsic size (vw, vh in user units = CSS px) so the drawing scales instead of clipping.
 */
export function sizeSvgRoot(svg: string, tw: number, th: number, vw: number, vh: number): string {
  const m = /<svg\b[^>]*>/i.exec(svg);
  if (!m) return svg;
  let tag = m[0];
  const hasViewBox = /\sviewBox\s*=/i.test(tag);
  tag = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  const selfClosing = /\/\s*>$/.test(tag);
  const head = tag.replace(/\/?\s*>$/, '');
  const extra = ` width="${tw}" height="${th}"${hasViewBox ? '' : ` viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none"`}`;
  tag = head + extra + (selfClosing ? '/>' : '>');
  return svg.slice(0, m.index) + tag + svg.slice(m.index + m[0].length);
}

/** Intrinsic size of an SVG document from width/height (absolute units) or the viewBox. */
export function svgIntrinsicSize(svg: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const toPx = (v?: string): number | null => {
    if (!v) return null;
    const m = /^\s*([\d.]+)\s*(px|pt|mm|cm|in)?\s*$/i.exec(v);
    if (!m) return null; // percentages etc. → fall back to viewBox
    const n = parseFloat(m[1]);
    const unit = (m[2] ?? 'px').toLowerCase();
    const k = unit === 'pt' ? 96 / 72 : unit === 'mm' ? 96 / 25.4 : unit === 'cm' ? 96 / 2.54 : unit === 'in' ? 96 : 1;
    return n > 0 ? n * k : null;
  };
  const w = toPx(attr('width'));
  const h = toPx(attr('height'));
  const vb = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const vbOk = vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  if (w && h) return { width: w, height: h };
  if (vbOk) {
    const ar = vb[2] / vb[3];
    if (w) return { width: w, height: w / ar };
    if (h) return { width: h * ar, height: h };
    return { width: vb[2], height: vb[3] };
  }
  return null;
}
