/**
 * The cover of a hardcover or paperback in numbers: its measurements from the parameters, its
 * cross-section at any depth below the outer surface, and the developed wrap with its fold and
 * groove positions.
 *
 * Coordinate frame (see CONVENTIONS in core/types/model.ts): millimeters, the book stands upright on
 * y = 0, centered on x/z, FRONT cover faces +Z. The SPINE is on the left when looking at the front
 * (-X side), the fore-edge on the right (+X).
 *
 * The cross-section is a horizontal one (XZ plane) of the cover: a smooth polyline running from the
 * BACK fore-edge, round the spine, to the FRONT fore-edge (hinge grooves, rounded or flat spine). It
 * is built twice – once on the outer surface (offset 0) and once on the inner surface (offset
 * -board thickness) with an identical node structure, so the board edges (top / bottom) are simple
 * strips between the two.
 */
import type { ParamValues } from '../../core/types/model';
import { clamp } from '../../core/math';
import { bool, num, str } from '../params';
import { Profile } from './profile';

const PI = Math.PI;

export type BookKind = 'hard' | 'soft';

export const BOOK_DEFAULTS: Record<BookKind, { w: number; h: number; t: number }> = {
  hard: { w: 150, h: 230, t: 25 },
  soft: { w: 130, h: 200, t: 18 },
};

/** Paperback cover board thickness (300 g/m² card + laminate). */
const SOFT_COVER = 0.3;
/** Rounded spine: the corner arcs turn by this angle, the spine arc covers 180° - 2·ALPHA. */
const ROUND_ALPHA = (55 * PI) / 180;

const CSEG = 8; // corner arc segments (even – the spine fold sits on the middle node)
const GSEG = 6; // groove arc segments (even)
const SSEG = 20; // rounded spine arc segments

interface Groove {
  /** x of the groove's spine-side shoulder start. */
  x2: number;
  /** Radius of the three arcs and the half-angle they turn by. */
  R: number;
  th: number;
}

export interface BookGeom {
  kind: BookKind;
  /** Page block width (spine -> fore-edge at the shoulders), height and thickness. */
  W: number;
  H: number;
  P: number;
  /** Cover height and the y of the page block bottom. */
  Hc: number;
  yBlock: number;
  /** Board / cover thickness. */
  tb: number;
  gapB: number;
  gapS: number;
  /** Half thickness of the whole book (outer cover faces at z = ±Tz). */
  Tz: number;
  /** Outer spine x (leftmost) and fore-edge x of the cover. */
  xS: number;
  xF: number;
  /** Fore-edge rounding radius of the boards. */
  re: number;
  /** Spine corner radius and the x where the corner arc meets the cover face. */
  rc: number;
  cx: number;
  rounded: boolean;
  /** Rounded spine: center x / outer radius of the spine arc, radius of the page block's spine. */
  xsC: number;
  Rs: number;
  Rpb: number;
  groove: Groove | null;
}

/** Three-arc groove (convex, concave, convex) of the given width and depth. */
function grooveArcs(width: number, depth: number): { R: number; th: number } {
  const th = 2 * Math.atan((2 * depth) / width);
  return { R: width / 4 / Math.sin(th), th };
}

export function bookGeom(p: ParamValues, kind: BookKind): BookGeom {
  const hard = kind === 'hard';
  const d = BOOK_DEFAULTS[kind];
  const W = clamp(num(p, 'width', d.w), 40, 600);
  const H = clamp(num(p, 'height', d.h), 40, 800);
  const P = clamp(num(p, 'thickness', d.t), 1, 150);
  const tb = hard ? clamp(num(p, 'boardThickness', 2.5), 1, 5) : SOFT_COVER;
  const sq = hard ? clamp(num(p, 'squares', 3), 0.5, 8) : 0;
  const gapB = hard ? 0.15 : 0.04;
  const gapS = hard ? 0.6 : 0.04;
  const Tz = P / 2 + gapB + tb;
  const rc = hard ? Math.min(1.8, Tz * 0.3) : Math.min(1.0, Tz * 0.4);
  const rounded = hard && str(p, 'spine', 'rounded') === 'rounded';

  let xS: number;
  let cx: number;
  let xsC = 0;
  let Rs = 0;
  let Rpb = 0;
  if (rounded) {
    // The corner arc (radius rc, turning ROUND_ALPHA) is tangent to the cover face and to the
    // spine arc centered on z = 0; the page block's spine is concentric with the cover's spine
    // and passes through the block shoulders (0, ±P/2).
    Rs = rc + (Tz - rc) / Math.cos(ROUND_ALPHA);
    Rpb = Rs - tb - gapS;
    xsC = Math.sqrt(Math.max(Rpb * Rpb - (P * P) / 4, 0));
    xS = xsC - Rs;
    cx = xsC - (Rs - rc) * Math.sin(ROUND_ALPHA);
  } else {
    xS = -(gapS + tb);
    cx = xS + rc;
  }

  let groove: Groove | null = null;
  if (hard) {
    const ga = grooveArcs(8, Math.min(1.1, tb * 0.5));
    groove = { x2: Math.max(cx + 0.8, xS + 6), ...ga };
  } else if (bool(p, 'hingeScore', false)) {
    const ga = grooveArcs(2.4, 0.22);
    groove = { x2: Math.max(cx + 0.5, xS + 5.8), ...ga };
  }

  return {
    kind,
    W,
    H,
    P,
    Hc: H + 2 * sq,
    yBlock: sq,
    tb,
    gapB,
    gapS,
    Tz,
    xS,
    xF: W + sq,
    re: hard ? Math.min(0.6, tb * 0.3) : 0,
    rc,
    cx,
    rounded,
    xsC,
    Rs,
    Rpb,
    groove,
  };
}

