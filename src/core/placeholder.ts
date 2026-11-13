/**
 * Placeholder artwork for empty slots: a gradient with a frame (round for a disc) and the slot's
 * label, drawn once per slot id, aspect and shape, and cached as shared textures.
 */
import * as THREE from 'three';
import { UserError } from './errors';
import type { ImageSlotDef } from './types/model';
import { log } from '../platform/log';

const cache = new Map<string, THREE.Texture>();

/**
 * Neutral placeholder artwork for an empty slot: soft gradient, thin frame and the slot name.
 * Cached per slot; owned by this module (never disposed by models).
 */
export function getPlaceholderTexture(slot: ImageSlotDef): THREE.Texture {
  const circle = isCircularTemplate(slot);
  const key = `${slot.id}|${slot.aspect.toFixed(3)}|${circle ? 'c' : 'r'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const longSide = 1024;
  const aspect = Math.max(0.05, Math.min(20, slot.aspect));
  const w = aspect >= 1 ? longSide : Math.round(longSide * aspect);
  const h = aspect >= 1 ? Math.round(longSide / aspect) : longSide;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, w);
  canvas.height = Math.max(8, h);
  const g = canvas.getContext('2d');
  if (!g)
    throw new UserError('Not enough memory to draw the placeholder of an empty slot. Close other tabs and try again.');

  const grad = g.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, '#eef0f4');
  grad.addColorStop(1, '#c9ced8');
  g.fillStyle = grad;
  g.fillRect(0, 0, canvas.width, canvas.height);

  const s = Math.min(canvas.width, canvas.height);
  g.strokeStyle = 'rgba(70,80,100,0.35)';
  g.lineWidth = Math.max(2, s * 0.012);
  const inset = s * 0.04;
  if (circle) {
    g.beginPath();
    g.arc(canvas.width / 2, canvas.height / 2, s / 2 - inset, 0, Math.PI * 2);
    g.stroke();
  } else {
    g.strokeRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2);
  }

  const label = slot.label || slot.id;
  g.fillStyle = 'rgba(55,65,85,0.75)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let fontSize = Math.round(s * 0.11);
  g.font = `600 ${fontSize}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
  while (g.measureText(label).width > canvas.width * 0.85 && fontSize > 10) {
    fontSize -= 2;
    g.font = `600 ${fontSize}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
  }
  g.fillText(label, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.placeholder = true;
  cache.set(key, tex);
  return tex;
}

/**
 * True when the slot's template (object, or function resolved with default params) is a disc. A template
 * that throws is logged and counts as not round: the placeholder is only a stand-in.
 */
function isCircularTemplate(slot: ImageSlotDef): boolean {
  const t = slot.template;
  if (!t) return false;
  try {
    return !!(typeof t === 'function' ? t({}) : t).circle;
  } catch (e) {
    log.warn(`The print template of the slot ${slot.id} could not be made for its placeholder`, e);
    return false;
  }
}
