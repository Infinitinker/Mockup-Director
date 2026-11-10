/**
 * A stage for the batch tests: it records the models it shows, the scene settings it gets and what it is asked
 * to render, writing each model it shows to a shared event log, and stops every render with RENDER_STOPPED.
 */
import type * as THREE from 'three';
import type { RenderOptions, SceneSettings, StageAPI } from '../../../src/core/types/scene';

/** What every render on the fake stage throws: Node has no canvas to render into. */
export const RENDER_STOPPED = new Error('The fake stage does not render.');

export interface FakeStage {
  stage: StageAPI;
  models: (THREE.Object3D | null)[];
  scenes: SceneSettings[];
  renders: RenderOptions[];
}

/** A fake stage; `events` gets `setModel <name>` for each model it is shown. */
export function fakeStage(events: string[] = []): FakeStage {
  const models: (THREE.Object3D | null)[] = [];
  const scenes: SceneSettings[] = [];
  const renders: RenderOptions[] = [];
  const unused = (): never => {
    throw new Error('The batch does not use this part of the stage.');
  };
  const stage: StageAPI = {
    setModel(object) {
      models.push(object);
      events.push(`setModel ${object?.name ?? 'none'}`);
    },
    applySettings(settings) {
      scenes.push(settings);
    },
    renderToCanvas(options) {
      renders.push(options);
      throw RENDER_STOPPED;
    },
    onCameraChange: unused,
    resize: unused,
    dispose: unused,
  };
  return { stage, models, scenes, renders };
}
