#!/usr/bin/env node
/**
 * Draws the Mockup Director app icon and writes the icon files in use: those bundle.icon in
 * src-tauri/tauri.conf.json lists (the Windows .ico, also used by the installer, the macOS .icns
 * and the PNGs for Linux), the toolbar logo src/ui/app-logo.svg and the README's docs/images/icon.png.
 *
 *   npm run icons                        regenerate them all
 *   npm run icons -- --preview FILE.png  also write a preview sheet (sizes on light and dark)
 *
 * The picture: a product box (the mockup) whose front is a director's slate - a striped band at
 * the top and a striped clapper arm lifted open. The box is a dark silhouette lit from BEHIND, so
 * only its upper edges catch the light, on a calm blue badge with a slightly darker rim so the
 * icon reads on light backgrounds too. At 32 px and less the details would blur, so those sizes
 * use a bolder box with fewer, wider stripes and a light top face.
 *
 * Two shapes:
 *  - macOS (.icns): Apple's rounded square (824 px body on a 1024 canvas). Since macOS 26 icons
 *    that are not this shape are shown on a gray plate, so the Mac icon fills the square.
 *  - everything else (.ico for Windows, PNGs): a circle, transparent outside it.
 *
 * Rendering uses @resvg/resvg-js (MPL-2.0, dev dependency only).
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT_DIR = 'src-tauri/icons';
const LOGO_SVG = 'src/ui/app-logo.svg'; // toolbar logo + favicon
const README_ICON = 'docs/images/icon.png';
const SMALL = 32; // sizes up to this one get the simple drawing

/* Palette: the app's accent blue. */
const BG_LIGHT = '#62b2ff';
const BG_MID = '#2f86f0';
const BG_DEEP = '#1a52ad';
const RING = '#123f86';
const RIM = '#e3f2ff';
const FRONT = '#16181e';
const SIDE = '#0c0d11';
const TOP = '#252832';
const STRIPE_LIGHT = '#eef3fa';
const STRIPE_DARK = '#14161c';
const SMALL_TOP = '#b8c7dc';

/** @typedef {[number, number]} Point A point on the 1024-pixel canvas, as [x, y]. */
/** @typedef {(x: number, y: number) => Point} PointAt Maps coordinates on a face to the canvas. */
/**
 * @typedef {object} BoxGeometry The proportions of the clapper box.
 * @property {Point} a The top-left corner of the front face.
 * @property {number} W The width of the front face.
 * @property {number} H The height of the front face.
 * @property {number} rise How far the top edge drops toward the right, per unit of width (y grows downward).
 * @property {number} k How far the back edges are shifted to the right.
 * @property {number} lift How far the back edges are shifted up.
 * @property {number} band The height of the striped band, as a share of H.
 * @property {number} open The angle the clapper arm is lifted open, in degrees.
 * @property {number} stripes The number of stripe pairs across the front face.
 */
/**
 * @typedef {object} IconOptions
 * @property {'round' | 'mac'} shape The outline of the icon.
 * @property {boolean} simple Whether to draw the bolder version for small sizes.
 */
/** @typedef {{ size: number, png: Buffer }} IcoEntry One image of a .ico file. */
/** @typedef {{ type: string, png: Buffer }} IcnsEntry One image of a .icns file, with its type code. */

let uid = 0;
/**
 * A unique SVG id with the given prefix.
 * @param {string} p
 */
const id = (p) => `${p}${++uid}`;
/**
 * A number with one decimal, for SVG attributes.
 * @param {number} n
 */
const f1 = (n) => n.toFixed(1);
/**
 * The points of a polygon as an SVG points attribute.
 * @param {Point[]} pts
 */
const poly = (pts) => pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ');
/**
 * A closed polygon as SVG path data.
 * @param {Point[]} pts
 */
const pathOf = (pts) => `M${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(' L')} Z`;

/**
 * The bounding box of a polygon as [minX, minY, maxX, maxY].
 * @param {Point[]} pts
 * @returns {[number, number, number, number]}
 */
