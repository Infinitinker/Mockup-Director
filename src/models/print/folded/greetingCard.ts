/**
 * The greeting card ('print-greeting-card'): a card folded once (A6, square, DL, A5 or a custom
 * size), standing opened, the fold on the left or at the top. Slots 'outside' (primary) and 'inside'.
 */
import type { ModelDefinition } from '../../../core/types/model';
import { icon } from '../../icon';
import { type CardVariant, cardModel } from './singleFold';

const GREETING: CardVariant = {
  sizes: [
    { value: 'a6', label: 'A6 – 105 × 148 mm', w: 105, h: 148 },
    { value: 'square', label: 'Square 148 × 148 mm', w: 148, h: 148 },
    { value: 'dl', label: 'DL – 99 × 210 mm', w: 99, h: 210 },
    { value: 'a5', label: 'A5 – 148 × 210 mm', w: 148, h: 210 },
  ],
  defaultSize: 'a6',
  customW: 105,
  customH: 148,
  defaultPose: 'standing',
  defaultAngle: 110,
  defaultThickness: 0.35,
  defaultFinish: 'matte',
  name: 'Greeting card',
};

export const greetingCardModel: ModelDefinition = cardModel(GREETING, {
  id: 'print-greeting-card',
  name: 'Greeting card',
  description:
    'Folded greeting card (A6, square, DL, A5 or custom) standing opened: fold on the left or at the top (tent).',
  icon: icon(
    '<path d="M26 8v48l26 3V11z"/><path d="M26 8L10 14v44l16-2"/>' +
      '<path d="M39 29c-2-3-6-1-4 2l4 4 4-4c2-3-2-5-4-2z"/>',
    2.5,
  ),
  defaultCamera: { yaw: 20, pitch: 12 },
});
