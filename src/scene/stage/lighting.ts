/**
 * The studio light rig: the key light, the fill light and the room environment.
 *
 * LIGHTING IS CAMERA-RELATIVE ("turntable studio"): LightSettings.azimuth is measured from the
 * camera's yaw, so "key light from the upper left" stays upper-left while the user orbits –
 * exactly like rotating a product in front of a fixed studio setup. The environment map and
 * the key-light shadow rotate with it. Elevation is measured from the floor (horizon).
 * Intensities are in physically based units (three.js r155+ lighting).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LightSettings, SceneSettings } from '../../core/types/scene';
import { finite } from '../../core/math';
import { log } from '../../platform/log';

const DEG = Math.PI / 180;

/** DirectionalLight intensity = LightSettings.intensity * KEY_SCALE. Lambert: radiance = albedo * I * cos / π. */
const KEY_SCALE = 3.2;
/** HemisphereLight intensity = LightSettings.ambient * FILL_SCALE. */
const FILL_SCALE = 1.2;
/** scene.environmentIntensity = LightSettings.environment * ENV_SCALE (RoomEnvironment is bright). */
const ENV_SCALE = 0.3;

/** Unit vector TOWARDS the key light for a camera yaw (the light rig is camera-relative). */
export function keyLightDir(s: SceneSettings, yaw: number, out: THREE.Vector3): THREE.Vector3 {
  // Key light: azimuth relative to the camera yaw, elevation from the horizon.
  const az = (yaw + finite(s.light.azimuth, 0)) * DEG;
  const el = THREE.MathUtils.clamp(finite(s.light.elevation, 45), -89, 89.5) * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

/** The key light's intensity setting, limited to its range (the ground shadow's strength follows it). */
export function keyIntensity(light: LightSettings): number {
  return THREE.MathUtils.clamp(finite(light.intensity, 1), 0, 3);
}

/** The lights and the environment of a stage's scene. */
export class StudioLights {
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.HemisphereLight;
  private readonly lightDir = new THREE.Vector3(0, 1, 0);

  /** Adds the lights to `scene` and sets its environment. */
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.buildEnvironment();

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1);
    this.keyLight.castShadow = false;
    scene.add(this.keyLight, this.keyLight.target);
    // Soft fill: neutral sky, slightly warm floor bounce.
    this.fillLight = new THREE.HemisphereLight(0xffffff, 0xb9b4ac, 1);
    scene.add(this.fillLight);
  }

  private buildEnvironment(): void {
    this.envRT?.dispose();
    const room = new RoomEnvironment();
    this.envRT = this.pmrem.fromScene(room, 0.04);
    room.dispose();
    this.scene.environment = this.envRT.texture;
  }

  /**
   * Place and set the lights and the environment rotation for a camera yaw around a model with this pivot and size.
   * Returns the direction towards the key light (one vector, overwritten by the next call) and the key intensity.
   */
  update(
    s: SceneSettings,
    yaw: number,
    pivot: THREE.Vector3,
    size: number,
  ): { lightDir: THREE.Vector3; keyIntensity: number } {
    const { keyLight, fillLight, scene, lightDir } = this;
    keyLightDir(s, yaw, lightDir);
    keyLight.position.copy(pivot).addScaledVector(lightDir, size * 4 + 100);
    keyLight.target.position.copy(pivot);
    keyLight.target.updateMatrixWorld();
    try {
      keyLight.color.set(s.light.color);
    } catch (e) {
      log.warn('The light color is not a color, so the light is white', e);
      keyLight.color.set(0xffffff);
    }
    const key = keyIntensity(s.light);
    keyLight.intensity = key * KEY_SCALE;
    fillLight.intensity = THREE.MathUtils.clamp(finite(s.light.ambient, 0.5), 0, 2) * FILL_SCALE;
    scene.environmentIntensity = THREE.MathUtils.clamp(finite(s.light.environment, 1), 0, 2) * ENV_SCALE;
    scene.environmentRotation.set(0, yaw * DEG, 0);
    return { lightDir, keyIntensity: key };
  }

  /** Rebuild the environment after the WebGL context was restored. */
  restoreContext(): void {
    this.pmrem.dispose();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.buildEnvironment();
  }

  dispose(): void {
    this.scene.environment = null;
    this.envRT?.dispose();
    this.envRT = null;
    this.pmrem.dispose();
  }
}
