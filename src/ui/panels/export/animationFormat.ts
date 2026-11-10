/**
 * The Format & background section of the Animation export type: GIF, WebP or MP4 and the options of each, with
 * notes on what the format cannot do here.
 */
import type { AnimationFormat, AnimationSettings } from '../../../core/types/export';
import { switchAnimationFormat } from '../../../export/animation/settings';
import { MP4_UNSUPPORTED, WEBP_ANIMATION_UNSUPPORTED } from '../../../export/animation';
import type { AppContext } from '../../context';
import type { AddControl } from '../../controls';
import { section } from '../../controls/section';
import { segmentedControl } from '../../controls/segmented';
import { selectControl } from '../../controls/select';
import { h } from '../../dom';
import { animationOf, updateAnimation } from './settings';

const QUALITY_LABEL: Record<AnimationSettings['quality'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/** The section; `support` is what this engine can encode. */
export function formatSection(
  ctx: AppContext,
  support: Record<AnimationFormat, boolean>,
  add: AddControl,
): HTMLElement {
  const an = () => animationOf(ctx);
  const updA = (fn: (a: AnimationSettings) => void) => updateAnimation(ctx, fn);

  const format = add(
    segmentedControl<AnimationFormat>({
      label: 'Format',
      options: [
        { value: 'gif', label: 'GIF' },
        {
          value: 'webp',
          label: 'WebP',
          disabled: !support.webp,
          title: support.webp ? 'WebP' : WEBP_ANIMATION_UNSUPPORTED,
        },
        {
          value: 'mp4',
          label: 'MP4',
          disabled: !support.mp4,
          title: support.mp4 ? 'MP4 (H.264)' : MP4_UNSUPPORTED,
        },
      ],
      get: () => an().format,
      set: (v) => updA((a) => switchAnimationFormat(a, v)),
    }),
  );
  const unsupportedNotes: HTMLElement[] = [];
  if (!support.webp) unsupportedNotes.push(h('p', { class: 'ctl-note', text: WEBP_ANIMATION_UNSUPPORTED }));
  if (!support.mp4) unsupportedNotes.push(h('p', { class: 'ctl-note', text: MP4_UNSUPPORTED }));

  const quality = add(
    segmentedControl<AnimationSettings['quality']>({
      label: 'Quality',
      options: (['low', 'medium', 'high'] as const).map((q) => ({ value: q, label: QUALITY_LABEL[q] })),
      get: () => an().quality,
      set: (v) => updA((a) => (a.quality = v)),
    }),
  );
  const dither = add(
    selectControl({
      label: 'Dithering',
      options: [
        { value: 'floyd', label: 'Floyd–Steinberg' },
        { value: 'ordered', label: 'Ordered (Bayer)' },
        { value: 'none', label: 'None' },
      ],
      get: () => an().dither,
      set: (v) => updA((a) => (a.dither = v === 'ordered' || v === 'none' ? v : 'floyd')),
    }),
  );
  const palette = add(
    segmentedControl<AnimationSettings['palette']>({
      label: 'Color palette',
      options: [
        { value: 'global', label: 'Global' },
        { value: 'frame', label: 'Per frame' },
      ],
      get: () => an().palette,
      set: (v) => updA((a) => (a.palette = v)),
    }),
  );
  const paletteNote = h('p', {
    class: 'ctl-note',
    text: 'Global palette: stable colors and a smaller file. Per frame: more accurate colors and a larger file.',
  });
  const background = add(
    segmentedControl<AnimationSettings['background']>({
      label: 'Background',
      options: [
        { value: 'transparent', label: 'Transparent', title: 'Transparent (checkerboard)' },
        { value: 'scene', label: 'As preview' },
      ],
      get: () => an().background,
      set: (v) => updA((a) => (a.background = v)),
    }),
  );
  const gifAlphaNote = h('p', {
    class: 'ctl-note warn-note',
    text: `GIF only has 1-bit transparency: the soft shadow and reflection disappear and edges may look jagged. ${support.webp ? 'Choose the preview background or WebP.' : 'Choose the preview background.'}`,
  });
  const mp4AlphaNote = h('p', {
    class: 'ctl-note warn-note',
    text: 'MP4 has no transparency: the background will be white.',
  });
  add({
    el: quality.el,
    sync: () => {
      const a = an();
      const gif = a.format === 'gif';
      quality.el.hidden = gif;
      dither.el.hidden = !gif;
      palette.el.hidden = !gif;
      paletteNote.hidden = !gif;
      const transparent = a.background === 'transparent' || ctx.store.state.scene.background.mode === 'transparent';
      gifAlphaNote.hidden = !(gif && transparent);
      mp4AlphaNote.hidden = !(a.format === 'mp4' && transparent);
    },
  });
  return section('export.anim.format', 'Format & background', [
    format.el,
    ...unsupportedNotes,
    quality.el,
    dither.el,
    palette.el,
    paletteNote,
    background.el,
    gifAlphaNote,
    mp4AlphaNote,
  ]);
}
