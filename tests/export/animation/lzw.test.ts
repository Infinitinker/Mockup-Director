/**
 * Tests the GIF LZW encoder in src/export/animation/lzw.ts by decoding its output with an
 * independent strict decoder: round trips across every minimum code size, the points where the
 * code size grows and the table fills up, the sub-block layout and reuse of one encoder.
 */
import { describe, expect, it } from 'vitest';
import { LzwEncoder } from '../../../src/export/animation/lzw';
import { randomInt, seededRandom } from '../../random';
import { concatBytes, decodeLzw, type LzwDecoded, readSubBlocks } from './lzwDecoder';

const MIN_CODE_SIZES = [2, 3, 4, 5, 6, 7, 8];

/** Splits an encoder payload into its parts, checking the sub-block layout on the way. */
function unpack(payload: Uint8Array): { minCodeSize: number; data: Uint8Array; sizes: number[] } {
  const { blocks, end } = readSubBlocks(payload, 1);
  expect(end).toBe(payload.length);
  return { minCodeSize: payload[0], data: concatBytes(blocks), sizes: blocks.map((b) => b.length) };
}

/** Encodes and decodes `indices`, expecting the same pixels back. */
function roundTrip(encoder: LzwEncoder, indices: Uint8Array, minCodeSize: number): LzwDecoded {
  const { minCodeSize: written, data } = unpack(encoder.encode(indices, minCodeSize));
  expect(written).toBe(minCodeSize);
  const decoded = decodeLzw(written, data);
  expect(decoded.indices).toEqual(indices);
  return decoded;
}

function randomIndices(seed: number, length: number, minCodeSize: number): Uint8Array {
  const random = seededRandom(seed);
  const max = (1 << minCodeSize) - 1;
  return Uint8Array.from({ length }, () => randomInt(random, 0, max));
}

/** Runs of random length (1..maxRun) of random values. */
function runIndices(seed: number, length: number, minCodeSize: number, maxRun: number): Uint8Array {
  const random = seededRandom(seed);
  const out = new Uint8Array(length);
  let i = 0;
  while (i < length) {
    const value = randomInt(random, 0, (1 << minCodeSize) - 1);
    const run = randomInt(random, 1, maxRun);
    out.fill(value, i, Math.min(length, i + run));
    i += run;
  }
  return out;
}

describe('LzwEncoder', () => {
  it('round-trips empty input, single pixels and pairs for every minimum code size', () => {
    const encoder = new LzwEncoder();
    for (const size of MIN_CODE_SIZES) {
      const max = (1 << size) - 1;
      expect(roundTrip(encoder, new Uint8Array(0), size).codes).toBe(2);
      for (const value of [0, 1, max]) {
        roundTrip(encoder, Uint8Array.of(value), size);
        roundTrip(encoder, Uint8Array.of(value, value), size);
        roundTrip(encoder, Uint8Array.of(value, max - value), size);
      }
    }
  });

  it('round-trips every length up to 1200 so the end lands on each code size step', () => {
    const encoder = new LzwEncoder();
    for (const size of MIN_CODE_SIZES) {
      const base = randomIndices(1000 + size, 1200, size);
      const sizesSeen = new Set<number>();
      for (let length = 1; length <= base.length; length++) {
        sizesSeen.add(roundTrip(encoder, base.subarray(0, length), size).largestCodeSize);
      }
      expect(Math.min(...sizesSeen)).toBe(size + 1);
      expect(Math.max(...sizesSeen)).toBeGreaterThanOrEqual(size + 3);
    }
  });

  it('round-trips random pixels past a full table, restarting with clear codes', () => {
    const encoder = new LzwEncoder();
    for (const size of MIN_CODE_SIZES) {
      const decoded = roundTrip(encoder, randomIndices(size, 40_000, size), size);
      expect(decoded.largestCodeSize).toBe(12);
      expect(decoded.clearCodes).toBeGreaterThan(1);
    }
  });

  it('round-trips runs and repeating patterns', () => {
    const encoder = new LzwEncoder();
    for (const size of MIN_CODE_SIZES) {
      roundTrip(encoder, runIndices(50 + size, 30_000, size, 40), size);
      roundTrip(encoder, runIndices(60 + size, 5_000, size, 3), size);
      const pattern = Uint8Array.from({ length: 20_000 }, (_, i) => (i * 7 + (i >> 5)) % (1 << size));
      roundTrip(encoder, pattern, size);
    }
  });

  it('round-trips long single-color runs and compresses them well', () => {
    const encoder = new LzwEncoder();
    for (const size of MIN_CODE_SIZES) {
      for (const length of [3, 4, 5, 6, 7, 100, 10_000, 200_000]) {
        roundTrip(encoder, new Uint8Array(length).fill((1 << size) - 1), size);
      }
    }
    const payload = encoder.encode(new Uint8Array(10_000), 8);
    expect(payload.length).toBeLessThan(200);
  });

  it('clamps the minimum code size to 2..8', () => {
    const encoder = new LzwEncoder();
    const indices = Uint8Array.of(0, 1, 1, 0);
    expect(encoder.encode(indices, 1)[0]).toBe(2);
    expect(encoder.encode(indices, 0)[0]).toBe(2);
    expect(encoder.encode(indices, 12)[0]).toBe(8);
    expect(decodeLzw(2, unpack(encoder.encode(indices, 1)).data).indices).toEqual(indices);
  });

  it('writes full 255-byte sub-blocks and one shorter last block', () => {
    const encoder = new LzwEncoder();
    const { sizes } = unpack(encoder.encode(randomIndices(7, 5_000, 8), 8));
    expect(sizes.length).toBeGreaterThan(2);
    expect(sizes.slice(0, -1).every((s) => s === 255)).toBe(true);
    expect(sizes[sizes.length - 1]).toBeGreaterThan(0);
    expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(255);
  });

  it('gives the same bytes from a reused encoder as from a fresh one', () => {
    const reused = new LzwEncoder();
    reused.encode(randomIndices(3, 50_000, 8), 8);
    const small = randomIndices(4, 700, 4);
    expect(reused.encode(small, 4)).toEqual(new LzwEncoder().encode(small, 4));
    expect(reused.encode(small, 4)).toEqual(reused.encode(small, 4));
  });
});
