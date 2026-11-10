/**
 * Tests the looks in src/project/looks.ts: validating untrusted looks and looks files, the built-in
 * looks, making a look from the scene and applying one to it, unique names, and storing the
 * user's looks (with a fake storage): what a stored value means, when it is written back, and when
 * a failed save warns.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE, cloneScene } from '../../src/core/defaults';
import type { KeyValueStorage, Look } from '../../src/core/types/project';
import type { CameraSettings, SceneSettings } from '../../src/core/types/scene';
import {
  BUILTIN_LOOKS,
  LOOKS_KEY,
  LOOKS_VERSION,
  LooksError,
  MAX_LOOK_NAME,
  applyLook,
  createLooksSaver,
  loadLooks,
  lookFromScene,
  parseLooksFile,
  readStoredLooks,
  replaceDamagedLooks,
  sanitizeLook,
  saveLooks,
  toLooksFile,
  uniqueName,
} from '../../src/project/looks';

const sceneWithoutCamera = (): Look['scene'] => {
  const { camera: _camera, ...rest } = cloneScene(DEFAULT_SCENE);
  return rest;
};

const CAMERA: CameraSettings = {
  yaw: 15,
  pitch: 20,
  roll: 3,
  fov: 50,
  projection: 'orthographic',
  zoom: 1.5,
  panX: 0.2,
  panY: -0.1,
};

/** A storage that keeps the items in a map, and refuses every write while `full` is set. */
function fakeStorage(): KeyValueStorage & { items: Map<string, string>; full: boolean; writes: number } {
  const items = new Map<string, string>();
  return {
    items,
    full: false,
    writes: 0,
    get(key) {
      return items.get(key) ?? null;
    },
    set(key, value) {
      this.writes++;
      if (this.full) return false;
      items.set(key, value);
      return true;
    },
  };
}

describe('sanitizeLook', () => {
  it('rejects anything without a name or a scene', () => {
    for (const raw of [
      null,
      undefined,
      'look',
      42,
      [],
      {},
      { name: 'Look' },
      { name: 'Look', scene: [] },
      { name: 'Look', scene: 'dark' },
      { name: '   ', scene: {} },
      { name: 7, scene: {} },
      { scene: {} },
    ]) {
      expect(sanitizeLook(raw)).toBeNull();
    }
  });

  it('keeps a valid look as it is, with or without a camera', () => {
    const scene = sceneWithoutCamera();
    expect(sanitizeLook({ name: 'Plain', scene })).toEqual({ name: 'Plain', scene });
    const withCamera = { ...scene, camera: CAMERA };
    expect(sanitizeLook({ name: 'Framed', scene: withCamera })).toEqual({ name: 'Framed', scene: withCamera });
  });

  it('fills a partial scene with the defaults and leaves the camera out unless one is given', () => {
    const look = sanitizeLook({ name: 'Partial', scene: { shadow: { opacity: 0.9 } } });
    expect(look).toEqual({
      name: 'Partial',
      scene: { ...sceneWithoutCamera(), shadow: { ...DEFAULT_SCENE.shadow, opacity: 0.9 } },
    });
    expect(look?.scene).not.toHaveProperty('camera');
  });

  it('completes a partial camera with the default camera', () => {
    const look = sanitizeLook({ name: 'Turned', scene: { camera: { yaw: 45 } } });
    expect(look?.scene.camera).toEqual({ ...DEFAULT_SCENE.camera, yaw: 45 });
  });

  it('ignores a camera that is not an object', () => {
    for (const camera of [null, 'front', 3, []]) {
      expect(sanitizeLook({ name: 'Look', scene: { camera } })?.scene).not.toHaveProperty('camera');
    }
  });

  it('trims the name and cuts it to 80 characters', () => {
    expect(sanitizeLook({ name: '  Dark  ', scene: {} })?.name).toBe('Dark');
    expect(sanitizeLook({ name: ` ${'x'.repeat(100)}`, scene: {} })?.name).toBe('x'.repeat(80));
  });

  it('clamps out-of-range values, replaces wrong types and drops unknown keys', () => {
    const look = sanitizeLook({
      name: 'Broken',
      unknown: true,
      scene: {
        camera: { yaw: 1000, pitch: -100, roll: 'up', fov: 0, projection: 'fisheye', zoom: 100, panX: 5, panY: -5 },
        light: { intensity: 9, ambient: -1, environment: Number.NaN, elevation: 120, color: 'white', azimuth: 10 },
        shadow: { enabled: 'yes', opacity: 2, softness: -1 },
        reflection: { enabled: false, opacity: 5, falloff: -3, gap: 500 },
        background: { mode: 'image', color: '#12345', color2: '#ABCDEF' },
        extra: { anything: 1 },
      },
    });
    expect(look).toEqual({
      name: 'Broken',
      scene: {
        camera: { yaw: 360, pitch: -89, roll: 0, fov: 1, projection: 'perspective', zoom: 20, panX: 2, panY: -2 },
        light: { ...DEFAULT_SCENE.light, intensity: 3, ambient: 0, elevation: 90, azimuth: 10 },
        shadow: { enabled: true, opacity: 1, softness: 0 },
        reflection: { enabled: false, opacity: 1, falloff: 0, gap: 100 },
        background: { mode: DEFAULT_SCENE.background.mode, color: DEFAULT_SCENE.background.color, color2: '#ABCDEF' },
      },
    });
  });
});

