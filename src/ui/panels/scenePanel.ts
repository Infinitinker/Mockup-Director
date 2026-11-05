/**
 * "Scena" tab: camera, light, shadow, reflection and preview background.
 */
import type { BackgroundSettings, CameraSettings, LightSettings, SceneSettings } from '../../core/types';
import { LIGHT_PRESETS } from '../../scene/lightPresets';
import type { AppContext } from '../context';
import { lt, t } from '../i18n';
import { h } from '../dom';
import { colorControl, headerSwitch, numberControl, section, segmentedControl, selectControl, type Control } from '../controls';
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

export function createScenePanel(ctx: AppContext): { el: HTMLElement; render(): void } {
  const el = h('div', { class: 'panel panel-scene' });
  let controls: Control[] = [];

  const scene = () => ctx.store.state.scene;
  const cam = <K extends keyof CameraSettings>(k: K, v: CameraSettings[K]) =>
    ctx.store.update(['camera'], (s) => {
      s.scene.camera = { ...s.scene.camera, [k]: v };
    });
  const upd = (fn: (s: SceneSettings) => void) => ctx.store.update(['scene'], (s) => fn(s.scene));

  const render = () => {
    el.replaceChildren();
    controls = [];
    const add = <T extends Control>(c: T): T => {
      controls.push(c);
      return c;
    };

    /* Camera ------------------------------------------------------- */
    const camSection = section('scene.camera', t('camera'), [
      add(numberControl({ label: t('yaw'), min: -180, max: 180, step: 1, unit: '°', get: () => scene().camera.yaw, set: (v) => cam('yaw', v) })).el,
      add(numberControl({ label: t('pitch'), min: -30, max: 89, step: 1, unit: '°', inputMin: -89, get: () => scene().camera.pitch, set: (v) => cam('pitch', v) })).el,
      add(numberControl({ label: t('roll'), min: -45, max: 45, step: 0.5, unit: '°', inputMin: -180, inputMax: 180, get: () => scene().camera.roll, set: (v) => cam('roll', v) })).el,
      add(
        segmentedControl<CameraSettings['projection']>({
          label: t('projection'),
          options: [
            { value: 'perspective', label: t('perspective') },
            { value: 'orthographic', label: t('orthographic') },
          ],
          get: () => scene().camera.projection,
          set: (v) => cam('projection', v),
        }),
      ).el,
      add(
        numberControl({
          label: t('fov'),
          title: t('fovHint'),
          min: 5,
          max: 75,
          step: 1,
          unit: '°',
          get: () => scene().camera.fov,
          set: (v) => cam('fov', v),
          disabled: () => scene().camera.projection === 'orthographic',
        }),
      ).el,
      add(numberControl({ label: t('zoom'), min: 0.3, max: 4, step: 0.01, factor: 100, unit: '%', decimals: 0, get: () => scene().camera.zoom, set: (v) => cam('zoom', v) })).el,
      add(numberControl({ label: t('panX'), min: -1, max: 1, step: 0.01, factor: 100, unit: '%', decimals: 0, get: () => scene().camera.panX, set: (v) => cam('panX', v) })).el,
      add(numberControl({ label: t('panY'), min: -1, max: 1, step: 0.01, factor: 100, unit: '%', decimals: 0, get: () => scene().camera.panY, set: (v) => cam('panY', v) })).el,
      h(
        'div',
        { class: 'ctl-actions' },
        h('button', { class: 'btn btn-small', text: t('resetView'), attrs: { type: 'button' }, on: { click: () => ctx.actions.resetView() } }),
      ),
    ]);

    /* Light -------------------------------------------------------- */
    const presetOptions = [{ value: CUSTOM, label: t('customLight') }, ...LIGHT_PRESETS.map((p) => ({ value: p.id, label: lt(p.label) }))];
    const lightChildren: (HTMLElement | null)[] = [];
    if (LIGHT_PRESETS.length) {
      lightChildren.push(
        add(
          selectControl({
            label: t('lightPreset'),
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
    const light = <K extends keyof LightSettings>(k: K, v: LightSettings[K]) => upd((s) => (s.light = { ...s.light, [k]: v }));
    lightChildren.push(
      add(numberControl({ label: t('azimuth'), min: -180, max: 180, step: 1, unit: '°', get: () => scene().light.azimuth, set: (v) => light('azimuth', v) })).el,
      add(numberControl({ label: t('elevation'), min: 0, max: 90, step: 1, unit: '°', get: () => scene().light.elevation, set: (v) => light('elevation', v) })).el,
      add(numberControl({ label: t('intensity'), min: 0, max: 3, step: 0.01, factor: 100, unit: '%', decimals: 0, get: () => scene().light.intensity, set: (v) => light('intensity', v) })).el,
      add(numberControl({ label: t('ambient'), min: 0, max: 2, step: 0.01, factor: 100, unit: '%', decimals: 0, get: () => scene().light.ambient, set: (v) => light('ambient', v) })).el,
      add(numberControl({ label: t('environment'), title: t('environmentHint'), min: 0, max: 2, step: 0.01, factor: 100, unit: '%', decimals: 0, get: () => scene().light.environment, set: (v) => light('environment', v) })).el,
      add(colorControl({ label: t('lightColor'), get: () => scene().light.color, set: (v) => light('color', v) })).el,
    );
    const lightSection = section('scene.light', t('light'), lightChildren);

    /* Shadow ------------------------------------------------------- */
    const shadowOn = add(headerSwitch(t('shadow'), () => scene().shadow.enabled, (v) => upd((s) => (s.shadow = { ...s.shadow, enabled: v }))));
    const shadowOff = () => !scene().shadow.enabled;
    const shadowSection = section(
      'scene.shadow',
      t('shadow'),
      [
        add(numberControl({ label: t('opacity'), min: 0, max: 1, step: 0.01, factor: 100, unit: '%', decimals: 0, disabled: shadowOff, get: () => scene().shadow.opacity, set: (v) => upd((s) => (s.shadow = { ...s.shadow, opacity: v })) })).el,
        add(numberControl({ label: t('softness'), min: 0, max: 1, step: 0.01, factor: 100, unit: '%', decimals: 0, disabled: shadowOff, get: () => scene().shadow.softness, set: (v) => upd((s) => (s.shadow = { ...s.shadow, softness: v })) })).el,
      ],
      shadowOn.el,
    );

    /* Reflection --------------------------------------------------- */
    const reflOn = add(headerSwitch(t('reflection'), () => scene().reflection.enabled, (v) => upd((s) => (s.reflection = { ...s.reflection, enabled: v }))));
    const reflOff = () => !scene().reflection.enabled;
    const reflSection = section(
      'scene.reflection',
      t('reflection'),
      [
        add(numberControl({ label: t('opacity'), min: 0, max: 1, step: 0.01, factor: 100, unit: '%', decimals: 0, disabled: reflOff, get: () => scene().reflection.opacity, set: (v) => upd((s) => (s.reflection = { ...s.reflection, opacity: v })) })).el,
        add(numberControl({ label: t('falloff'), title: t('falloffHint'), min: 0.05, max: 1, step: 0.01, factor: 100, unit: '%', decimals: 0, disabled: reflOff, get: () => scene().reflection.falloff, set: (v) => upd((s) => (s.reflection = { ...s.reflection, falloff: v })) })).el,
        add(numberControl({ label: t('gap'), min: 0, max: 20, step: 0.5, unit: 'mm', inputMax: 100, disabled: reflOff, get: () => scene().reflection.gap, set: (v) => upd((s) => (s.reflection = { ...s.reflection, gap: v })) })).el,
      ],
      reflOn.el,
    );

    /* Background --------------------------------------------------- */
    const bg = <K extends keyof BackgroundSettings>(k: K, v: BackgroundSettings[K]) => upd((s) => (s.background = { ...s.background, [k]: v }));
    const bgSection = section('scene.background', t('previewBackground'), [
      add(
        segmentedControl<BackgroundSettings['mode']>({
          label: t('mode'),
          options: [
            { value: 'transparent', label: t('bgTransparentShort'), title: t('bgTransparent') },
            { value: 'color', label: t('bgColor') },
            { value: 'gradient', label: t('bgGradient') },
          ],
          get: () => scene().background.mode,
          set: (v) => bg('mode', v),
        }),
      ).el,
      add(colorControl({ label: t('bgColor1'), get: () => scene().background.color, set: (v) => bg('color', v), disabled: () => scene().background.mode === 'transparent' })).el,
      add(colorControl({ label: t('bgColor2'), get: () => scene().background.color2, set: (v) => bg('color2', v), disabled: () => scene().background.mode !== 'gradient' })).el,
      h('p', { class: 'ctl-note', text: t('bgNote') }),
    ]);

    el.append(camSection, lightSection, shadowSection, reflSection, bgSection);
  };

  ctx.store.subscribe((e) => {
    if (e.kinds.has('lang')) render();
    else if (hasAny(e, 'scene', 'camera')) controls.forEach((c) => c.sync());
  });
  render();
  return { el, render };
}
