/**
 * Viewport gestures: orbit the camera by dragging, pan with the right or middle button, shift-drag or two fingers,
 * zoom at the cursor with the wheel, a trackpad pinch (including Safari's gesture events) or a two-finger pinch, and
 * reset zoom and pan on double-click. The math of each gesture is a function of the camera settings, which it
 * changes in place.
 */
import * as THREE from 'three';
import type { CameraSettings } from '../../core/types/scene';
import { PITCH_LIMIT, ZOOM_MAX, ZOOM_MIN, wrapDeg } from '../camera';
import { log } from '../../platform/log';

const ORBIT_DEG_PER_PX = 0.35;

/** Two fingers on the screen: their distance and midpoint, in client pixels. */
export interface PinchState {
  dist: number;
  mx: number;
  my: number;
}

/** Turntable: drag right turns the product to the right (camera moves left). */
export function orbitCamera(cam: CameraSettings, dx: number, dy: number): void {
  cam.yaw = wrapDeg(cam.yaw - dx * ORBIT_DEG_PER_PX);
  cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * ORBIT_DEG_PER_PX, -PITCH_LIMIT, PITCH_LIMIT);
}

/** Pan by a drag of `dx` × `dy` pixels in a `w` × `h` view: half the view's width or height is a pan of 1. */
export function panCamera(cam: CameraSettings, dx: number, dy: number, w: number, h: number): void {
  cam.panX = THREE.MathUtils.clamp(cam.panX + dx / (w / 2), -1, 1);
  cam.panY = THREE.MathUtils.clamp(cam.panY - dy / (h / 2), -1, 1);
}

/** Two fingers moved from `prev` to `now`: pinch = zoom, move = pan. */
export function pinchCamera(cam: CameraSettings, prev: PinchState, now: PinchState, w: number, h: number): void {
  if (prev.dist > 0 && now.dist > 0) {
    cam.zoom = THREE.MathUtils.clamp(cam.zoom * (now.dist / prev.dist), ZOOM_MIN, ZOOM_MAX);
  }
  cam.panX = THREE.MathUtils.clamp(cam.panX + (now.mx - prev.mx) / (w / 2), -1, 1);
  cam.panY = THREE.MathUtils.clamp(cam.panY - (now.my - prev.my) / (h / 2), -1, 1);
}

/** A client position in the view, from -1 to 1 across it, with +y up. */
export function screenPoint(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
    y: -(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1),
  };
}

/**
 * Zoom by `factor` keeping the point at (`sx`, `sy`) of the view (as screenPoint gives it) fixed, as far as the pan
 * range allows. Returns false, leaving the camera as it was, when the zoom is already at its limit.
 */
export function zoomCameraAt(cam: CameraSettings, sx: number, sy: number, factor: number): boolean {
  const z2 = THREE.MathUtils.clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (z2 === cam.zoom) return false;
  // Screen position = zoom * p + pan  ->  keep the cursor's p fixed.
  const r = z2 / cam.zoom;
  cam.panX = THREE.MathUtils.clamp(sx - r * (sx - cam.panX), -1, 1);
  cam.panY = THREE.MathUtils.clamp(sy - r * (sy - cam.panY), -1, 1);
  cam.zoom = z2;
  return true;
}

/** The zoom factor of a wheel event; `pageHeight` is the view's height, for deltas in pages. */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean, pageHeight: number): number {
  let dy = deltaY;
  if (deltaMode === 1) dy *= 16;
  else if (deltaMode === 2) dy *= pageHeight;
  // ctrlKey = trackpad pinch in Chromium/Firefox – deltas are small, so use a stronger factor.
  const k = ctrlKey ? 0.01 : 0.0015;
  return Math.exp(-THREE.MathUtils.clamp(dy, -200, 200) * k);
}

/** Reset zoom and pan (not the angle). Returns false when they already are. */
export function resetZoomPan(cam: CameraSettings): boolean {
  if (cam.zoom === 1 && cam.panX === 0 && cam.panY === 0) return false;
  cam.zoom = 1;
  cam.panX = 0;
  cam.panY = 0;
  return true;
}

/** What the gestures need from the stage. */
export interface OrbitOptions {
  /** Removes the listeners when aborted. */
  signal: AbortSignal;
  /** The camera the gestures change, read at every event (the stage replaces it when settings are applied). */
  camera(): CameraSettings;
  /** The view's size in CSS pixels. */
  viewSize(): { w: number; h: number };
  /** Called after a gesture changed the camera. */
  changed(): void;
}

