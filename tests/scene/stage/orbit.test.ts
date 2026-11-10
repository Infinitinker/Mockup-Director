/**
 * Tests the viewport gestures in src/scene/stage/orbit.ts: the math of orbiting, panning, pinching, zooming at the
 * cursor and resetting, and the gestures on a fake canvas (pointers, wheel, Safari's gesture events, double-click).
 */
import { describe, expect, it } from 'vitest';
import type { CameraSettings } from '../../../src/core/types/scene';
import {
  attachOrbit,
  orbitCamera,
  panCamera,
  pinchCamera,
  resetZoomPan,
  screenPoint,
  wheelZoomFactor,
  zoomCameraAt,
} from '../../../src/scene/stage/orbit';

const camera = (changes: Partial<CameraSettings> = {}): CameraSettings => ({
  yaw: 0,
  pitch: 10,
  roll: 0,
  fov: 24,
  projection: 'perspective',
  zoom: 1,
  panX: 0,
  panY: 0,
  ...changes,
});

describe('orbitCamera', () => {
  it('turns the yaw against the drag by 0.35° a pixel and the pitch with it', () => {
    const cam = camera();
    orbitCamera(cam, 10, 4);
    expect(cam.yaw).toBeCloseTo(-3.5, 12);
    expect(cam.pitch).toBeCloseTo(11.4, 12);
  });

  it('wraps the yaw past ±180 and stops the pitch at ±89', () => {
    const cam = camera({ yaw: -178, pitch: 88 });
    orbitCamera(cam, 10, 10);
    expect(cam.yaw).toBeCloseTo(178.5, 12);
    expect(cam.pitch).toBe(89);
    orbitCamera(cam, 0, -1000);
    expect(cam.pitch).toBe(-89);
  });
});

describe('panCamera', () => {
  it('pans by 1 for half the view and moves down with the drag', () => {
    const cam = camera();
    panCamera(cam, 400, 150, 800, 600);
    expect(cam.panX).toBe(1);
    expect(cam.panY).toBe(-0.5);
  });

  it('limits the pan to ±1', () => {
    const cam = camera({ panX: 0.5, panY: -0.5 });
    panCamera(cam, 10000, 10000, 800, 600);
    expect([cam.panX, cam.panY]).toEqual([1, -1]);
    panCamera(cam, -10000, -10000, 800, 600);
    expect([cam.panX, cam.panY]).toEqual([-1, 1]);
  });
});

describe('pinchCamera', () => {
  it('zooms by the ratio of the finger distances and pans by the midpoint', () => {
    const cam = camera({ zoom: 1.5 });
    pinchCamera(cam, { dist: 100, mx: 0, my: 0 }, { dist: 150, mx: 40, my: 30 }, 800, 600);
    expect(cam.zoom).toBeCloseTo(2.25, 12);
    expect(cam.panX).toBeCloseTo(0.1, 12);
    expect(cam.panY).toBeCloseTo(-0.1, 12);
  });

  it('leaves the zoom alone when a distance is zero, and keeps it within its limits', () => {
    const cam = camera({ zoom: 2 });
    pinchCamera(cam, { dist: 0, mx: 0, my: 0 }, { dist: 50, mx: 0, my: 0 }, 800, 600);
    expect(cam.zoom).toBe(2);
    pinchCamera(cam, { dist: 1, mx: 0, my: 0 }, { dist: 100, mx: 0, my: 0 }, 800, 600);
    expect(cam.zoom).toBe(8);
    pinchCamera(cam, { dist: 1000, mx: 0, my: 0 }, { dist: 1, mx: 0, my: 0 }, 800, 600);
    expect(cam.zoom).toBe(0.2);
  });
});