function bboxOf(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * The edge of a shape that light from behind catches: an inner rim (stroke clipped to the shape)
 * fading out from the top of the shape downwards.
 * @param {Point[]} pts The outline of the shape.
 * @param {number} width The width of the rim.
 * @param {number} [opacity] The opacity of the rim.
 * @param {number} [reach] How far down the rim fades out, as a share of the shape's height.
 */
function rim(pts, width, opacity = 1, reach = 0.55) {
  const d = pathOf(pts);
  const [, y0, , y1] = bboxOf(pts);
  const clip = id('rc');
  const mask = id('rm');
  const grad = id('rg');
  return `
  <defs>
    <clipPath id="${clip}"><path d="${d}"/></clipPath>
    <linearGradient id="${grad}" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(y0)}" x2="0" y2="${f1(y0 + (y1 - y0) * reach)}">
      <stop offset="0" stop-color="#fff" stop-opacity="1"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="${mask}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect x="0" y="0" width="1024" height="1024" fill="url(#${grad})"/>
    </mask>
  </defs>
  <g clip-path="url(#${clip})" mask="url(#${mask})">
    <path d="${d}" fill="none" stroke="${RIM}" stroke-opacity="${opacity}" stroke-width="${width * 2}" stroke-linejoin="round"/>
  </g>`;
}

/** Background: a calm diagonal blue gradient with a soft glow behind the box. */
function background() {
  const lin = id('bg');
  const glow = id('glow');
  return {
    defs: `
    <linearGradient id="${lin}" gradientUnits="userSpaceOnUse" x1="150" y1="80" x2="880" y2="980">
      <stop offset="0" stop-color="${BG_LIGHT}"/>
      <stop offset="0.5" stop-color="${BG_MID}"/>
      <stop offset="1" stop-color="${BG_DEEP}"/>
    </linearGradient>
    <radialGradient id="${glow}" gradientUnits="userSpaceOnUse" cx="500" cy="470" r="430">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>`,
    /**
     * Paints the background into the given shape (a function fill -> SVG element).
     * @param {(fill: string) => string} shape
     */
    paint: (shape) => shape(`url(#${lin})`) + shape(`url(#${glow})`),
  };
}

/**
 * A product box in a three-quarter view whose front face is a director's slate: a striped band
 * along its top edge and a striped clapper arm hinged at the top-left corner, lifted open. Drawn for a
 * 1024-pixel canvas whose badge has a radius of 500.
 * @param {boolean} simple Whether to draw the bolder version for small sizes.
 */
function clapperBox(simple) {
  /** @type {BoxGeometry} */
  const g = simple
    ? { a: [214, 360], W: 352, H: 384, rise: 0.34, k: 232, lift: 92, band: 0.22, open: 34, stripes: 3.5 }
    : { a: [236, 372], W: 334, H: 384, rise: 0.34, k: 206, lift: 82, band: 0.17, open: 32, stripes: 5.5 };
  const a = g.a;
  /** @type {Point} */
  const b = [a[0] + g.W, a[1] + g.W * g.rise];
  /** @type {Point} */
  const d = [a[0], a[1] + g.H];
  /** @type {Point} */
  const c = [b[0], b[1] + g.H];
  /**
   * The point on the back of the box behind the given point on the front.
   * @param {Point} p
   * @returns {Point}
   */
  const back = (p) => [p[0] + g.k, p[1] - g.lift];
  const front = [a, b, c, d];
  const side = [b, back(b), back(c), c];
  const top = [a, back(a), back(b), b];
  const outline = [a, back(a), back(b), back(c), c, d];

  // Front-face coordinates: x along the top edge (0..W), y down the face (0..H).
  const ex = [(b[0] - a[0]) / g.W, (b[1] - a[1]) / g.W];
  const ey = [(d[0] - a[0]) / g.H, (d[1] - a[1]) / g.H];
  /** @type {PointAt} */
  const P = (x, y) => [a[0] + x * ex[0] + y * ey[0], a[1] + x * ex[1] + y * ey[1]];

  const sw = g.W / g.stripes; // stripe pitch (one light + one dark stripe)
  /**
   * The dark stripes of a band from x0 to x1, h high, in the face coordinates `at` maps.
   * @param {number} x0
   * @param {number} x1
   * @param {number} h
   * @param {PointAt} at
   */
  const stripes = (x0, x1, h, at) => {
    const skew = h * 0.95;
    let out = '';
    for (let x = x0 - sw; x < x1 + 2 * sw; x += sw) {
      out += `<polygon points="${poly([at(x, 0), at(x + sw / 2, 0), at(x + sw / 2 - skew, h), at(x - skew, h)])}" fill="${STRIPE_DARK}"/>`;
    }
    return out;
  };

  // Fixed striped band at the top of the slate.
  const bandH = g.H * g.band;
  const band = [P(0, 0), P(g.W, 0), P(g.W, bandH), P(0, bandH)];
  const bandClip = id('band');

  // Clapper arm: the same stripes, lifted open around the hinge at the top-left corner.
  const t = (g.open * Math.PI) / 180;
  const armH = bandH * 0.9;
  const gap = g.H * 0.014;
  /** @type {PointAt} */
  const R = (x, y) => P(x * Math.cos(t) + y * Math.sin(t), -x * Math.sin(t) + y * Math.cos(t));
  /** @type {PointAt} */
  const armAt = (x, y) => R(x, y - gap - armH);
  const armLen = g.W * 1.03;
  const arm = [armAt(0, 0), armAt(armLen, 0), armAt(armLen, armH), armAt(0, armH)];
  const armClip = id('arm');

  // Chalk lines on the slate (the simple version leaves them out).
  const lines = simple
    ? ''
    : [0.36, 0.52, 0.68, 0.84]
        .map((v, i) => {
          const y = g.H * v;
          const x1 = g.W * (i % 2 ? 0.6 : 0.86);
          const h = g.H * 0.024;
          return `<polygon points="${poly([P(g.W * 0.1, y), P(x1, y), P(x1, y + h), P(g.W * 0.1, y + h)])}" fill="#2a2e39"/>`;
        })
        .join('');

  const hinge = armAt(armH * 0.55, armH * 0.5);
  // Centring: horizontally on the BOX alone (the lifted arm sticks out to the left and would pull
  // the box off-center), vertically on the whole silhouette (box + arm).
  const [bx0, , bx1] = bboxOf(outline);
  const [, y0, , y1] = bboxOf([...outline, ...arm]);
  const dx = 512 - (bx0 + bx1) / 2;
  const dy = 512 - (y0 + y1) / 2;
  return `<g transform="translate(${f1(dx)} ${f1(dy)})">
  <defs>
    <clipPath id="${bandClip}"><polygon points="${poly(band)}"/></clipPath>
    <clipPath id="${armClip}"><polygon points="${poly(arm)}"/></clipPath>
  </defs>
  <polygon points="${poly(front)}" fill="${FRONT}"/>
  <polygon points="${poly(side)}" fill="${SIDE}"/>
  <polygon points="${poly(top)}" fill="${simple ? SMALL_TOP : TOP}"/>
  ${lines}
  <polygon points="${poly(band)}" fill="${STRIPE_LIGHT}"/>
  <g clip-path="url(#${bandClip})">${stripes(0, g.W, bandH, P)}</g>
  ${rim(outline, simple ? 16 : 11, 1, simple ? 0.45 : 0.6)}
  ${rim(top, simple ? 10 : 6, simple ? 0.5 : 0.85, 1)}
  <polygon points="${poly(arm)}" fill="${STRIPE_LIGHT}"/>
  <g clip-path="url(#${armClip})">${stripes(0, armLen, armH, armAt)}</g>
  ${rim(arm, simple ? 8 : 5, 0.9, 0.8)}
  <circle cx="${f1(hinge[0])}" cy="${f1(hinge[1])}" r="${simple ? 20 : 13}" fill="${STRIPE_DARK}" stroke="${RIM}" stroke-opacity="0.85" stroke-width="${simple ? 6 : 4}"/>
  </g>`;
}

/**
 * shape 'round' – circle r = 500 on 1024, transparent outside.
 * shape 'mac'   – Apple rounded square (824 body, 100 margin) with a soft drop shadow; the
 *                 drawing is scaled into the body.
 * @param {IconOptions} options
 */
function iconSvg({ shape, simple }) {
  uid = 0;
  const bg = background();
  const objects = clapperBox(simple);
  if (shape === 'round') {
    const clip = id('clip');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${bg.defs}<clipPath id="${clip}"><circle cx="512" cy="512" r="500"/></clipPath></defs>
  <g clip-path="url(#${clip})">
    ${bg.paint((fill) => `<circle cx="512" cy="512" r="500" fill="${fill}"/>`)}
    ${objects}
  </g>
  <circle cx="512" cy="512" r="493" fill="none" stroke="${RING}" stroke-opacity="0.85" stroke-width="14"/>
</svg>`;
  }
  const clip = id('clip');
  const shadow = id('shadow');
  // Scale the drawing so its silhouette sits well inside the 824 px body.
  const k = simple ? 0.86 : 0.82;
  const tr = 512 * (1 - k);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${bg.defs}
    <clipPath id="${clip}"><rect x="100" y="100" width="824" height="824" rx="185" ry="185"/></clipPath>
    <filter id="${shadow}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <rect x="100" y="114" width="824" height="824" rx="185" ry="185" fill="#000" opacity="0.32" filter="url(#${shadow})"/>
  <g clip-path="url(#${clip})">
    ${bg.paint((fill) => `<rect x="100" y="100" width="824" height="824" fill="${fill}"/>`)}
    <g transform="translate(${f1(tr)} ${f1(tr)}) scale(${k})">${objects}</g>
  </g>
  <rect x="105" y="105" width="814" height="814" rx="180" ry="180" fill="none" stroke="${RING}" stroke-opacity="0.8" stroke-width="10"/>
</svg>`;
}

/**
 * Renders an SVG to a PNG of the given width.
 * @param {string} svg
 * @param {number} size
 */
function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size }, shapeRendering: 2 }).render().asPng();
}

