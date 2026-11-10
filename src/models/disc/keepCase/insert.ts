/**
 * The keep case's printed insert: its artwork slots (the cover wrap, or the separate front, spine
 * and back) with their print templates.
 */
import type { ImageSlotDef, ParamValues, PrintTemplate } from '../../../core/types/model';
import { round1 } from '../../../core/math';
import { BLEED, SPECS, thicknessOf, type KeepCaseVariant } from './specs';

const TRIM = 'Trim line';
const FOLD = 'Fold line';

/** Wrap insert: Back | Spine | Front, left to right, with 3 mm bleed. */
function keepCaseCoverTemplate(params: ParamValues, variant: KeepCaseVariant): PrintTemplate {
  const spec = SPECS[variant];
  const t = thicknessOf(params, variant);
  const pw = spec.panelWidth;
  const hi = spec.insertHeight;
  const b = BLEED;
  return {
    widthMm: 2 * pw + t + 2 * b,
    heightMm: hi + 2 * b,
    bleedMm: b,
    guides: [
      { orientation: 'v', posMm: b, label: TRIM },
      { orientation: 'v', posMm: b + pw, label: FOLD },
      { orientation: 'v', posMm: b + pw + t, label: FOLD },
      { orientation: 'v', posMm: b + 2 * pw + t, label: TRIM },
      { orientation: 'h', posMm: b, label: TRIM },
      { orientation: 'h', posMm: b + hi, label: TRIM },
    ],
    regions: [
      { xMm: b, yMm: b, wMm: pw, hMm: hi, label: 'Back' },
      { xMm: b + pw, yMm: b, wMm: t, hMm: hi, label: 'Spine' },
      { xMm: b + pw + t, yMm: b, wMm: pw, hMm: hi, label: 'Front' },
    ],
  };
}

/** Single panel (front / spine / back) with 3 mm bleed. */
function panelTemplate(w: number, h: number, label: string): PrintTemplate {
  const b = BLEED;
  return {
    widthMm: w + 2 * b,
    heightMm: h + 2 * b,
    bleedMm: b,
    guides: [
      { orientation: 'v', posMm: b, label: TRIM },
      { orientation: 'v', posMm: b + w, label: TRIM },
      { orientation: 'h', posMm: b, label: TRIM },
      { orientation: 'h', posMm: b + h, label: TRIM },
    ],
    regions: [{ xMm: b, yMm: b, wMm: w, hMm: h, label }],
  };
}

export function makeSlots(variant: KeepCaseVariant): ImageSlotDef[] {
  const spec = SPECS[variant];
  const t0 = parseFloat(spec.defaultThickness);
  const pw = spec.panelWidth;
  const hi = spec.insertHeight;
  const wrapW = 2 * pw + t0;
  // The thickness options are whole millimeters ("14 / 9 / 7"), so the list has no decimal point.
  const spines = spec.thicknessOptions.map((o) => String(parseFloat(o.value))).join(' / ');
  const onlyIfNoCover = 'Used only when “Cover wrap” has no artwork.';
  return [
    {
      id: 'cover',
      label: 'Cover wrap',
      hint: `The whole insert under the sleeve, left to right: Back | Spine | Front. ${round1(wrapW)} × ${round1(hi)} mm + 3 mm bleed: two panels of ${round1(pw)} mm and a spine of ${spines} mm, as in the template. It takes priority over the separate Front / Spine / Back slots.`,
      aspect: (wrapW + 2 * BLEED) / (hi + 2 * BLEED),
      template: (params) => keepCaseCoverTemplate(params, variant),
    },
    {
      id: 'front',
      label: 'Front',
      hint: `${onlyIfNoCover} The front panel is ${round1(pw)} × ${round1(hi)} mm + 3 mm bleed.`,
      aspect: (pw + 2 * BLEED) / (hi + 2 * BLEED),
      template: panelTemplate(pw, hi, 'Front'),
    },
    {
      id: 'spine',
      label: 'Spine',
      hint: `${onlyIfNoCover} A vertical strip as in the template, as wide as the case is thick (${spines} mm) and ${round1(hi)} mm high, + 3 mm bleed. Without artwork the spine uses “Spine & back color (no artwork)”.`,
      aspect: (t0 + 2 * BLEED) / (hi + 2 * BLEED),
      template: (params) => panelTemplate(thicknessOf(params, variant), hi, 'Spine'),
    },
    {
      id: 'back',
      label: 'Back',
      hint: `${onlyIfNoCover} The back panel is ${round1(pw)} × ${round1(hi)} mm + 3 mm bleed. Without artwork the back uses “Spine & back color (no artwork)”.`,
      aspect: (pw + 2 * BLEED) / (hi + 2 * BLEED),
      template: panelTemplate(pw, hi, 'Back'),
    },
  ];
}