describe('screenPoint', () => {
  it('maps the view from -1 to 1, with +y up', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(screenPoint(300, 150, rect)).toEqual({ x: 0, y: -0 });
    expect(screenPoint(100, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(screenPoint(500, 250, rect)).toEqual({ x: 1, y: -1 });
  });

  it('treats a view narrower than a pixel as one pixel', () => {
    expect(screenPoint(1, 1, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 1, y: -1 });
  });
});

describe('zoomCameraAt', () => {
  it('keeps the point under the cursor where it is', () => {
    const cam = camera({ zoom: 1.2, panX: 0.1, panY: -0.05 });
    const [sx, sy] = [0.5, -0.25];
    const p = [(sx - cam.panX) / cam.zoom, (sy - cam.panY) / cam.zoom];
    expect(zoomCameraAt(cam, sx, sy, 1.25)).toBe(true);
    expect(cam.zoom).toBeCloseTo(1.5, 12);
    expect(cam.zoom * p[0] + cam.panX).toBeCloseTo(sx, 12);
    expect(cam.zoom * p[1] + cam.panY).toBeCloseTo(sy, 12);
  });

  it('stops at the zoom limits and changes nothing at a limit', () => {
    const cam = camera({ zoom: 0.25 });
    expect(zoomCameraAt(cam, 0, 0, 0.5)).toBe(true);
    expect(cam.zoom).toBe(0.2);
    const atMax = camera({ zoom: 8, panX: 0.3 });
    expect(zoomCameraAt(atMax, 0.9, 0.9, 2)).toBe(false);
    expect(atMax).toEqual(camera({ zoom: 8, panX: 0.3 }));
  });

  it('limits the pan to ±1', () => {
    const cam = camera({ zoom: 1 });
    zoomCameraAt(cam, 1, -1, 8);
    expect([cam.panX, cam.panY]).toEqual([-1, 1]);
  });
});

describe('wheelZoomFactor', () => {
  it('zooms out when scrolling down and in when scrolling up', () => {
    expect(wheelZoomFactor(100, 0, false, 600)).toBeCloseTo(Math.exp(-0.15), 12);
    expect(wheelZoomFactor(-100, 0, false, 600)).toBeCloseTo(Math.exp(0.15), 12);
  });

  it('counts lines as 16 pixels and pages as the view height', () => {
    expect(wheelZoomFactor(3, 1, false, 600)).toBeCloseTo(Math.exp(-48 * 0.0015), 12);
    expect(wheelZoomFactor(0.5, 2, false, 100)).toBeCloseTo(Math.exp(-50 * 0.0015), 12);
  });

  it('zooms faster for a trackpad pinch (ctrl) and limits a delta to 200', () => {
    expect(wheelZoomFactor(10, 0, true, 600)).toBeCloseTo(Math.exp(-0.1), 12);
    expect(wheelZoomFactor(1000, 0, false, 600)).toBeCloseTo(Math.exp(-0.3), 12);
    expect(wheelZoomFactor(-5, 2, true, 600)).toBeCloseTo(Math.exp(2), 12);
  });
});

describe('resetZoomPan', () => {
  it('resets zoom and pan but not the angle', () => {
    const cam = camera({ yaw: 40, zoom: 2, panX: 0.5, panY: -0.2 });
    expect(resetZoomPan(cam)).toBe(true);
    expect(cam).toEqual(camera({ yaw: 40 }));
  });

  it('changes nothing when they already are reset', () => {
    expect(resetZoomPan(camera({ yaw: 40 }))).toBe(false);
  });
});

/** The parts of a canvas the gestures use, on Node's EventTarget. */
class FakeCanvas extends EventTarget {
  readonly style = { cursor: 'grab' };
  readonly captured = new Set<number>();
  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
}

/** A cancelable event of `type` with the given properties. */
function event(type: string, properties: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), properties);
}

const mouse = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  event(type, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, ...extra });

const touch = (type: string, id: number, x: number, y: number) =>
  event(type, { pointerId: id, pointerType: 'touch', button: 0, buttons: 1, clientX: x, clientY: y });

function setUp() {
  const canvas = new FakeCanvas();
  const abort = new AbortController();
  const state = { cam: camera(), changes: 0 };
  const orbit = attachOrbit(canvas as unknown as HTMLCanvasElement, {
    signal: abort.signal,
    camera: () => state.cam,
    viewSize: () => ({ w: 800, h: 600 }),
    changed: () => {
      state.changes++;
    },
  });
  const send = (e: Event) => {
    canvas.dispatchEvent(e);
    return e;
  };
  return { canvas, abort, state, orbit, send };
}

