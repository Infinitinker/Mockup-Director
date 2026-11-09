/**
 * "Scene" tab: camera, light, shadow, reflection and preview background.
 */
import type { BackgroundSettings, CameraSettings, LightSettings, SceneSettings } from '../../core/types';
import { LIGHT_PRESETS } from '../../scene/lightPresets';
import type { AppContext } from '../context';
import { h } from '../dom';
import {
  colorControl,
  headerSwitch,
  numberControl,
  section,
  segmentedControl,
  selectControl,
  type Control,
} from '../controls';
import { hasAny } from '../state';

const CUSTOM = '__custom';

function lightEquals(a: LightSettings, b: LightSettings): boolean {
  return (
    Math.abs(a.azimuth - b.azimuth) < 1e-6 &&
    Math.abs(a.elevation - b.elevation) < 1e-6 &&
    Math.abs(a.intensity - b.intensity) < 1e-6 &&
    Math.abs(a.ambient - b.ambient) < 1e-6 &&
    Math.abs(a.environment - b.environment) < 1e-6 &&
    a.color.toLowerCase() === b.color.toLowerCase()
  );
}

export function createScenePanel(ctx: AppContext): { el: HTMLElement } {
  const el = h('div', { class: 'panel panel-scene' });
  const controls: Control[] = [];

  const scene = () => ctx.store.state.scene;
  const cam = <K extends keyof CameraSettings>(k: K, v: CameraSettings[K]) =>
    ctx.store.update(['camera'], (s) => {
      s.scene.camera = { ...s.scene.camera, [k]: v };
    });
  const upd = (fn: (s: SceneSettings) => void) => ctx.store.update(['scene'], (s) => fn(s.scene));

  const add = <T extends Control>(c: T): T => {
    controls.push(c);
    return c;
  };

  /* Camera ------------------------------------------------------- */
  const camSection = section('scene.camera', 'Camera', [
    add(
      numberControl({
        label: 'Rotation',
        min: -180,
        max: 180,
        step: 1,
        unit: '°',
        get: () => scene().camera.yaw,
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
        get: () => scene().camera.pitch,
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
        get: () => scene().camera.roll,
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
        get: () => scene().camera.projection,
        set: (v) => cam('projection', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Perspective strength (FOV)',
        title: 'Small = flat telephoto look, large = strong perspective',
        min: 5,
        max: 75,
        step: 1,
        unit: '°',
        get: () => scene().camera.fov,
        set: (v) => cam('fov', v),
        disabled: () => scene().camera.projection === 'orthographic',
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
        get: () => scene().camera.zoom,
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
        get: () => scene().camera.panX,
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
        get: () => scene().camera.panY,
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

  /* Light -------------------------------------------------------- */
  const presetOptions = [
    { value: CUSTOM, label: 'Custom' },
    ...LIGHT_PRESETS.map((p) => ({ value: p.id, label: p.label })),
  ];
  const lightChildren: (HTMLElement | null)[] = [];
  if (LIGHT_PRESETS.length) {
    lightChildren.push(
      add(
        selectControl({
          label: 'Light preset',
          options: presetOptions,
          get: () => LIGHT_PRESETS.find((p) => lightEquals(p.light, scene().light))?.id ?? CUSTOM,
          set: (id) => {
            const p = LIGHT_PRESETS.find((x) => x.id === id);
            if (!p) return;
            upd((s) => {
              s.light = { ...p.light };
              if (p.shadow) s.shadow = { ...s.shadow, ...p.shadow };
              if (p.reflection) s.reflection = { ...s.reflection, ...p.reflection };
            });
          },
        }),
      ).el,
    );
  }
  const light = <K extends keyof LightSettings>(k: K, v: LightSettings[K]) =>
    upd((s) => (s.light = { ...s.light, [k]: v }));
  lightChildren.push(
    add(
      numberControl({
        label: 'Direction (azimuth)',
        min: -180,
        max: 180,
        step: 1,
        unit: '°',
        get: () => scene().light.azimuth,
        set: (v) => light('azimuth', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Elevation',
        min: 0,
        max: 90,
        step: 1,
        unit: '°',
        get: () => scene().light.elevation,
        set: (v) => light('elevation', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Intensity',
        min: 0,
        max: 3,
        step: 0.01,
        factor: 100,
        unit: '%',
        decimals: 0,
        get: () => scene().light.intensity,
        set: (v) => light('intensity', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Ambient light',
        min: 0,
        max: 2,
        step: 0.01,
        factor: 100,
        unit: '%',
        decimals: 0,
        get: () => scene().light.ambient,
        set: (v) => light('ambient', v),
      }),
    ).el,
    add(
      numberControl({
        label: 'Environment reflections',
        title: 'Strength of studio reflections on glossy surfaces',
        min: 0,
        max: 2,
        step: 0.01,
        factor: 100,
        unit: '%',
        decimals: 0,
        get: () => scene().light.environment,
        set: (v) => light('environment', v),
      }),
    ).el,
    add(colorControl({ label: 'Light colour', get: () => scene().light.color, set: (v) => light('color', v) })).el,
  );
  const lightSection = section('scene.light', 'Light', lightChildren);

  /* Shadow ------------------------------------------------------- */
  const shadowOn = add(
    headerSwitch(
      'Shadow',
      () => scene().shadow.enabled,
      (v) => upd((s) => (s.shadow = { ...s.shadow, enabled: v })),
    ),
  );
  const shadowOff = () => !scene().shadow.enabled;
  const shadowSection = section(
    'scene.shadow',
    'Shadow',
    [
      add(
        numberControl({
          label: 'Opacity',
          min: 0,
          max: 1,
          step: 0.01,
          factor: 100,
          unit: '%',
          decimals: 0,
          disabled: shadowOff,
          get: () => scene().shadow.opacity,
          set: (v) => upd((s) => (s.shadow = { ...s.shadow, opacity: v })),
        }),
      ).el,
      add(
        numberControl({
          label: 'Softness',
          min: 0,
          max: 1,
          step: 0.01,
          factor: 100,
          unit: '%',
          decimals: 0,
          disabled: shadowOff,
          get: () => scene().shadow.softness,
          set: (v) => upd((s) => (s.shadow = { ...s.shadow, softness: v })),
        }),
      ).el,
    ],
    shadowOn.el,
  );

  /* Reflection --------------------------------------------------- */
  const reflOn = add(
    headerSwitch(
      'Reflection',
      () => scene().reflection.enabled,
      (v) => upd((s) => (s.reflection = { ...s.reflection, enabled: v })),
    ),
  );
  const reflOff = () => !scene().reflection.enabled;
  const reflSection = section(
    'scene.reflection',
    'Reflection',
    [
      add(
        numberControl({
          label: 'Opacity',
          min: 0,
          max: 1,
          step: 0.01,
          factor: 100,
          unit: '%',
          decimals: 0,
          disabled: reflOff,
          get: () => scene().reflection.opacity,
          set: (v) => upd((s) => (s.reflection = { ...s.reflection, opacity: v })),
        }),
      ).el,
      add(
        numberControl({
          label: 'Falloff',
          title: 'Part of the model height over which the reflection fades',
          min: 0.05,
          max: 1,
          step: 0.01,
          factor: 100,
          unit: '%',
          decimals: 0,
          disabled: reflOff,
          get: () => scene().reflection.falloff,
          set: (v) => upd((s) => (s.reflection = { ...s.reflection, falloff: v })),
        }),
      ).el,
      add(
        numberControl({
          label: 'Gap',
          min: 0,
          max: 20,
          step: 0.5,
          unit: 'mm',
          inputMax: 100,
          disabled: reflOff,
          get: () => scene().reflection.gap,
          set: (v) => upd((s) => (s.reflection = { ...s.reflection, gap: v })),
        }),
      ).el,
    ],
    reflOn.el,
  );

  /* Background --------------------------------------------------- */
  const bg = <K extends keyof BackgroundSettings>(k: K, v: BackgroundSettings[K]) =>
    upd((s) => (s.background = { ...s.background, [k]: v }));
  const bgSection = section('scene.background', 'Preview background', [
    add(
      segmentedControl<BackgroundSettings['mode']>({
        label: 'Mode',
        options: [
          { value: 'transparent', label: 'Transparent', title: 'Transparent (checkerboard)' },
          { value: 'color', label: 'Colour' },
          { value: 'gradient', label: 'Gradient' },
        ],
        get: () => scene().background.mode,
        set: (v) => bg('mode', v),
      }),
    ).el,
    add(
      colorControl({
        label: 'Colour (centre)',
        get: () => scene().background.color,
        set: (v) => bg('color', v),
        disabled: () => scene().background.mode === 'transparent',
      }),
    ).el,
    add(
      colorControl({
        label: 'Colour (edges)',
        get: () => scene().background.color2,
        set: (v) => bg('color2', v),
        disabled: () => scene().background.mode !== 'gradient',
      }),
    ).el,
    h('p', {
      class: 'ctl-note',
      text: 'The preview background can also be used for export (Export → Background: As preview).',
    }),
  ]);

  el.append(camSection, lightSection, shadowSection, reflSection, bgSection);

  ctx.store.subscribe((e) => {
    if (hasAny(e, 'scene', 'camera'))
      controls.forEach((c) => {
        c.sync();
      });
  });
  return { el };
}
