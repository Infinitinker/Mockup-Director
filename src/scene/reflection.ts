/**
 * Floor reflection: a mirrored copy of the model below the floor that fades out with depth.
 *
 *  - The copy lives in a group with scale.y = -1 placed at y = -gap, so a model point at height
 *    y appears at -gap - y. three.js detects the negative determinant of the world matrix and
 *    flips the front-face winding automatically, so materials keep their original `side`.
 *    Only the vertical axis is mirrored – artwork reads correctly left-to-right, exactly like a
 *    real reflection on a glossy floor.
 *  - Geometries are SHARED with the model (never disposed here). Materials are cloned and patched
 *    via onBeforeCompile: alpha *= opacity * fade(worldY) where fade goes from 1 at y = -gap to 0
 *    at y = -gap - falloff * modelHeight. Uniforms are shared, so changing settings needs no
 *    shader recompilation.
 *  - A depth-only pre-pass of the opaque parts (rendered in the opaque pass) makes sure that only
 *    the nearest surface of the reflection is blended – inner parts never shine through.
 *  - Everything is transparent-background friendly: no opaque floor is drawn; the blended
 *    pixels end up correctly premultiplied in the canvas.
 *  - All objects use layer 1 (excluded from the shadow capture camera).
 */
import * as THREE from 'three';
import type { ReflectionSettings } from '../core/types';

export const REFLECTION_LAYER = 1;

interface ReflUniforms {
  uReflTop: { value: number };
  uReflFade: { value: number };
  uReflOpacity: { value: number };
}

const VERT_HEAD = /* glsl */ `
varying float vCbReflY;
`;
const VERT_BODY = /* glsl */ `
#include <project_vertex>
{
  vec4 cbWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    cbWorld = instanceMatrix * cbWorld;
  #endif
  vCbReflY = (modelMatrix * cbWorld).y;
}
`;
const FRAG_HEAD = /* glsl */ `
uniform float uReflTop;
uniform float uReflFade;
uniform float uReflOpacity;
varying float vCbReflY;
`;
const FRAG_BODY = /* glsl */ `
#include <opaque_fragment>
{
  float cbT = clamp((uReflTop - vCbReflY) / uReflFade, 0.0, 1.0);
  gl_FragColor.a *= uReflOpacity * pow(1.0 - cbT, 1.6);
}
`;

export class Reflection {
  /** Mirrored container – add to the scene. */
  readonly group = new THREE.Group();
  private readonly uniforms: ReflUniforms = {
    uReflTop: { value: 0 },
    uReflFade: { value: 1 },
    uReflOpacity: { value: 0.25 },
  };
  /** Materials created by this class (disposed on rebuild). */
  private ownMaterials: THREE.Material[] = [];
  /** Depth pre-pass materials per side (persist for the lifetime of the stage). */
  private readonly depthMats: Record<number, THREE.MeshBasicMaterial> = {};
  private content: THREE.Object3D | null = null;
  private modelHeight = 1;

