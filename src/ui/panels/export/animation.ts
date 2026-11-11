/**
 * The Animation export type of the Export tab (the turntable animation): its motion, its size, the summary and
 * the Export animation… button; the format section is in animationFormat.ts.
 */
import type { AnimationSettings } from '../../../core/types/export';
import { MAX_ANIMATION_DURATION, MIN_ANIMATION_DURATION } from '../../../core/defaults';
import { clamp } from '../../../core/math';
import { ANIMATION_FORMAT_LABEL, animationFormatSupport } from '../../../export/formats';
import { frameCountOf, maxFpsFor, maxMarginFor, maxSizeFor, outputSizeOf } from '../../../export/animation/settings';
import type { AppContext } from '../../context';
import type { AddControl } from '../../controls';
import { numberControl } from '../../controls/number';
import { section } from '../../controls/section';
import { segmentedControl } from '../../controls/segmented';
import { switchControl } from '../../controls/switch';
import { h } from '../../dom';
import { ICONS } from '../../icons';
import { formatNumber } from '../../numbers';
import { formatSection } from './animationFormat';
import { animationOf, updateAnimation } from './settings';
import { sizeRows, type AspectLock, type DimTarget } from './size';

const ANIM_SIZE_PRESETS = [480, 640, 800, 1080, 1200, 1920];

const USE_VIEW_HINT =
  'Off: the whole composition always fits. On: the preview’s zoom and pan are applied on top of the fixed framing, which may crop it.';

