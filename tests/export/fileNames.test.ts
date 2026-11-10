/**
 * Tests the export file names in src/export/fileNames.ts: the still image, the animation, the batch
 * ZIP and the print template names stay exactly as they are, and slugs are plain ASCII.
 */
import { describe, expect, it } from 'vitest';
import type { ImageSlotDef } from '../../src/core/types/model';
import { animationFileName, slugify, suggestFileName, templateFileName, zipFileName } from '../../src/export/fileNames';

/** 4 November 2026, 15:30 local time. */
const afternoon = new Date(2026, 10, 4, 15, 30);
/** 5 January 2026, 07:03 local time: every part of the stamp needs a leading zero. */
const morning = new Date(2026, 0, 5, 7, 3);

describe('slugify', () => {
  it('keeps lowercase ASCII letters and digits, joined by single hyphens', () => {
    expect(slugify('  Hello, World! 42  ')).toBe('hello-world-42');
  });

  it('maps Polish letters and strips other accents', () => {
    expect(slugify('Zażółć gęślą jaźń')).toBe('zazolc-gesla-jazn');
    expect(slugify('Łódź Ąę ñ')).toBe('lodz-ae-n');
  });

  it('is empty when nothing is left', () => {
    expect(slugify('***')).toBe('');
  });
});

describe('suggestFileName', () => {
  it('names a still image after the model and the local time', () => {
    expect(suggestFileName('dvd-case', 'png', afternoon)).toBe('mockup-director-dvd-case-2026-11-04-1530.png');
    expect(suggestFileName('dvd-case', 'jpeg', morning)).toBe('mockup-director-dvd-case-2026-01-05-0703.jpg');
    expect(suggestFileName('dvd-case', 'webp', afternoon)).toBe('mockup-director-dvd-case-2026-11-04-1530.webp');
  });

  it('slugs the model id and falls back to "mockup"', () => {
    expect(suggestFileName('Zażółć gęślą jaźń', 'png', afternoon)).toBe(
      'mockup-director-zazolc-gesla-jazn-2026-11-04-1530.png',
    );
    expect(suggestFileName('', 'png', afternoon)).toBe('mockup-director-mockup-2026-11-04-1530.png');
  });
});

describe('animationFileName', () => {
  it('names an animation after the model and the local time', () => {
    expect(animationFileName('dvd-case', 'gif', afternoon)).toBe('mockup-director-dvd-case-2026-11-04-1530.gif');
    expect(animationFileName('dvd-case', 'mp4', morning)).toBe('mockup-director-dvd-case-2026-01-05-0703.mp4');
    expect(animationFileName('', 'webp', afternoon)).toBe('mockup-director-mockup-2026-11-04-1530.webp');
  });
});

describe('zipFileName', () => {
  it('names the batch archive after the local time', () => {
    expect(zipFileName(afternoon)).toBe('mockup-director-batch-2026-11-04-1530.zip');
    expect(zipFileName(morning)).toBe('mockup-director-batch-2026-01-05-0703.zip');
  });
});

describe('templateFileName', () => {
  it('carries the model id, the slot, the size in mm and the dpi', () => {
    const slot: ImageSlotDef = {
      id: 'cover',
      label: 'Front cover',
      aspect: 1,
      template: { widthMm: 273.04, heightMm: 183, bleedMm: 3 },
    };
    expect(templateFileName('dvd-case', slot, 300, {})).toBe(
      'mockup-director-dvd-case-template-front-cover-273x183mm-300dpi.png',
    );
  });

  it('makes the template from the params and rounds the size and the dpi', () => {
    const slot: ImageSlotDef = {
      id: 'disc',
      label: 'Łódź – Ćma',
      aspect: 1,
      template: (p) => ({ widthMm: Number(p.w), heightMm: 120 }),
    };
    expect(templateFileName('cd-jewel', slot, 299.6, { w: 120.25 })).toBe(
      'mockup-director-cd-jewel-template-lodz-cma-120.3x120mm-300dpi.png',
    );
  });

  it('uses the slot id when the label leaves no slug, and leaves out the size without a template', () => {
    const slot: ImageSlotDef = { id: 'back', label: '***', aspect: 1 };
    expect(templateFileName('x', slot, 150, {})).toBe('mockup-director-x-template-back-150dpi.png');
  });
});