describe('parseLooksFile', () => {
  const look = { name: 'One', scene: {} };
  const other = { name: 'Two', scene: { shadow: { enabled: false } } };
  const file = (looks: unknown, fields: Record<string, unknown> = {}) => ({
    app: 'mockup-director',
    kind: 'looks',
    version: LOOKS_VERSION,
    looks,
    ...fields,
  });

  it('reads the looks of a looks file in their order', () => {
    expect(parseLooksFile(file([look, other])).map((l) => l.name)).toEqual(['One', 'Two']);
    expect(parseLooksFile(file([]))).toEqual([]);
  });

  it('leaves out the entries that are not looks', () => {
    expect(parseLooksFile(file([look, null, { name: '' }, 'x', other])).map((l) => l.name)).toEqual(['One', 'Two']);
  });

  it('refuses a value that is not a looks file', () => {
    for (const json of [
      null,
      'looks',
      [look],
      look,
      file([look], { app: 'other-app' }),
      file([look], { app: undefined }),
      file([look], { kind: 'presets' }),
      file([look], { kind: undefined }),
      file('none'),
      file(undefined),
    ]) {
      expect(() => parseLooksFile(json)).toThrow(LooksError);
    }
  });

  it('refuses a version that is not a whole number from 1', () => {
    for (const version of [0, -1, 1.5, '1', null, undefined]) {
      expect(() => parseLooksFile(file([look], { version }))).toThrow(LooksError);
    }
  });

  it('refuses looks from a newer version and says to update', () => {
    expect(() => parseLooksFile(file([look], { version: LOOKS_VERSION + 1 }))).toThrow(/newer Mockup Director/);
    try {
      parseLooksFile(file([look], { version: LOOKS_VERSION + 1 }));
    } catch (e) {
      expect(e instanceof LooksError && e.newer).toBe(true);
    }
    try {
      parseLooksFile(file([look], { version: 0 }));
    } catch (e) {
      expect(e instanceof LooksError && e.newer).toBe(false);
    }
  });

  it('checks the version before the shape: a newer version may store its looks in another shape', () => {
    const newer = { ...toLooksFile([]), version: LOOKS_VERSION + 1, looks: {} };
    expect(() => parseLooksFile(newer)).toThrow(expect.objectContaining({ newer: true }));
    expect(() => parseLooksFile({ ...toLooksFile([]), looks: {} })).toThrow(expect.objectContaining({ newer: false }));
  });

  it('writes the shape it reads', () => {
    const looks = [{ name: 'One', scene: sceneWithoutCamera() }];
    expect(toLooksFile(looks)).toEqual({ app: 'mockup-director', kind: 'looks', version: LOOKS_VERSION, looks });
    expect(parseLooksFile(JSON.parse(JSON.stringify(toLooksFile(looks))))).toEqual(looks);
  });
});

