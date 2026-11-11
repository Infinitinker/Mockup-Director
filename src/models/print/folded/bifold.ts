/**
 * The bi-fold brochure ('print-bifold'): a sheet folded in half (A4 → A5 by default), lying flat or
 * standing slightly open. Slots 'outside' (primary) and 'inside'.
 */
import type { ModelDefinition } from '../../../core/types/model';
import { icon } from '../../icon';
import { type CardVariant, cardModel } from './singleFold';

const BIFOLD: CardVariant = {
  sizes: [
    { value: 'a5', label: 'A4 → A5 (148 × 210 mm)', w: 148, h: 210 },
    { value: 'a6', label: 'A5 → A6 (105 × 148 mm)', w: 105, h: 148 },
    { value: 'a4', label: 'A3 → A4 (210 × 297 mm)', w: 210, h: 297 },
    { value: 'dl', label: '2 × DL → DL (99 × 210 mm)', w: 99, h: 210 },
    { value: 'square', label: 'Square 210 × 210 mm', w: 210, h: 210 },
    { value: 'letter', label: 'Letter → 5.5 × 8.5″ (139.7 × 215.9 mm)', w: 139.7, h: 215.9 },
  ],
  defaultSize: 'a5',
  customW: 148,
  customH: 210,
  defaultPose: 'standing',
  defaultAngle: 30,
  defaultThickness: 0.2,
  defaultFinish: 'satin',
  name: 'Bi-fold brochure',
};

export const bifoldModel: ModelDefinition = cardModel(BIFOLD, {
  id: 'print-bifold',
  name: 'Bi-fold brochure',
  description: 'Brochure from a sheet folded in half (A4 → A5 by default), lying flat or standing slightly open.',
  icon: icon(
    '<path d="M18 8h34v48H18z"/><path d="M18 8l-8 5v47l8-4"/>' + '<path d="M25 20h20M25 27h20M25 34h13"/>',
    2.5,
  ),
  defaultCamera: { yaw: 20, pitch: 14 },
});
