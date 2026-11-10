/**
 * The Scene tab's Camera section: rotation, tilt, roll, projection, field of view, zoom, pan and Reset view.
 */
import type { CameraSettings } from '../../../core/types/scene';
import type { AppContext } from '../../context';
import { h } from '../../dom';
import type { AddControl } from '../../controls';
import { numberControl } from '../../controls/number';
import { section } from '../../controls/section';
import { segmentedControl } from '../../controls/segmented';
import { sceneOf } from './settings';

/** The section; its controls are registered through `add`. */
export function cameraSection(ctx: AppContext, add: AddControl): HTMLElement {
  const cam = <K extends keyof CameraSettings>(k: K, v: CameraSettings[K]) =>
    ctx.store.update(['camera'], (s) => {
      s.scene.camera = { ...s.scene.camera, [k]: v };
    });
  return section('scene.camera', 'Camera', [
    add(
      numberControl({
        label: 'Rotation',
        min: -180,
        max: 180,
        step: 1,
        unit: '°',
        get: () => sceneOf(ctx).camera.yaw,
        set: (v) => cam('yaw', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Tilt',
        min: -30,
        max: 89,
        step: 1,
        unit: '°',
        inputMin: -89,
        get: () => sceneOf(ctx).camera.pitch,
        set: (v) => cam('pitch', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Roll',
        min: -45,
        max: 45,
        step: 0.5,
        unit: '°',
        inputMin: -180,
        inputMax: 180,
        get: () => sceneOf(ctx).camera.roll,
        set: (v) => cam('roll', v),
      }),
    ).el,
    add(
      segmentedControl<CameraSettings['projection']>({
        label: 'Projection',
        options: [
          { value: 'perspective', label: 'Perspective' },
          { value: 'orthographic', label: 'Orthographic' },
        ],
        get: () => sceneOf(ctx).camera.projection,
        set: (v) => cam('projection', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Perspective strength (FOV)',
        title: 'A small angle gives a flat telephoto look, a large one a strong perspective.',
        min: 5,
        max: 75,
        step: 1,
        unit: '°',
        get: () => sceneOf(ctx).camera.fov,
        set: (v) => cam('fov', v),
        disabled: () => sceneOf(ctx).camera.projection === 'orthographic',
      }),
    ).el,
    add(
      numberControl({
        label: 'Zoom',
        min: 0.3,
        max: 4,
        step: 0.01,
        factor: 100,
        unit: '%',
        decimals: 0,
        get: () => sceneOf(ctx).camera.zoom,
        set: (v) => cam('zoom', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Horizontal pan',
        min: -1,
        max: 1,
        step: 0.01,
        factor: 100,
        unit: '%',
        decimals: 0,
        get: () => sceneOf(ctx).camera.panX,
        set: (v) => cam('panX', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Vertical pan',
        min: -1,
        max: 1,
        step: 0.01,
        factor: 100,
        unit: '%',
        decimals: 0,
        get: () => sceneOf(ctx).camera.panY,
        set: (v) => cam('panY', v),
      }),
    ).el,
    h(
      'div',
      { class: 'ctl-actions' },
      h('button', {
        class: 'btn btn-small',
        text: 'Reset view',
        attrs: { type: 'button' },
        on: { click: () => ctx.actions.resetView() },
      }),
    ),
  ]);
}