describe('BUILTIN_LOOKS', () => {
  it('has stable, unique ids', () => {
    expect(BUILTIN_LOOKS.map((l) => l.id)).toEqual(['studio-light', 'dark-stage', 'clean-catalog', 'glossy-hero']);
  });

  it('holds complete scenes within every range', () => {
    for (const look of BUILTIN_LOOKS) {
      expect(sanitizeLook({ name: look.id, scene: look.scene })?.scene, look.id).toEqual(look.scene);
    }
  });

  it('includes a camera only in the glossy hero shot', () => {
    expect(BUILTIN_LOOKS.filter((l) => l.scene.camera).map((l) => l.id)).toEqual(['glossy-hero']);
  });
});

describe('lookFromScene', () => {
  const scene: SceneSettings = { ...cloneScene(DEFAULT_SCENE), camera: CAMERA };

  it('takes the scene and the camera only when asked', () => {
    expect(lookFromScene('With', scene, true)).toEqual({ name: 'With', scene });
    const without = lookFromScene('Without', scene, false);
    expect(without.scene).toEqual(sceneWithoutCamera());
    expect(without.scene).not.toHaveProperty('camera');
  });

  it('copies the scene so later changes do not reach the look', () => {
    const source = cloneScene(scene);
    const look = lookFromScene('Copy', source, true);
    source.light.intensity = 2.5;
    source.camera.yaw = -90;
    expect(look.scene.light.intensity).toBe(DEFAULT_SCENE.light.intensity);
    expect(look.scene.camera?.yaw).toBe(CAMERA.yaw);
  });
});

describe('applyLook', () => {
  it('keeps the current camera when the look has none', () => {
    const current: SceneSettings = { ...cloneScene(DEFAULT_SCENE), camera: CAMERA };
    const look = BUILTIN_LOOKS[1].scene;
    expect(applyLook(current, look)).toEqual({ ...look, camera: CAMERA });
  });

  it('takes the camera of the look when it has one', () => {
    const look = { ...sceneWithoutCamera(), camera: CAMERA };
    expect(applyLook(cloneScene(DEFAULT_SCENE), look).camera).toEqual(CAMERA);
  });

  it('leaves the scene and the look unchanged', () => {
    const current = cloneScene(DEFAULT_SCENE);
    const look = { ...sceneWithoutCamera(), camera: { ...CAMERA } };
    const before = JSON.stringify([current, look]);
    const next = applyLook(current, look);
    next.camera.yaw = 99;
    next.light.intensity = 0;
    expect(JSON.stringify([current, look])).toBe(before);
  });

  it('clamps the values of a damaged look', () => {
    const look = { ...sceneWithoutCamera(), shadow: { enabled: true, opacity: 3, softness: 0.5 } };
    expect(applyLook(cloneScene(DEFAULT_SCENE), look).shadow.opacity).toBe(1);
  });
});

describe('uniqueName', () => {
  const list = (...names: string[]): Look[] => names.map((name) => ({ name, scene: sceneWithoutCamera() }));

  it('keeps a free name', () => {
    expect(uniqueName('Dark', list('Light'))).toBe('Dark');
  });

  it('adds the first free number, ignoring case', () => {
    expect(uniqueName('Dark', list('dark'))).toBe('Dark 2');
    expect(uniqueName('Dark', list('Dark', 'DARK 2', 'Dark 4'))).toBe('Dark 3');
  });

  it('ignores the look being renamed', () => {
    expect(uniqueName('Dark', list('Light', 'Dark'), 1)).toBe('Dark');
    expect(uniqueName('Dark', list('Dark', 'Dark'), 1)).toBe('Dark 2');
  });

  it('keeps names within the length limit, so storing them does not make them equal', () => {
    const long = 'x'.repeat(MAX_LOOK_NAME);
    expect(uniqueName(`${long}yz`, list())).toBe(long);
    const second = uniqueName(long, list(long));
    expect(second).toBe(`${'x'.repeat(MAX_LOOK_NAME - 2)} 2`);
    expect(sanitizeLook({ name: second, scene: {} })?.name).toBe(second);
    expect(uniqueName(long, list(long, second))).toBe(`${'x'.repeat(MAX_LOOK_NAME - 2)} 3`);
    const spaced = `${'x'.repeat(MAX_LOOK_NAME - 3)} ab`;
    expect(uniqueName(spaced, list(spaced))).toBe(`${'x'.repeat(MAX_LOOK_NAME - 3)} 2`);
  });
});

