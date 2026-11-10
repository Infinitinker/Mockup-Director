/**
 * Composite models: a case or box together with a loose 120 mm disc, as in typical retail
 * boxshots. src/models/composites/compose.ts puts them together.
 *
 *  - 'box-disc'          product box (buildBox)                 + disc
 *  - 'dvd-case-disc'     DVD keep case (buildKeepCase 'dvd')    + disc
 *  - 'bluray-case-disc'  Blu-ray keep case ('bluray')           + disc
 *  - 'cd-case-disc'      CD jewel case (buildJewelCase)         + disc
 */
import type { ModelDefinition } from '../../core/types/model';
import { boxModel, buildBox } from '../box';
import { blurayModel, dvdModel } from '../disc/keepCase';
import { buildKeepCase } from '../disc/keepCase/build';
import { cdCaseModel } from '../disc/jewelCase';
import { buildJewelCase } from '../disc/jewelCase/build';
import { icon } from '../icon';
import { baseContext, compose, compositeParams, compositeSlots } from './compose';

// Line-art icons: the base object with a disc standing behind it and peeking out on the right.
// Only the visible part of the disc is drawn – the arc end points are the exact intersections of
// the disc circle with the case outline.

// Box: disc circle (47, 36) r 13 meets the box's right edge x = 41 at y 24.47 and its slanted
// lower-back edge at (40.65, 47.35).
const ICON_BOX_DISC = icon(
  '<path d="M41 24.47A13 13 0 1 1 40.65 47.35"/><circle cx="47" cy="36" r="3"/>' +
    '<path d="M8 20H32V56H8Z"/><path d="M8 20L17 11H41L32 20"/><path d="M32 56L41 47V11"/>',
);

// DVD: disc circle (46, 39) r 15 meets the case's right edge x = 40 at y 25.25 / 52.75.
const ICON_DVD_DISC = icon(
  '<path d="M40 25.25A15 15 0 1 1 40 52.75"/><circle cx="46" cy="39" r="3"/>' +
    '<rect x="8" y="6" width="32" height="52" rx="4"/><path d="M14 6V58"/>',
);

// Blu-ray: disc circle (46, 39.5) r 15 meets x = 40 at y 25.75 / 53.25; band line at the top.
const ICON_BLURAY_DISC = icon(
  '<path d="M40 25.75A15 15 0 1 1 40 53.25"/><circle cx="46" cy="39.5" r="3"/>' +
    '<rect x="8" y="9" width="32" height="49" rx="4"/><path d="M8 19H40"/><path d="M14 19V58"/><path d="M19 14H31"/>',
);

// CD: disc circle (45, 35.5) r 14.5 meets the case's right edge x = 38 at y 22.8 / 48.2.
const ICON_CD_DISC = icon(
  '<path d="M38 22.8A14.5 14.5 0 1 1 38 48.2"/><circle cx="45" cy="35.5" r="3"/>' +
    '<rect x="4" y="21" width="34" height="30" rx="2.5"/><path d="M9 21V51"/><rect x="12" y="24" width="23" height="24" rx="1"/>',
);

export const boxDiscModel: ModelDefinition = {
  id: 'box-disc',
  category: 'box',
  name: 'Box with disc',
  description: 'Product box with a disc standing behind it, leaning against the front or lying in front.',
  icon: ICON_BOX_DISC,
  slots: compositeSlots(boxModel.slots),
  params: compositeParams(boxModel.params, 15),
  defaultCamera: { yaw: 30, pitch: 12 },
  build: (ctx) => compose(ctx, buildBox(ctx)),
};

export const dvdDiscModel: ModelDefinition = {
  id: 'dvd-case-disc',
  category: 'disc',
  name: 'DVD case with disc',
  description: 'DVD keep case with a disc peeking out from behind, leaning against the front or lying in front.',
  icon: ICON_DVD_DISC,
  slots: compositeSlots(dvdModel.slots),
  // The keep-case camera looks from the front-left (printed spine): turn the label that way too.
  params: compositeParams(dvdModel.params, -12),
  defaultCamera: { yaw: -30, pitch: 12 },
  build: (ctx) => compose(ctx, buildKeepCase(ctx, 'dvd')),
};

export const blurayDiscModel: ModelDefinition = {
  id: 'bluray-case-disc',
  category: 'disc',
  name: 'Blu-ray case with disc',
  description: 'Blu-ray keep case with a disc peeking out from behind, leaning against the front or lying in front.',
  icon: ICON_BLURAY_DISC,
  slots: compositeSlots(blurayModel.slots),
  params: compositeParams(blurayModel.params, -12),
  defaultCamera: { yaw: -30, pitch: 12 },
  build: (ctx) => compose(ctx, buildKeepCase(ctx, 'bluray')),
};

export const cdDiscModel: ModelDefinition = {
  id: 'cd-case-disc',
  category: 'disc',
  name: 'CD case with disc',
  description: 'CD jewel case with a disc peeking out from behind, leaning against the front or lying in front.',
  icon: ICON_CD_DISC,
  slots: compositeSlots(cdCaseModel.slots),
  params: compositeParams(cdCaseModel.params, 15),
  defaultCamera: { yaw: 30, pitch: 10, fov: 24 },
  // The loose disc replaces the jewel case's own "disc inside" (one 'disc' slot, one disc).
  build: (ctx) => compose(ctx, buildJewelCase(baseContext(ctx, { showDisc: false }))),
};