/**
 * Windows .ico with PNG-compressed entries (supported since Windows Vista).
 * @param {IcoEntry[]} entries
 */
function ico(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const o = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, o);
    header.writeUInt8(size >= 256 ? 0 : size, o + 1);
    header.writeUInt8(0, o + 2);
    header.writeUInt8(0, o + 3);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

/**
 * macOS .icns with PNG entries.
 * @param {IcnsEntry[]} entries
 */
function icns(entries) {
  const chunks = entries.map(({ type, png }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii');
    h.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([h, png]);
  });
  const body = Buffer.concat(chunks);
  const h = Buffer.alloc(8);
  h.write('icns', 0, 'ascii');
  h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

/**
 * Writes a file, creating its folder, and reports it.
 * @param {string} path
 * @param {string | Buffer} data
 */
function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`wrote ${path} (${data.length} B)`);
}

const svgs = {
  macDetailed: iconSvg({ shape: 'mac', simple: false }),
  macSimple: iconSvg({ shape: 'mac', simple: true }),
  roundDetailed: iconSvg({ shape: 'round', simple: false }),
  roundSimple: iconSvg({ shape: 'round', simple: true }),
};
/**
 * The round icon as a PNG of the given size.
 * @param {number} size
 */
const round = (size) => render(size <= SMALL ? svgs.roundSimple : svgs.roundDetailed, size);
/**
 * The macOS icon as a PNG of the given size.
 * @param {number} size
 */