describe('stored looks', () => {
  const DAMAGED = [
    '{ not json',
    JSON.stringify('looks'),
    JSON.stringify([{ name: 'Valid', scene: {} }]),
    JSON.stringify({ ...toLooksFile([]), app: 'other-app' }),
    JSON.stringify({ ...toLooksFile([]), kind: 'project' }),
    JSON.stringify({ ...toLooksFile([]), version: 0 }),
    JSON.stringify({ ...toLooksFile([]), version: 1.5 }),
    JSON.stringify({ ...toLooksFile([]), version: '1' }),
  ];
  const NEWER = JSON.stringify({
    ...toLooksFile([]),
    looks: [{ name: 'Future', scene: {} }],
    version: LOOKS_VERSION + 1,
  });
  const twoLooks = (): Look[] => [
    lookFromScene('One', cloneScene(DEFAULT_SCENE), true),
    { name: 'Two', scene: sceneWithoutCamera() },
  ];

  it('uses the storage key of the app', () => {
    expect(LOOKS_KEY).toBe('mockup-director.looks');
  });

  it('reads no looks, as readable, when nothing is stored', () => {
    expect(readStoredLooks(null)).toEqual({ looks: [], stored: 'ok' });
    expect(readStoredLooks('')).toEqual({ looks: [], stored: 'ok' });
  });

  it('reads valid stored looks and skips the entries that are not looks', () => {
    const looks = twoLooks();
    expect(readStoredLooks(JSON.stringify(toLooksFile(looks)))).toEqual({ looks, stored: 'ok' });
    const mixed = JSON.stringify({ ...toLooksFile([]), looks: [{ name: 'Valid', scene: {} }, { name: 'No scene' }] });
    expect(readStoredLooks(mixed).looks.map((l) => l.name)).toEqual(['Valid']);
  });

  it('calls stored looks damaged when they are not JSON, not a looks file or have a bad version', () => {
    for (const raw of DAMAGED) {
      expect(readStoredLooks(raw)).toEqual({ looks: [], stored: 'damaged' });
    }
  });

  it('tells looks from a newer version apart from damaged ones', () => {
    expect(readStoredLooks(NEWER)).toEqual({ looks: [], stored: 'newer' });
    const otherShape = JSON.stringify({ ...toLooksFile([]), version: LOOKS_VERSION + 1, looks: {} });
    expect(readStoredLooks(otherShape)).toEqual({ looks: [], stored: 'newer' });
  });

  it('saves the looks as a looks file and reads them back', () => {
    const storage = fakeStorage();
    const user = loadLooks(storage);
    user.looks.push(...twoLooks());
    expect(saveLooks(user, storage)).toBe('saved');
    expect(JSON.parse(storage.items.get(LOOKS_KEY) ?? 'null')).toEqual(toLooksFile(twoLooks()));
    expect(loadLooks(storage)).toEqual({ looks: twoLooks(), stored: 'ok' });
  });

  it('never writes over stored looks that could not be read', () => {
    for (const raw of [...DAMAGED, NEWER]) {
      const storage = fakeStorage();
      storage.items.set(LOOKS_KEY, raw);
      const user = loadLooks(storage);
      user.looks.push(...twoLooks());
      expect(saveLooks(user, storage)).toBe('kept');
      expect(storage.writes).toBe(0);
      expect(storage.items.get(LOOKS_KEY)).toBe(raw);
    }
  });

  it('reports a save that could not be written', () => {
    const storage = fakeStorage();
    storage.full = true;
    const user = loadLooks(storage);
    user.looks.push(...twoLooks());
    expect(saveLooks(user, storage)).toBe('failed');
    expect(storage.items.has(LOOKS_KEY)).toBe(false);
  });

  it('replaces damaged stored looks with the looks of this run, and saves them from then on', () => {
    const storage = fakeStorage();
    storage.items.set(LOOKS_KEY, '{ not json');
    const user = loadLooks(storage);
    user.looks.push(...twoLooks());
    expect(replaceDamagedLooks(user, storage)).toBe('saved');
    expect(user.stored).toBe('ok');
    expect(loadLooks(storage)).toEqual({ looks: twoLooks(), stored: 'ok' });
    user.looks.pop();
    expect(saveLooks(user, storage)).toBe('saved');
    expect(loadLooks(storage).looks.map((l) => l.name)).toEqual(['One']);
  });

  it('keeps the damaged looks, still unwritten, when replacing them fails', () => {
    const storage = fakeStorage();
    storage.items.set(LOOKS_KEY, '{ not json');
    storage.full = true;
    const user = loadLooks(storage);
    expect(replaceDamagedLooks(user, storage)).toBe('failed');
    expect(user.stored).toBe('damaged');
    expect(storage.items.get(LOOKS_KEY)).toBe('{ not json');
    storage.full = false;
    expect(saveLooks(user, storage)).toBe('kept');
  });

  it('only replaces damaged stored looks', () => {
    const storage = fakeStorage();
    storage.items.set(LOOKS_KEY, NEWER);
    expect(() => replaceDamagedLooks(loadLooks(storage), storage)).toThrow();
    expect(storage.items.get(LOOKS_KEY)).toBe(NEWER);
  });
});