/** The gestures on a canvas. */
export interface Orbit {
  /** Whether a pointer is down or a Safari trackpad gesture runs. */
  isActive(): boolean;
  /** Forget the pointers down (the animation export freezes the viewport); a running trackpad gesture stays. */
  cancel(): void;
}

/** Safari's non-standard trackpad pinch event. */
interface GestureLikeEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/** Listen for the viewport gestures on `canvas` until `options.signal` aborts. */
export function attachOrbit(canvas: HTMLCanvasElement, options: OrbitOptions): Orbit {
  const on = <K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Window,
    type: K | string,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts: AddEventListenerOptions = {},
  ) => el.addEventListener(type, fn as EventListener, { ...opts, signal: options.signal });

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: PinchState | null = null;
  // Capturing runs on every press: only the first failure is logged. Without it a drag still works
  // while the pointer stays over the view.
  let captureFailed = false;
  const captureFailure = (action: string, e: unknown) => {
    if (captureFailed) return;
    captureFailed = true;
    log.warn(`Cannot ${action} the pointer of the 3D view`, e);
  };
  let gestureActive = false;
  let gestureLastScale = 1;

  /** Zoom by `factor` keeping the point under the cursor fixed (as far as the pan range allows). */
  function zoomAt(clientX: number, clientY: number, factor: number): void {
    const { x, y } = screenPoint(clientX, clientY, canvas.getBoundingClientRect());
    if (zoomCameraAt(options.camera(), x, y, factor)) options.changed();
  }

  function pinchState(): PinchState {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  on(canvas, 'pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      captureFailure('capture', err);
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinch = pinchState();
    canvas.style.cursor = 'grabbing';
  });

  on(canvas, 'pointermove', (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (dx === 0 && dy === 0) return;
    const cam = options.camera();
    const { w, h } = options.viewSize();

    if (pointers.size >= 2) {
      // Two fingers: pinch = zoom, move = pan.
      if (!pinch) {
        pinch = pinchState();
        return;
      }
      const now = pinchState();
      pinchCamera(cam, pinch, now, w, h);
      pinch = now;
      options.changed();
      return;
    }

    const panMode = e.pointerType === 'mouse' && ((e.buttons & 6) !== 0 || e.shiftKey);
    if (panMode) panCamera(cam, dx, dy, w, h);
    else orbitCamera(cam, dx, dy);
    options.changed();
  });

  const endPointer = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      captureFailure('release', err);
    }
    pinch = pointers.size >= 2 ? pinchState() : null;
    if (pointers.size === 0) canvas.style.cursor = 'grab';
  };
  on(canvas, 'pointerup', endPointer);
  on(canvas, 'pointercancel', endPointer);
  on(canvas, 'lostpointercapture', endPointer);
  on(canvas, 'contextmenu', (e: MouseEvent) => e.preventDefault());

  on(
    canvas,
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault(); // also blocks browser pinch-zoom (ctrl+wheel)
      if (gestureActive) return;
      const pageHeight = e.deltaMode === 2 ? options.viewSize().h : 0;
      zoomAt(e.clientX, e.clientY, wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey, pageHeight));
    },
    { passive: false },
  );

  // Safari / WKWebView trackpad pinch (non-standard GestureEvent). Harmless elsewhere.
  on(canvas, 'gesturestart', (e: Event) => {
    e.preventDefault();
    gestureActive = true;
    gestureLastScale = 1;
  });
  on(canvas, 'gesturechange', (e: Event) => {
    e.preventDefault();
    const g = e as GestureLikeEvent;
    if (!(g.scale > 0)) return;
    zoomAt(g.clientX, g.clientY, g.scale / gestureLastScale);
    gestureLastScale = g.scale;
  });
  on(canvas, 'gestureend', (e: Event) => {
    e.preventDefault();
    gestureActive = false;
  });

  on(canvas, 'dblclick', (e: MouseEvent) => {
    e.preventDefault();
    if (resetZoomPan(options.camera())) options.changed();
  });

  return {
    isActive: () => pointers.size > 0 || gestureActive,
    cancel() {
      pointers.clear();
      pinch = null;
      canvas.style.cursor = 'grab';
    },
  };
}