const mac = (size) => render(size <= SMALL ? svgs.macSimple : svgs.macDetailed, size);

// The small logo in the app's toolbar and the browser favicon: the simple round icon, with
// prefixed ids (it is inlined into the page) and no fixed size (CSS sizes it).
const logo = svgs.roundSimple
  .replace(' width="1024" height="1024"', '')
  .replace(/id="/g, 'id="mdlogo-')
  .replace(/url\(#/g, 'url(#mdlogo-');
write(LOGO_SVG, `${logo}\n`);

// PNGs (round), the ones bundle.icon in tauri.conf.json lists: the Linux packages install them as
// the app's icons, and on Linux the first one is the window icon.
const pngs = {
  '32x32.png': 32,
  '128x128.png': 128,
  '128x128@2x.png': 256,
};
for (const [name, size] of Object.entries(pngs)) write(join(OUT_DIR, name), round(size));

// The icon at the top of README.md.
write(README_ICON, round(256));

write(join(OUT_DIR, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: round(size) }))));

write(
  join(OUT_DIR, 'icon.icns'),
  icns([
    { type: 'icp4', png: mac(16) },
    { type: 'icp5', png: mac(32) },
    { type: 'ic11', png: mac(32) }, // 16@2x
    { type: 'icp6', png: mac(64) },
    { type: 'ic12', png: mac(64) }, // 32@2x
    { type: 'ic07', png: mac(128) },
    { type: 'ic08', png: mac(256) },
    { type: 'ic13', png: mac(256) }, // 128@2x
    { type: 'ic09', png: mac(512) },
    { type: 'ic14', png: mac(512) }, // 256@2x
    { type: 'ic10', png: mac(1024) }, // 512@2x
  ]),
);

// Optional preview sheet: every size on a light and a dark background.
const pi = process.argv.indexOf('--preview');
if (pi !== -1 && process.argv[pi + 1]) {
  const sizes = [16, 32, 64, 128, 256];
  /**
   * A PNG placed on the sheet at x, y with size s.
   * @param {Buffer} png
   * @param {number} x
   * @param {number} y
   * @param {number} s
   */
  const cell = (png, x, y, s) =>
    `<image x="${x}" y="${y}" width="${s}" height="${s}" href="data:image/png;base64,${png.toString('base64')}"/>`;
  let row = '';
  let x = 20;
  for (const s of sizes) {
    row += cell(mac(s), x, 20 + (256 - s), s) + cell(round(s), x, 316 + (256 - s), s);
    row += cell(mac(s), x, 612 + (256 - s), s) + cell(round(s), x, 908 + (256 - s), s);
    x += s + 30;
  }
  const W = x;
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="1184" viewBox="0 0 ${W} 1184">
  <rect width="${W}" height="592" fill="#ececee"/><rect y="592" width="${W}" height="592" fill="#1e1e20"/>${row}</svg>`;
  write(process.argv[pi + 1], new Resvg(sheet).render().asPng());
}
