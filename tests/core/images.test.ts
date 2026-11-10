/**
 * The limits on artwork in src/core/images.ts: files over the byte limit are refused before they are read, images
 * over the pixel limit before they are decoded (or, when the header does not say, once decoded, before they are
 * drawn), with messages that name the file, its size and the limit; every failure to read a file or make its data URL
 * is a UserError, with texts that fit a batch export as well; one image is loaded at a time; and the steps that
 * downscale an image never make a canvas side longer than the engines can draw. Node decodes no image: the decoders
 * are stand-ins here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../../src/core/errors';
import {
  MAX_ARTWORK_BYTES,
  MAX_ARTWORK_PIXELS,
  checkArtworkBytes,
  checkArtworkPixels,
  downscaleSteps,
  loadImageDataUrl,
  loadImageFile,
} from '../../src/core/images';

/** The first 24 bytes of a PNG of `w` × `h` pixels: the signature and the IHDR chunk up to the height. */
function pngHeader(w: number, h: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

/** The first bytes of an AVIF file, a format whose size imageSize does not read. */
const AVIF = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]);

/** A FileReader whose data URLs are made at once. */
class ReadingFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  readAsDataURL(): void {
    this.result = 'data:image/avif;base64,';
    queueMicrotask(() => this.onload?.());
  }
}

const dataUrlOf = (b: Uint8Array) => `data:image/png;base64,${Buffer.from(b).toString('base64')}`;

