/**
 * "Grafiki" tab: one card per image slot of the current model.
 */
import type { ImageAsset, ImageSlotDef } from '../../core/types';
import { getModel } from '../../models/registry';
import type { AppContext } from '../context';
import { formatNumber, lt, t } from '../i18n';
import { h } from '../dom';
import { ICONS } from '../icons';
import { aspectMismatch, completeParams, expectedAspects } from '../modelUtils';
import { hasAny } from '../state';

/** Small cached thumbnails (data URLs of a downscaled copy) so re-renders don't decode huge images. */
const thumbCache = new WeakMap<ImageAsset, string>();
const THUMB = 240;

function thumbnailFor(a: ImageAsset): string {
  const hit = thumbCache.get(a);
  if (hit) return hit;
  let url = a.dataUrl;
  try {
    const img = a.texture.image as unknown;
    const drawable =
      img instanceof HTMLImageElement ||
      img instanceof HTMLCanvasElement ||
      (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) ||
      (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas);
    if (drawable && a.width > 0 && a.height > 0) {
      const s = Math.min(1, THUMB / Math.max(a.width, a.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(a.width * s));
      c.height = Math.max(1, Math.round(a.height * s));
      const g = c.getContext('2d');
      if (g) {
        g.imageSmoothingQuality = 'high';
        // The source image is the original upright artwork (texture flipping happens on the GPU).
        g.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
        url = c.toDataURL('image/png');
      }
    }
  } catch {
    url = a.dataUrl;
  }
  thumbCache.set(a, url);
  return url;
}

export function createImagesPanel(ctx: AppContext): { el: HTMLElement; render(): void } {
  const el = h('div', { class: 'panel panel-images' });
  /** Re-checked on params changes (template size may depend on dimensions). */
  let warnUpdaters: (() => void)[] = [];

  const card = (slot: ImageSlotDef, modelId: string): HTMLElement => {
    const s = ctx.store.state;
    const asset = s.images[modelId]?.[slot.id];
    const loading = ctx.loadingSlots.value.has(`${modelId}/${slot.id}`);
    const thumb = h('div', { class: 'slot-thumb checkerboard' });
    if (asset) thumb.appendChild(h('img', { attrs: { src: thumbnailFor(asset), alt: asset.name, draggable: 'false' } }));
    else thumb.appendChild(h('span', { class: 'slot-empty-icon', html: ICONS.image }));
    if (loading) thumb.appendChild(h('span', { class: 'spinner', attrs: { 'aria-label': t('loading') } }));

    const badge = h('span', { class: 'warn-badge', html: ICONS.warn, attrs: { hidden: true } });
    badge.appendChild(h('span', { text: t('aspectBadge') }));
    thumb.appendChild(badge);

    const fileLine = asset
      ? h('div', { class: 'slot-file', title: asset.name }, h('span', { class: 'slot-filename', text: asset.name }), h('span', { class: 'slot-size', text: `${asset.width} × ${asset.height} px` }))
      : h('div', { class: 'slot-file empty', text: t('noImage') });

    const actions = h(
      'div',
      { class: 'slot-actions' },
      h('button', {
        class: 'btn btn-small',
        text: t('choose'),
        title: t('chooseImageFor', { name: lt(slot.label) }),
        attrs: { type: 'button' },
        on: { click: () => void ctx.actions.pickImageFor(slot.id) },
      }),
      asset
        ? h(
            'button',
            {
              class: 'btn btn-small btn-icon-only',
              title: t('removeImage'),
              label: t('removeImage'),
              attrs: { type: 'button' },
              on: { click: () => ctx.actions.removeImage(slot.id) },
            },
            h('span', { class: 'btn-icon', html: ICONS.trash }),
          )
        : null,
      slot.template
        ? h(
            'button',
            {
              class: 'btn btn-small',
              title: t('templateTitle'),
              attrs: { type: 'button' },
              on: { click: () => void ctx.actions.downloadTemplate(slot.id) },
            },
            h('span', { class: 'btn-icon', html: ICONS.template }),
            h('span', { class: 'btn-text', text: t('template') }),
          )
        : null,
    );

    const el = h(
      'div',
      { class: `slot-card${asset ? ' filled' : ''}`, attrs: { 'data-slot': slot.id } },
      thumb,
      h(
        'div',
        { class: 'slot-info' },
        h('div', { class: 'slot-name', text: lt(slot.label) }),
        slot.hint ? h('div', { class: 'slot-hint', text: lt(slot.hint) }) : null,
        fileLine,
        actions,
      ),
    );

    // Aspect-ratio warning.
    const updateWarn = () => {
      if (!asset) return;
      const model = getModel(modelId);
      const params = completeParams(model, ctx.store.state.params[modelId]);
      const expected = expectedAspects(slot, params);
      const bad = aspectMismatch(asset.width, asset.height, expected);
      badge.hidden = !bad;
      el.classList.toggle('warn', bad);
      if (bad) {
        const exp = expected.map((x) => formatNumber(x, 3)).join(' / ');
        badge.title = t('aspectWarning', { actual: formatNumber(asset.width / asset.height, 3), expected: exp });
      }
    };
    updateWarn();
    warnUpdaters.push(updateWarn);

    // Drag & drop directly onto the card.
    let depth = 0;
    el.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      depth += 1;
      el.classList.add('drop-target');
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) el.classList.remove('drop-target');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      el.classList.remove('drop-target');
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|svg)$/i.test(f.name));
      // An empty list makes assignImages show an "unsupported file" hint.
      void ctx.actions.assignImages(file ? [file] : [], [slot.id]);
    });
    // Double-click on the thumbnail opens the file picker – a common shortcut in design tools.
    thumb.addEventListener('dblclick', () => void ctx.actions.pickImageFor(slot.id));
    return el;
  };

  const render = () => {
    el.replaceChildren();
    warnUpdaters = [];
    const s = ctx.store.state;
    const model = getModel(s.modelId);
    if (!model.slots.length) {
      el.appendChild(h('p', { class: 'empty-state', text: t('noSlots') }));
      return;
    }
    el.appendChild(h('p', { class: 'panel-intro', text: t('imagesIntro') }));
    for (const slot of model.slots) el.appendChild(card(slot, model.id));
  };

  ctx.store.subscribe((e) => {
    if (hasAny(e, 'model', 'images', 'lang')) render();
    else if (e.kinds.has('params')) warnUpdaters.forEach((u) => u());
  });
  ctx.loadingSlots.subscribe(() => render());
  render();
  return { el, render };
}