  constructor() {
    this.group.name = 'mockup-director-reflection';
    this.group.scale.y = -1;
    this.group.layers.set(REFLECTION_LAYER);
    for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
      this.depthMats[side] = new THREE.MeshBasicMaterial({
        colorWrite: false,
        side,
        // Push the pre-pass slightly back so the color pass (LessEqual) always wins on its own surface.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    }
  }

  /** Rebuild the mirrored copy for a new model (or clear it with null). */
  setModel(model: THREE.Object3D | null, modelHeight: number): void {
    this.clear();
    this.modelHeight = Math.max(modelHeight, 1e-3);
    if (!model) return;
    model.updateMatrixWorld(true);

    const patched = new Map<THREE.Material, THREE.Material>();
    const patch = (m: THREE.Material) => {
      let out = patched.get(m);
      if (!out) {
        out = this.patchMaterial(m);
        patched.set(m, out);
        this.ownMaterials.push(out);
      }
      return out;
    };

    const content = new THREE.Group();
    // Color copy and depth pre-pass copy share the same transform hierarchy.
    content.add(
      this.cloneTree(
        model,
        (mesh) => {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const out = mats.map(patch);
          return Array.isArray(mesh.material) ? out : out[0];
        },
        -2,
      ),
    );
    content.add(
      this.cloneTree(
        model,
        (mesh) => {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          // Only fully opaque, non-cut-out materials write the pre-pass depth.
          const ok = mats.every(
            (m) =>
              m.visible &&
              !m.transparent &&
              !m.alphaTest &&
              !(m as THREE.MeshStandardMaterial).alphaMap &&
              !m.alphaHash,
          );
          if (!ok) return null;
          const side = mats[0]?.side ?? THREE.FrontSide;
          return this.depthMats[side] ?? this.depthMats[THREE.FrontSide];
        },
        -3,
      ),
    );
    // The model root sits under the stage's identity-transformed model holder, so copying its
    // local matrix is the same as its world matrix.
    content.traverse((o) => o.layers.set(REFLECTION_LAYER));
    this.group.add(content);
    this.content = content;
  }

  update(settings: ReflectionSettings, visible: boolean): void {
    const gap = Math.max(0, settings.gap);
    this.group.position.y = -gap;
    this.uniforms.uReflTop.value = -gap;
    this.uniforms.uReflFade.value = Math.max(settings.falloff, 1e-3) * this.modelHeight;
    this.uniforms.uReflOpacity.value = THREE.MathUtils.clamp(settings.opacity, 0, 1);
    this.group.visible = visible && settings.enabled && settings.opacity > 0 && settings.falloff > 0 && !!this.content;
  }

  /** Height below the floor (mm, from y = -gap) where the reflection is still visible. */
  visibleDepth(settings: ReflectionSettings): number {
    return Math.min(this.modelHeight, Math.max(settings.falloff, 0) * this.modelHeight);
  }

  dispose(): void {
    this.clear();
    for (const m of Object.values(this.depthMats)) m.dispose();
  }

  private clear(): void {
    if (this.content) this.group.remove(this.content);
    this.content = null;
    // Geometries are shared with the model – only our own materials are disposed.
    for (const m of this.ownMaterials) m.dispose();
    this.ownMaterials = [];
  }

  /**
   * Copy the transform hierarchy of `src`. Meshes become new meshes that SHARE the geometry and
   * get a material from `material()` (null = skip the mesh). Deliberately not using
   * Object3D.clone(): it deep-copies userData via JSON, which models may use for anything.
   */
  private cloneTree(
    src: THREE.Object3D,
    material: (mesh: THREE.Mesh) => THREE.Material | THREE.Material[] | null,
    renderOrder: number,
  ): THREE.Object3D {
    let dst: THREE.Object3D;
    const mesh = src as THREE.Mesh;
    const mat = mesh.isMesh ? material(mesh) : null;
    if (mesh.isMesh && mat) {
      const inst = src as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        const im = new THREE.InstancedMesh(inst.geometry, mat, inst.count);
        im.instanceMatrix = inst.instanceMatrix;
        dst = im;
      } else {
        dst = new THREE.Mesh(mesh.geometry, mat);
      }
      dst.renderOrder = renderOrder;
      dst.frustumCulled = mesh.frustumCulled;
    } else {
      dst = new THREE.Object3D();
    }
    dst.name = src.name;
    // Skipped meshes / lines / points become plain Object3Ds (they draw nothing but keep their
    // children's transforms).
    dst.visible = src.visible;
    dst.position.copy(src.position);
    dst.quaternion.copy(src.quaternion);
    dst.scale.copy(src.scale);
    dst.matrixAutoUpdate = src.matrixAutoUpdate;
    if (!src.matrixAutoUpdate) dst.matrix.copy(src.matrix);
    for (const c of src.children) dst.add(this.cloneTree(c, material, renderOrder));
    return dst;
  }

  private patchMaterial(src: THREE.Material): THREE.Material {
    const m = src.clone();
    m.transparent = true;
    m.depthWrite = false;
    m.depthFunc = THREE.LessEqualDepth;
    // No transmission pass for the reflection (expensive, and invisible at this opacity).
    if ((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) (m as THREE.MeshPhysicalMaterial).transmission = 0;
    const u = this.uniforms;
    const srcHook = src.onBeforeCompile;
    const srcKey = src.customProgramCacheKey();
    m.onBeforeCompile = (shader, renderer) => {
      srcHook.call(m, shader, renderer);
      if (
        !shader.vertexShader.includes('#include <project_vertex>') ||
        !shader.fragmentShader.includes('#include <opaque_fragment>')
      ) {
        return; // unknown shader layout – falls back to plain (unfaded) transparency below
      }
      shader.uniforms.uReflTop = u.uReflTop;
      shader.uniforms.uReflFade = u.uReflFade;
      shader.uniforms.uReflOpacity = u.uReflOpacity;
      shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <project_vertex>', VERT_BODY);
      shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace('#include <opaque_fragment>', FRAG_BODY);
    };
    m.customProgramCacheKey = () => `mockup-director-refl|${srcKey}`;
    return m;
  }
}