/** The error `promise` rejects with; fails when it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('nothing was thrown');
    },
    (e: unknown) => e,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkArtworkBytes', () => {
  it('takes a file up to the limit', () => {
    expect(() => checkArtworkBytes('a.png', 0)).not.toThrow();
    expect(() => checkArtworkBytes('a.png', MAX_ARTWORK_BYTES)).not.toThrow();
  });

  it('refuses a larger file, naming it, its size and the limit', () => {
    expect(() => checkArtworkBytes('scan.tif', MAX_ARTWORK_BYTES + 1)).toThrow(
      new UserError(
        'The file “scan.tif” is 101 MB, more than Mockup Director can use (100 MB). Save it as a smaller file, for example with fewer pixels, then choose it again.',
      ),
    );
    expect(() => checkArtworkBytes('scan.tif', MAX_ARTWORK_BYTES + 1)).toThrow(UserError);
  });
});

describe('checkArtworkPixels', () => {
  it('takes an image up to the limit, an A1 poster at 300 dpi included', () => {
    expect(() => checkArtworkPixels('a.png', { width: 7016, height: 9933 })).not.toThrow();
    expect(() => checkArtworkPixels('a.png', { width: 10000, height: MAX_ARTWORK_PIXELS / 10000 })).not.toThrow();
  });

  it('refuses a larger image, naming it, its size and the limit', () => {
    expect(() => checkArtworkPixels('x.png', { width: 20000, height: 20000 })).toThrow(
      new UserError(
        'The image “x.png” is 20,000 × 20,000 pixels, more than Mockup Director can use (100 megapixels). Scale it down, then choose it again.',
      ),
    );
    expect(() => checkArtworkPixels('x.png', { width: 10001, height: 10000 })).toThrow(UserError);
  });
});

describe('loadImageFile', () => {
  it('refuses a file over the byte limit without reading it', async () => {
    const arrayBuffer = vi.fn();
    const file = { name: 'big.png', size: MAX_ARTWORK_BYTES + 1, type: 'image/png', arrayBuffer } as unknown as File;
    const error = await rejectionOf(loadImageFile(file));
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toMatch(/^The file “big\.png” is 101 MB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('refuses an image whose header is over the pixel limit before making its data URL', async () => {
    const readAsDataURL = vi.fn();
    vi.stubGlobal(
      'FileReader',
      class {
        readAsDataURL = readAsDataURL;
      },
    );
    const error = await rejectionOf(loadImageFile(new File([pngHeader(20000, 20000)], 'x.png')));
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toMatch(/^The image “x\.png” is 20,000 × 20,000 pixels/);
    expect(readAsDataURL).not.toHaveBeenCalled();
  });

  it('refuses a file that cannot be read with a UserError', async () => {
    const failure = new DOMException('The file could not be read', 'NotReadableError');
    const file = {
      name: 'gone.png',
      size: 10,
      type: '',
      arrayBuffer: () => Promise.reject(failure),
    } as unknown as File;
    const error = await rejectionOf(loadImageFile(file));
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toBe(
      'The file “gone.png” could not be read. Check that it still exists and can be opened, then choose it again.',
    );
    expect((error as UserError).cause).toBe(failure);
  });

  it('turns a failure to make the data URL into a UserError that says what to do', async () => {
    const failure = new DOMException('Out of memory', 'NotReadableError');
    vi.stubGlobal(
      'FileReader',
      class {
        error = failure;
        onerror: (() => void) | null = null;
        readAsDataURL() {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    const error = await rejectionOf(loadImageFile(new File([pngHeader(100, 100)], 'a.png')));
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toBe(
      'The file “a.png” could not be loaded: there is likely not enough memory. Close other projects or choose a smaller file.',
    );
    expect((error as UserError).cause).toBe(failure);
  });
});

describe('loadImageFile with an image whose header does not say its size', () => {
  it('refuses a decoded bitmap over the pixel limit before drawing it, and closes it', async () => {
    const close = vi.fn();
    vi.stubGlobal('FileReader', ReadingFileReader);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 20000, height: 20000, close }));
    const error = await rejectionOf(loadImageFile(new File([AVIF], 'x.avif')));
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toMatch(/^The image “x\.avif” is 20,000 × 20,000 pixels/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('refuses a decoded image element over the pixel limit before drawing it', async () => {
    vi.stubGlobal('FileReader', ReadingFileReader);
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 30000;
        naturalHeight = 10000;
        onload: (() => void) | null = null;
        set src(_url: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const error = await rejectionOf(loadImageFile(new File([AVIF], 'y.avif')));
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toMatch(/^The image “y\.avif” is 30,000 × 10,000 pixels/);
  });
});

describe('loading one image at a time', () => {
  it('starts reading a file only when the load before it has ended, even when that one failed', async () => {
    let failFirst: (e: unknown) => void = () => undefined;
    const first = {
      name: 'a.png',
      size: 10,
      type: '',
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          failFirst = reject;
        }),
    } as unknown as File;
    const secondRead = vi.fn(() => Promise.reject(new Error('gone')));
    const second = { name: 'b.png', size: 10, type: '', arrayBuffer: secondRead } as unknown as File;
    const loads = [rejectionOf(loadImageFile(first)), rejectionOf(loadImageFile(second))];
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(secondRead).not.toHaveBeenCalled();
    failFirst(new Error('gone'));
    const [a, b] = await Promise.all(loads);
    expect(a).toBeInstanceOf(UserError);
    expect(b).toBeInstanceOf(UserError);
    expect(secondRead).toHaveBeenCalledTimes(1);
  });
});

describe('loadImageDataUrl', () => {
  it('refuses artwork whose header is over the pixel limit before decoding it', async () => {
    const error = await rejectionOf(loadImageDataUrl(dataUrlOf(pngHeader(30000, 10000)), 'cover.png'));
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toMatch(/^The image “cover\.png” is 30,000 × 10,000 pixels/);
  });

  it('refuses a damaged data URL', async () => {
    const error = await rejectionOf(loadImageDataUrl('not a data URL', 'cover.png'));
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).message).toMatch(/is damaged/);
  });
});

describe('downscaleSteps', () => {
  it('draws an image no larger than the texture once, at its own size', () => {
    expect(downscaleSteps(4096, 1000)).toEqual([{ width: 4096, height: 1000 }]);
    expect(downscaleSteps(1, 1)).toEqual([{ width: 1, height: 1 }]);
  });

  it('halves a large image until it is within 2× of the texture, then draws the texture', () => {
    expect(downscaleSteps(8000, 6000)).toEqual([{ width: 4096, height: 3072 }]);
    expect(downscaleSteps(20000, 5000)).toEqual([
      { width: 10000, height: 2500 },
      { width: 5000, height: 1250 },
      { width: 4096, height: 1024 },
    ]);
  });

  it('first scales a very wide or tall image so no side is over 16,384 px, then halves it', () => {
    expect(downscaleSteps(100000, 1000)).toEqual([
      { width: 16384, height: 164 },
      { width: 8192, height: 82 },
      { width: 4096, height: 41 },
    ]);
    expect(downscaleSteps(2500, 40000)).toEqual([
      { width: 1024, height: 16384 },
      { width: 512, height: 8192 },
      { width: 256, height: 4096 },
    ]);
  });

  it('never makes a canvas side longer than 16,384 px or shorter than the texture’s, for any image within the limit', () => {
    for (const [w, h] of [
      [100_000_000, 1],
      [1, 100_000_000],
      [10000, 10000],
      [32769, 3051],
      [65535, 1525],
      [7016, 9933],
    ]) {
      const steps = downscaleSteps(w, h);
      const last = steps[steps.length - 1];
      expect(Math.max(last.width, last.height), `${w} × ${h}`).toBe(Math.min(4096, Math.max(w, h)));
      for (const step of steps) {
        expect(Math.max(step.width, step.height), `${w} × ${h}`).toBeLessThanOrEqual(16384);
        expect(step.width).toBeGreaterThanOrEqual(last.width);
        expect(step.height).toBeGreaterThanOrEqual(last.height);
      }
    }
  });
});