/** The sections of the Animation export type, and its button (its busy state is the tab's). */
export function animationSections(
  ctx: AppContext,
  dims: DimTarget,
  lock: AspectLock,
  add: AddControl,
): { parts: HTMLElement[]; animBtn: HTMLButtonElement } {
  const an = () => animationOf(ctx);
  const updA = (fn: (a: AnimationSettings) => void) => updateAnimation(ctx, fn);
  const support = animationFormatSupport();

  // Motion
  const motion = add(
    segmentedControl<AnimationSettings['motion']>({
      label: 'Motion type',
      options: [
        { value: 'loop', label: '360° turn' },
        { value: 'swing', label: 'Swing' },
      ],
      get: () => an().motion,
      set: (v) => updA((a) => (a.motion = v)),
    }),
  );
  const motionNote = h('p', { class: 'ctl-note' });
  add({
    el: motionNote,
    sync: () =>
      (motionNote.textContent =
        an().motion === 'loop'
          ? 'The model turns a full 360° at constant speed: the animation loops seamlessly.'
          : `The model turns back and forth by ±${an().swingAngle}° around the current view.`),
  });
  const swingAngle = add(
    numberControl({
      label: 'Swing angle (±)',
      min: 5,
      max: 90,
      step: 1,
      unit: '°',
      inputMin: 1,
      inputMax: 180,
      get: () => an().swingAngle,
      set: (v) => updA((a) => (a.swingAngle = Math.round(clamp(v, 1, 180)))),
    }),
  );
  const easing = add(
    segmentedControl<AnimationSettings['easing']>({
      label: 'Easing',
      options: [
        { value: 'sine', label: 'Smooth (sine)' },
        { value: 'linear', label: 'Linear' },
      ],
      get: () => an().easing,
      set: (v) => updA((a) => (a.easing = v)),
    }),
  );
  add({
    el: swingAngle.el,
    sync: () => {
      const swing = an().motion === 'swing';
      swingAngle.el.hidden = !swing;
      easing.el.hidden = !swing;
    },
  });
  const direction = add(
    segmentedControl<AnimationSettings['direction']>({
      label: 'Direction (seen from above)',
      options: [
        { value: 'cw', label: 'Clockwise' },
        { value: 'ccw', label: 'Counterclockwise' },
      ],
      get: () => an().direction,
      set: (v) => updA((a) => (a.direction = v)),
    }),
  );
  const duration = add(
    numberControl({
      label: 'Duration',
      min: MIN_ANIMATION_DURATION,
      max: MAX_ANIMATION_DURATION,
      step: 0.5,
      unit: 's',
      decimals: 1,
      get: () => an().duration,
      set: (v) =>
        updA((a) => (a.duration = clamp(Math.round(v * 10) / 10, MIN_ANIMATION_DURATION, MAX_ANIMATION_DURATION))),
    }),
  );
  const fps = add(
    numberControl({
      label: 'Frames per second',
      min: 5,
      max: maxFpsFor(an().format), // the panel is re-rendered when the format changes
      step: 1,
      unit: 'fps',
      inputMin: 1,
      get: () => an().fps,
      set: (v) => updA((a) => (a.fps = Math.round(clamp(v, 1, maxFpsFor(a.format))))),
    }),
  );
  const useView = add(
    switchControl({
      label: 'Zoom & pan from the preview',
      title: USE_VIEW_HINT,
      get: () => an().useViewZoomPan,
      set: (v) => updA((a) => (a.useViewZoomPan = v)),
    }),
  );
  const motionSection = section('export.anim.motion', 'Motion', [
    h('p', {
      class: 'ctl-note',
      text: 'The animation starts from the current view: the camera angle, light, shadow and reflection are kept, and the framing is fixed for all frames.',
    }),
    motion.el,
    motionNote,
    swingAngle.el,
    easing.el,
    direction.el,
    duration.el,
    fps.el,
    useView.el,
    h('p', { class: 'ctl-note', text: USE_VIEW_HINT }),
  ]);

  // Size
  const rows = sizeRows(ANIM_SIZE_PRESETS, dims, lock, add);
  const maxNote = h('p', { class: 'ctl-note' });
  add({
    el: maxNote,
    sync: () =>
      (maxNote.textContent = `${ANIMATION_FORMAT_LABEL[an().format]} allows at most ${maxSizeFor(an().format)} px per side.`),
  });
  const evenNote = h('p', { class: 'ctl-note warn-note' });
  add({
    el: evenNote,
    sync: () => {
      const a = an();
      const o = outputSizeOf(a);
      evenNote.hidden = !(a.format === 'mp4' && (o.width !== a.width || o.height !== a.height));
      evenNote.textContent = `MP4 needs even dimensions: the file will be ${o.width} × ${o.height} px.`;
    },
  });
  const margin = add(
    numberControl({
      label: 'Margin',
      min: 0,
      max: 200,
      step: 1,
      unit: 'px',
      inputMax: 944,
      get: () => an().margin,
      set: (v) => updA((a) => (a.margin = Math.round(clamp(v, 0, maxMarginFor(a.width, a.height))))),
    }),
  );
  const sizeSection = section('export.anim.size', 'Size', [
    h('div', { class: 'ctl' }, h('div', { class: 'ctl-label', text: 'Size presets (square)' }), rows.chips),
    rows.dims,
    maxNote,
    evenNote,
    margin.el,
  ]);

  const formatPart = formatSection(ctx, support, add);

  // Summary and button
  const summary = h('div', { class: 'export-summary' });
  add({
    el: summary,
    sync: () => {
      const a = an();
      const o = outputSizeOf(a);
      summary.textContent = `${o.width} × ${o.height} px · ${ANIMATION_FORMAT_LABEL[a.format]} · ${formatNumber(a.duration, a.duration % 1 ? 1 : 0)} s · Frames: ${frameCountOf(a)}`;
    },
  });
  const animBtn = h(
    'button',
    {
      class: 'btn btn-primary btn-large export-btn',
      title: 'Export animation…',
      attrs: { type: 'button' },
      on: { click: () => void ctx.actions.exportAnimation() },
    },
    h('span', { class: 'spinner small' }),
    h('span', { class: 'btn-icon', html: ICONS.exportImg }),
    h('span', { class: 'btn-text', text: 'Export animation…' }),
  );
  const footer = h('div', { class: 'export-footer' }, summary, animBtn);
  return { parts: [motionSection, sizeSection, formatPart, footer], animBtn };
}
