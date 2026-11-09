/**
 * "Artwork" tab: one card per artwork slot of the current model.
 */
import type { Artwork, ImageSlotDef } from '../../core/types';
import { getModel } from '../../models/registry';
import type { AppContext } from '../context';
import { formatNumber } from '../numbers';
import { h } from '../dom';
import { ICONS } from '../icons';
import { aspectMismatch, completeParams, expectedAspects } from '../modelUtils';
import { hasAny } from '../state';

/** Small cached thumbnails (data URLs of a downscaled copy) so re-renders don't decode huge images. */
const thumbCache = new WeakMap<Artwork, string>();
const THUMB = 240;

function thumbnailFor(a: Artwork): string {
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

export function createArtworkPanel(ctx: AppContext): { el: HTMLElement } {
  const el = h('div', { class: 'panel panel-artwork' });
  /** Re-checked on params changes (template size may depend on dimensions). */
  let warnUpdaters: (() => void)[] = [];

  const card = (slot: ImageSlotDef, modelId: string): HTMLElement => {
    const s = ctx.store.state;
    const asset = s.artwork[modelId]?.[slot.id];
    const loading = ctx.loadingSlots.value.has(`${modelId}/${slot.id}`);
    const thumb = h('div', { class: 'slot-thumb checkerboard' });
    if (asset)
      thumb.appendChild(h('img', { attrs: { src: thumbnailFor(asset), alt: asset.name, draggable: 'false' } }));
    else thumb.appendChild(h('span', { class: 'slot-empty-icon', html: ICONS.image }));
    if (loading) thumb.appendChild(h('span', { class: 'spinner', attrs: { 'aria-label': 'Loading…' } }));

    const badge = h('span', { class: 'warn-badge', html: ICONS.warn, attrs: { hidden: true } });
    badge.appendChild(h('span', { text: 'Aspect' }));
    thumb.appendChild(badge);

    const fileLine = asset
      ? h(
          'div',
          { class: 'slot-file', title: asset.name },
          h('span', { class: 'slot-filename', text: asset.name }),
          h('span', { class: 'slot-size', text: `${asset.width} × ${asset.height} px` }),
        )
      : h('div', { class: 'slot-file empty', text: 'No artwork: drop a file here.' });

    const actions = h(
      'div',
      { class: 'slot-actions' },
      h('button', {
        class: 'btn btn-small',
        text: 'Choose…',
        title: `Choose artwork for “${slot.label}”…`,
        attrs: { type: 'button' },
        on: { click: () => void ctx.actions.pickArtworkFor(slot.id) },
      }),
      asset
        ? h(
            'button',
            {
              class: 'btn btn-small btn-icon-only',
              title: 'Remove artwork',
              label: 'Remove artwork',
              attrs: { type: 'button' },
              on: { click: () => ctx.actions.removeArtwork(slot.id) },
            },
            h('span', { class: 'btn-icon', html: ICONS.trash }),
          )
        : null,
      slot.template
        ? h(
            'button',
            {
              class: 'btn btn-small',
              title: 'Download print template… (PNG, 300 dpi)',
              attrs: { type: 'button' },
              on: { click: () => void ctx.actions.downloadTemplate(slot.id) },
            },
            h('span', { class: 'btn-icon', html: ICONS.template }),
            h('span', { class: 'btn-text', text: 'Template…' }),
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
        h('div', { class: 'slot-name', text: slot.label }),
        slot.hint ? h('div', { class: 'slot-hint', text: slot.hint }) : null,
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
        badge.title = `Artwork aspect ratio (${formatNumber(asset.width / asset.height, 3)}) differs from the expected one (${exp}) by more than 3%: the artwork may look distorted.`;
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
      const file = Array.from(e.dataTransfer?.files ?? []).find(
        (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|svg)$/i.test(f.name),
      );
      // An empty list makes assignArtwork show an "unsupported file" hint.
      void ctx.actions.assignArtwork(file ? [file] : [], [slot.id]);
    });
    // Double-click on the thumbnail opens the file picker – a common shortcut in design tools.
    thumb.addEventListener('dblclick', () => void ctx.actions.pickArtworkFor(slot.id));
    return el;
  };

  const render = () => {
    el.replaceChildren();
    warnUpdaters = [];
    const s = ctx.store.state;
    const model = getModel(s.modelId);
    if (!model.slots.length) {
      el.appendChild(h('p', { class: 'empty-state', text: 'This model has no artwork slots.' }));
      return;
    }
    // Mention print templates only when this model actually offers one (screens/devices do not).
    const hasTemplates = model.slots.some((sl) => !!sl.template);
    el.appendChild(
      h('p', {
        class: 'panel-intro',
        text: hasTemplates
          ? 'Drop a file on a card or on the preview. A template is a 300 dpi PNG with trim and bleed guides.'
          : 'Drop a file on a card or on the preview.',
      }),
    );
    for (const slot of model.slots) el.appendChild(card(slot, model.id));
  };

  ctx.store.subscribe((e) => {
    if (hasAny(e, 'model', 'artwork')) render();
    else if (e.kinds.has('params'))
      warnUpdaters.forEach((u) => {
        u();
      });
  });
  ctx.loadingSlots.subscribe(() => render());
  render();
  return { el };
}
