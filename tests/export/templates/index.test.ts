/**
 * Tests src/export/templates/index.ts with a fake `document`: no PNG for a slot without a template, the resolution
 * clamped and lowered to the canvas limits, the retries at a lower resolution when the engine refuses the canvas, the
 * resolution recorded in the PNG, and the round template and the legend drawn on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageSlotDef, PrintTemplate } from '../../../src/core/types/model';
import { UserError } from '../../../src/core/errors';
import { crc32 } from '../../../src/export/png';
import { renderTemplateDetailed } from '../../../src/export/templates';
import { TEXTS } from '../../../src/export/templates/common';
import { recordingContext, stubCanvasDocument } from '../../models/fakeContext';
import { buildPng, grayIdat, grayIhdr, readPngChunks } from '../pngChunks';

/** A canvas the fake document hands out: its size, and whether the engine gave it a 2D context. */
interface FakeTemplateCanvas {
  width: number;
  height: number;
  sizes: [number, number][];
  refused: boolean;
}

/** The canvases the fake document created, in order. */
let canvases: FakeTemplateCanvas[] = [];
/** What was drawn on them. */
let drawn: string[] = [];

/** A one-pixel PNG without a resolution, as a canvas encoder gives it. */
const PNG = buildPng(
  [
    { type: 'IHDR', data: grayIhdr(1, 1) },
    { type: 'IDAT', data: grayIdat([Uint8Array.of(0)]) },
    { type: 'IEND', data: new Uint8Array(0) },
  ],
  crc32,
);

/** Replaces `document` with one whose first `refusals` canvases get no 2D context; the others encode to PNG. */
function stubTemplateDocument(refusals = 0): void {
  vi.stubGlobal('document', {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`The fake document only creates canvases, not ${tag}.`);
      const record: FakeTemplateCanvas = { width: 300, height: 150, sizes: [], refused: canvases.length < refusals };
      canvases.push(record);
      return {
        get width() {
          return record.width;
        },
        set width(value: number) {
          record.width = value;
          record.sizes.push([value, record.height]);
        },
        get height() {
          return record.height;
        },
        set height(value: number) {
          record.height = value;
        },
        getContext: () => (record.refused ? null : recordingContext((call) => drawn.push(call))),
        toBlob: (done: (blob: Blob | null) => void, type: string) => done(new Blob([PNG], { type })),
      };
    },
  });
}

/** The front slot, with the template if one is given. */
const slot = (template?: ImageSlotDef['template']): ImageSlotDef =>
  template ? { id: 'front', label: 'Front', aspect: 2, template } : { id: 'front', label: 'Front', aspect: 2 };

const A5: PrintTemplate = { widthMm: 154, heightMm: 216, bleedMm: 3 };

/** The texts drawn, in order. */
const texts = () =>
  drawn.filter((call) => call.startsWith('fillText(')).map((call) => call.slice(9, call.indexOf(',')));

afterEach(() => {
  canvases = [];
  drawn = [];
  vi.unstubAllGlobals();
});

describe('renderTemplateDetailed', () => {
  it('gives null for a slot without a template, or with an empty one', async () => {
    stubTemplateDocument();
    expect(await renderTemplateDetailed(slot(), 300, {})).toBeNull();
    expect(await renderTemplateDetailed(slot({ widthMm: 0, heightMm: 50 }), 300, {})).toBeNull();
    expect(
      await renderTemplateDetailed(
        slot(() => ({ widthMm: 100, heightMm: -1 })),
        300,
        {},
      ),
    ).toBeNull();
    expect(canvases).toEqual([]);
  });

  it('renders at the requested resolution, from a template that depends on the parameters', async () => {
    stubTemplateDocument();
    const result = await renderTemplateDetailed(
      slot((p) => ({ ...A5, widthMm: Number(p.width) })),
      300,
      { width: 154 },
    );
    expect(result).toMatchObject({ dpi: 300, requestedDpi: 300, widthPx: 1819, heightPx: 2551 });
    expect(result?.template).toEqual(A5);
    expect(canvases[0].sizes[0]).toEqual([1819, 150]);
    // The canvas is released once encoded.
    expect([canvases[0].width, canvases[0].height]).toEqual([0, 0]);
  });

  it('records the resolution in the PNG', async () => {
    stubTemplateDocument();
    const result = await renderTemplateDetailed(slot(A5), 300, {});
    const bytes = new Uint8Array((await result?.blob.arrayBuffer()) ?? new ArrayBuffer(0));
    // 300 dpi is 11811 pixels per meter, in both directions.
    const phys = readPngChunks(bytes).find((chunk) => chunk.type === 'pHYs');
    expect(phys?.data).toEqual(Uint8Array.of(0, 0, 0x2e, 0x23, 0, 0, 0x2e, 0x23, 1));
    expect(result?.blob.type).toBe('image/png');
  });

  it('clamps the requested resolution to 10..2400 dpi, 300 when it is not a number', async () => {
    stubTemplateDocument();
    const dpis = async (dpi: number) =>
      (await renderTemplateDetailed(slot({ widthMm: 20, heightMm: 10 }), dpi, {}))?.requestedDpi;
    expect(await dpis(5)).toBe(10);
    expect(await dpis(5000)).toBe(2400);
    expect(await dpis(Number.NaN)).toBe(300);
  });

  it('lowers the resolution so no side passes 12000 pixels', async () => {
    stubTemplateDocument();
    const result = await renderTemplateDetailed(slot({ widthMm: 1000, heightMm: 10 }), 600, {});
    expect(result).toMatchObject({ dpi: 304, requestedDpi: 600 });
    expect(result?.widthPx).toBeLessThanOrEqual(12000);
    expect(texts()).toContain('304 dpi · 11969 × 120 px (reduced from 600 dpi)');
  });

  it('lowers the resolution so the canvas stays within 60 megapixels', async () => {
    stubTemplateDocument();
    const result = await renderTemplateDetailed(slot({ widthMm: 500, heightMm: 500 }), 600, {});
    expect(result).toMatchObject({ dpi: 393, widthPx: 7736, heightPx: 7736 });
    expect((result?.widthPx ?? 0) * (result?.heightPx ?? 0)).toBeLessThanOrEqual(60_000_000);
  });

  it('retries at 0.7 times the resolution when the engine refuses the canvas', async () => {
    stubTemplateDocument(2);
    const result = await renderTemplateDetailed(slot(A5), 300, {});
    expect(canvases.map((c) => c.sizes[0][0])).toEqual([1819, 1273, 891]);
    expect(result).toMatchObject({ dpi: 147, requestedDpi: 300, widthPx: 891 });
  });

  it('gives up with a UserError after four refused canvases', async () => {
    stubCanvasDocument();
    const failure = renderTemplateDetailed(slot(A5), 300, {});
    await expect(failure).rejects.toThrow(UserError);
    await expect(failure).rejects.toThrow(TEXTS.tooLarge);
  });

  it('draws the round template of a disc and its legend', async () => {
    stubTemplateDocument();
    const disc = { widthMm: 120, heightMm: 120, circle: { outerMm: 118, innerMm: 15 } };
    await renderTemplateDetailed(slot(disc), 300, {});
    expect(texts()).toEqual(
      expect.arrayContaining([
        'Front',
        'Ø 118 mm · Hole Ø 15 mm',
        TEXTS.hub,
        'Trim: Ø 118 mm',
        'Hole: Ø 15 mm',
        'Artwork size: 120 × 120 mm',
        '300 dpi · 1417 × 1417 px',
        TEXTS.hint,
      ]),
    );
  });
});