interface ProfileMarks {
  /** Spine folds (middle of the spine corner arcs) on the back / front side. */
  fold0: number;
  fold1: number;
  /** Groove centers on the back / front (-1 when there is no groove). */
  gB: number;
  gF: number;
}

/**
 * Cover cross-section at offset `off` from the outer surface (0 = outer, -tb = inner), from the
 * back fore-edge (x = xF - re, z = -Tz) round the spine to the front fore-edge.
 */
export function bookProfile(g: BookGeom, off: number): { prof: Profile; marks: ProfileMarks } {
  const Z = g.Tz + off;
  const T = g.Tz;
  const pr = new Profile().start(g.xF - g.re, -Z, 0, -1);
  const marks: ProfileMarks = { fold0: 0, fold1: 0, gB: -1, gF: -1 };
  const gr = g.groove;
  const sn = gr ? Math.sin(gr.th) : 0;
  const dep = gr ? 2 * gr.R * (1 - Math.cos(gr.th)) : 0;
  const x1 = gr ? gr.x2 + 4 * gr.R * sn : 0;
  const xm = gr ? gr.x2 + 2 * gr.R * sn : 0;

  // Back hinge groove (path runs toward -X here).
  if (gr) {
    pr.arc(x1, -T + gr.R, gr.R + off, -PI / 2, -PI / 2 - gr.th, GSEG);
    marks.gB = pr.arc(xm, -T + dep - gr.R, gr.R - off, PI / 2 - gr.th, PI / 2 + gr.th, GSEG, true) + GSEG / 2;
    pr.arc(gr.x2, -T + gr.R, gr.R + off, -PI / 2 + gr.th, -PI / 2, GSEG);
  }

  // Spine.
  if (g.rounded) {
    const a = ROUND_ALPHA;
    marks.fold0 = pr.arc(g.cx, -T + g.rc, g.rc + off, -PI / 2, -PI / 2 - a, CSEG) + CSEG / 2;
    pr.arc(g.xsC, 0, g.Rs + off, -(PI / 2 + a), -((3 * PI) / 2 - a), SSEG);
    marks.fold1 = pr.arc(g.cx, T - g.rc, g.rc + off, PI / 2 + a, PI / 2, CSEG) + CSEG / 2;
  } else {
    marks.fold0 = pr.arc(g.cx, -T + g.rc, g.rc + off, -PI / 2, -PI, CSEG) + CSEG / 2;
    marks.fold1 = pr.arc(g.cx, T - g.rc, g.rc + off, PI, PI / 2, CSEG) + CSEG / 2;
  }

  // Front hinge groove (path runs toward +X).
  if (gr) {
    pr.arc(gr.x2, T - gr.R, gr.R + off, PI / 2, PI / 2 - gr.th, GSEG);
    marks.gF = pr.arc(xm, T - dep + gr.R, gr.R - off, -PI / 2 - gr.th, -PI / 2 + gr.th, GSEG, true) + GSEG / 2;
    pr.arc(x1, T - gr.R, gr.R + off, PI / 2 + gr.th, PI / 2, GSEG);
  }
  pr.lineTo(g.xF - g.re, Z);
  return { prof: pr, marks };
}

/** Lengths (mm, along the outer surface) of the wrap and its panels for the given params. */
interface WrapLayout {
  g: BookGeom;
  /** Total developed width of the cover (fore-edge to fore-edge). */
  L: number;
  /** Back | spine and spine | front fold positions from the back fore-edge. */
  s0: number;
  s1: number;
  /** Groove center positions (or -1). */
  sgB: number;
  sgF: number;
}

export function wrapLayout(p: ParamValues, kind: BookKind): WrapLayout {
  const g = bookGeom(p, kind);
  const { prof, marks } = bookProfile(g, 0);
  const n = prof.nodes;
  return {
    g,
    L: n[n.length - 1].s,
    s0: n[marks.fold0].s,
    s1: n[marks.fold1].s,
    sgB: marks.gB >= 0 ? n[marks.gB].s : -1,
    sgF: marks.gF >= 0 ? n[marks.gF].s : -1,
  };
}