describe('createLooksSaver', () => {
  /** A saver of the looks in a fake storage that holds `stored`, when given. */
  const setup = (stored?: string) => {
    const storage = fakeStorage();
    if (stored !== undefined) storage.items.set(LOOKS_KEY, stored);
    const user = loadLooks(storage);
    const saver = createLooksSaver(user, storage);
    return { storage, user, saver };
  };

  it('warns once while saving keeps failing', () => {
    const { storage, saver } = setup();
    storage.full = true;
    expect(saver.save()).toEqual({ result: 'failed', warn: true });
    expect(saver.save()).toEqual({ result: 'failed', warn: false });
  });

  it('does not count a kept save as one that worked', () => {
    const { storage, user, saver } = setup();
    storage.full = true;
    expect(saver.save().warn).toBe(true);
    user.stored = 'newer';
    expect(saver.save()).toEqual({ result: 'kept', warn: false });
    user.stored = 'ok';
    expect(saver.save()).toEqual({ result: 'failed', warn: false });
  });

  it('warns again after a save has worked in between', () => {
    const { storage, saver } = setup();
    storage.full = true;
    expect(saver.save().warn).toBe(true);
    storage.full = false;
    expect(saver.save()).toEqual({ result: 'saved', warn: false });
    storage.full = true;
    expect(saver.save()).toEqual({ result: 'failed', warn: true });
  });

  it('does not warn after a failed replace of damaged looks', () => {
    const { storage, saver } = setup('{ not json');
    storage.full = true;
    expect(saver.replaceDamaged()).toBe('failed');
    expect(saver.save()).toEqual({ result: 'kept', warn: false });
  });

  it('warns after a successful replace of damaged looks when the next save fails', () => {
    const { storage, saver } = setup('{ not json');
    storage.full = true;
    expect(saver.save()).toEqual({ result: 'kept', warn: false });
    storage.full = false;
    expect(saver.replaceDamaged()).toBe('saved');
    storage.full = true;
    expect(saver.save()).toEqual({ result: 'failed', warn: true });
  });
});