describe('attachOrbit', () => {
  it('orbits with a left drag and grabs the pointer while it is down', () => {
    const { canvas, state, orbit, send } = setUp();
    expect(send(mouse('pointerdown', 100, 100)).defaultPrevented).toBe(true);
    expect(canvas.style.cursor).toBe('grabbing');
    expect(canvas.captured.has(1)).toBe(true);
    expect(orbit.isActive()).toBe(true);

    send(mouse('pointermove', 110, 104));
    expect(state.cam.yaw).toBeCloseTo(-3.5, 12);
    expect(state.cam.pitch).toBeCloseTo(11.4, 12);
    expect(state.changes).toBe(1);

    send(mouse('pointermove', 110, 104));
    expect(state.changes).toBe(1);

    send(mouse('pointerup', 110, 104));
    expect(canvas.style.cursor).toBe('grab');
    expect(canvas.captured.size).toBe(0);
    expect(orbit.isActive()).toBe(false);
    send(mouse('pointermove', 200, 200));
    expect(state.changes).toBe(1);
  });

  it('reads the camera at every event', () => {
    const { state, send } = setUp();
    send(mouse('pointerdown', 0, 0));
    const replaced = camera({ yaw: 20 });
    state.cam = replaced;
    send(mouse('pointermove', 10, 0));
    expect(replaced.yaw).toBeCloseTo(16.5, 12);
  });

  it('pans with the right or middle button and with shift', () => {
    for (const extra of [
      { button: 2, buttons: 2 },
      { button: 1, buttons: 4 },
      { button: 0, buttons: 1, shiftKey: true },
    ]) {
      const { state, send } = setUp();
      send(mouse('pointerdown', 0, 0, extra));
      send(mouse('pointermove', 400, 150, extra));
      expect([state.cam.panX, state.cam.panY, state.cam.yaw]).toEqual([1, -0.5, 0]);
    }
  });

  it('ignores mouse buttons beyond the third, and blocks the context menu', () => {
    const { orbit, send } = setUp();
    expect(send(mouse('pointerdown', 0, 0, { button: 3 })).defaultPrevented).toBe(false);
    expect(orbit.isActive()).toBe(false);
    expect(send(event('contextmenu')).defaultPrevented).toBe(true);
  });

  it('pinches and pans with two fingers', () => {
    const { state, send } = setUp();
    send(touch('pointerdown', 1, 0, 0));
    send(touch('pointerdown', 2, 100, 0));
    send(touch('pointermove', 2, 200, 0));
    expect(state.cam.zoom).toBe(2);
    expect(state.cam.panX).toBeCloseTo(50 / 400, 12);
    expect(state.cam.yaw).toBe(0);

    // Lifting one finger ends the pinch; the other one orbits again.
    send(touch('pointerup', 2, 200, 0));
    send(touch('pointermove', 1, 10, 0));
    expect(state.cam.yaw).toBeCloseTo(-3.5, 12);
    expect(state.cam.zoom).toBe(2);
  });

  it('zooms at the cursor with the wheel and blocks the page zoom', () => {
    const { state, send } = setUp();
    const wheel = send(event('wheel', { deltaY: -100, deltaMode: 0, ctrlKey: false, clientX: 600, clientY: 150 }));
    expect(wheel.defaultPrevented).toBe(true);
    expect(state.cam.zoom).toBeCloseTo(Math.exp(0.15), 12);
    const [sx, sy] = [0.5, 0.5];
    expect(state.cam.panX).toBeCloseTo(sx - state.cam.zoom * sx, 12);
    expect(state.cam.panY).toBeCloseTo(sy - state.cam.zoom * sy, 12);
    expect(state.changes).toBe(1);
  });

  it("zooms with Safari's trackpad gesture and ignores the wheel meanwhile", () => {
    const { state, orbit, send } = setUp();
    expect(send(event('gesturestart')).defaultPrevented).toBe(true);
    expect(orbit.isActive()).toBe(true);
    send(event('wheel', { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 400, clientY: 300 }));
    expect(state.cam.zoom).toBe(1);

    send(event('gesturechange', { scale: 1.5, clientX: 400, clientY: 300 }));
    send(event('gesturechange', { scale: 3, clientX: 400, clientY: 300 }));
    expect(state.cam.zoom).toBeCloseTo(3, 12);
    send(event('gesturechange', { scale: 0, clientX: 400, clientY: 300 }));
    expect(state.cam.zoom).toBeCloseTo(3, 12);

    send(event('gestureend'));
    expect(orbit.isActive()).toBe(false);
  });

  it('resets zoom and pan on double-click', () => {
    const { state, send } = setUp();
    state.cam = camera({ yaw: 30, zoom: 3, panX: 0.2 });
    send(event('dblclick'));
    expect(state.cam).toEqual(camera({ yaw: 30 }));
    expect(state.changes).toBe(1);
    send(event('dblclick'));
    expect(state.changes).toBe(1);
  });

  it('forgets the pointers on cancel but keeps a running trackpad gesture', () => {
    const { canvas, orbit, send } = setUp();
    send(mouse('pointerdown', 0, 0));
    orbit.cancel();
    expect(canvas.style.cursor).toBe('grab');
    expect(orbit.isActive()).toBe(false);

    send(event('gesturestart'));
    orbit.cancel();
    expect(orbit.isActive()).toBe(true);
  });

  it('stops listening when the signal aborts', () => {
    const { abort, state, orbit, send } = setUp();
    abort.abort();
    send(mouse('pointerdown', 0, 0));
    send(mouse('pointermove', 10, 0));
    send(event('dblclick'));
    expect(orbit.isActive()).toBe(false);
    expect(state.changes).toBe(0);
  });
});
