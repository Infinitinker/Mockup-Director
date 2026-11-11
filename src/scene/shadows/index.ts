/**
 * Soft ground shadow for transparent backgrounds.
 *
 * Two shadow layers are rendered into small off-screen textures and shown on ONE transparent
 * plane at y = 0 (black with alpha, so it composites correctly over any background and keeps a
 * correct alpha channel in exports):
 *
 *  1. Contact shadow – the model seen straight from below (orthographic), every surface writes a
 *     darkness that falls off quickly with its height above the floor, then a Gaussian blur.
 *     Gives the dense, tight "occlusion" line where the product touches the floor. Parts that do
 *     not touch the floor (leaning objects, open cases) automatically produce lighter shadows.
 *
 *  2. Key-light shadow – the same, but every vertex is projected onto the floor ALONG the key
 *     light direction (an oblique / sheared orthographic projection), with a slower height
 *     falloff and a wider blur. Gives a soft directional shadow that follows the key light.
 *
 * Darkness is accumulated with MAX blending (no depth test), so a see-through plastic case never
 * "hides" the dense shadow of the opaque insert inside it.
 */
import * as THREE from 'three';
import type { LayerLayout, ShadowLayout, ShadowRect } from './layout';

const CAPTURE_VERT = /* glsl */ `
varying float vHeight;
void main() {
  vec4 wp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vHeight = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const CAPTURE_FRAG = /* glsl */ `
uniform float uFade;
uniform float uPower;
uniform float uStrength;
varying float vHeight;
void main() {
  float t = clamp(vHeight / uFade, 0.0, 1.0);
  float d = pow(1.0 - t, uPower) * uStrength;
  gl_FragColor = vec4(d, d, d, 1.0);
}`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** 9-tap Gaussian (sigma = 2 taps), separable; uStep = direction * texel * spacing. */
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  float s = texture2D(tMap, vUv).r * 0.20417;
  s += (texture2D(tMap, vUv + uStep).r + texture2D(tMap, vUv - uStep).r) * 0.18018;
  s += (texture2D(tMap, vUv + uStep * 2.0).r + texture2D(tMap, vUv - uStep * 2.0).r) * 0.12383;
  s += (texture2D(tMap, vUv + uStep * 3.0).r + texture2D(tMap, vUv - uStep * 3.0).r) * 0.06629;
  s += (texture2D(tMap, vUv + uStep * 4.0).r + texture2D(tMap, vUv - uStep * 4.0).r) * 0.02763;
  gl_FragColor = vec4(s, s, s, 1.0);
}`;

const PLANE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const PLANE_FRAG = /* glsl */ `
uniform sampler2D tContact;
uniform sampler2D tKey;
uniform float uContact;
uniform float uKey;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  // Contact layer: x1.6 pushes the soft edge OUTWARDS (fully dark at the footprint edge
  // instead of 50 %), which reads as the product really touching the floor.
  float c = min(texture2D(tContact, vUv).r * 1.6, 1.0) * uContact;
  float k = texture2D(tKey, vUv).r * uKey;
  float a = (1.0 - (1.0 - c) * (1.0 - k)) * uOpacity;
  gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 1.0));
}`;

interface LayerTargets {
  a: THREE.WebGLRenderTarget;
  b: THREE.WebGLRenderTarget;
}

export class GroundShadow {
  /** Transparent plane at y = 0 – add it to the scene. */
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly contactRT: LayerTargets;
  private readonly keyRT: LayerTargets;
  private readonly captureCam = new THREE.OrthographicCamera();
  private readonly strongMat: THREE.ShaderMaterial;
  private readonly weakMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lastKey = '';

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    // Half-float targets give smoother gradients when available (WebGL2 + color_buffer ext).
    const ext = renderer.extensions;
    const half = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    const mk = () =>
      new THREE.WebGLRenderTarget(16, 16, {
        type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });
    this.contactRT = { a: mk(), b: mk() };
    this.keyRT = { a: mk(), b: mk() };

    const captureMat = (strength: number) =>
      new THREE.ShaderMaterial({
        vertexShader: CAPTURE_VERT,
        fragmentShader: CAPTURE_FRAG,
        uniforms: { uFade: { value: 1 }, uPower: { value: 2 }, uStrength: { value: strength } },
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
    this.strongMat = captureMat(1);
    // See-through parts (clear plastic) cast a much lighter shadow.
    this.weakMat = captureMat(0.3);
    // Shared uniform objects so both capture materials follow the layer settings.
    this.weakMat.uniforms.uFade = this.strongMat.uniforms.uFade;
    this.weakMat.uniforms.uPower = this.strongMat.uniforms.uPower;

    this.captureCam.matrixAutoUpdate = false;
    this.captureCam.matrixWorldAutoUpdate = false;

    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { tMap: { value: null }, uStep: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.quad.frustumCulled = false;

    // Unit square in XZ with uv = (x, z) – scaled/positioned to the shadow rectangle.
    // (Explicit UVs: texture v grows with world z, matching the capture projection.)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    geo.setIndex([0, 3, 2, 0, 2, 1]); // counter-clockwise seen from above (+Y)
    const planeMat = new THREE.ShaderMaterial({
      vertexShader: PLANE_VERT,
      fragmentShader: PLANE_FRAG,
      uniforms: {
        tContact: { value: this.contactRT.a.texture },
        tKey: { value: this.keyRT.a.texture },
        uContact: { value: 0.85 },
        uKey: { value: 0.6 },
        uOpacity: { value: 0.45 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, planeMat);
    this.mesh.name = 'mockup-director-ground-shadow';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1; // after the reflection, before the model's transparent parts
    this.mesh.layers.set(1);
  }

  setOpacity(opacity: number): void {
    this.mesh.material.uniforms.uOpacity.value = THREE.MathUtils.clamp(opacity, 0, 1);
  }

  /** Force a re-render on the next update() even if the layout did not change. */
  invalidate(): void {
    this.lastKey = '';
  }

  /**
   * Re-render the shadow textures if the layout (or `maxRes`) changed.
   * `model` is rendered directly (its world matrices must be up to date).
   */
  update(model: THREE.Object3D | null, layout: ShadowLayout, maxRes: number): void {
    const key = `${layout.key_}|${maxRes}|${model ? model.uuid : '-'}`;
    const p = layout.plane;
    const W = Math.max(p.maxX - p.minX, 1e-3);
    const D = Math.max(p.maxZ - p.minZ, 1e-3);
    this.mesh.position.set(p.minX, 0, p.minZ);
    this.mesh.scale.set(W, 1, D);
    const u = this.mesh.material.uniforms;
    u.uContact.value = layout.contact.weight;
    u.uKey.value = layout.key.weight;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    r.setClearColor(0x000000, 0);

    // Swap materials for the capture pass; restore afterwards.
    const restore: { o: THREE.Object3D; visible: boolean; material?: THREE.Material | THREE.Material[] }[] = [];
    if (model) {
      let anyCaster = false;
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow) anyCaster = true;
      });
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const casts = anyCaster ? mesh.castShadow : true;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const visibleMats = mats.filter((m) => m?.visible);
          if (!casts || visibleMats.length === 0) {
            restore.push({ o, visible: o.visible });
            o.visible = false;
            return;
          }
          // A mesh made only of see-through materials casts a weak shadow.
          const allClear = visibleMats.every((m) => m.transparent && m.opacity < 0.6);
          restore.push({ o, visible: o.visible, material: mesh.material });
          mesh.material = allClear ? this.weakMat : this.strongMat;
        } else if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) {
          restore.push({ o, visible: o.visible });
          o.visible = false;
        }
      });
    }

    try {
      this.renderLayer(model, layout.contact, p, W, D, maxRes, this.contactRT);
      if (layout.key.weight > 0) {
        this.renderLayer(model, layout.key, p, W, D, maxRes, this.keyRT);
      } else {
        r.setRenderTarget(this.keyRT.a);
        r.clear(true, false, false);
      }
    } finally {
      for (const it of restore) {
        it.o.visible = it.visible;
        if (it.material) (it.o as THREE.Mesh).material = it.material;
      }
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevClear, prevAlpha);
      r.autoClear = prevAutoClear;
    }
  }

  private renderLayer(
    model: THREE.Object3D | null,
    layer: LayerLayout,
    p: ShadowRect,
    W: number,
    D: number,
    maxRes: number,
    rts: LayerTargets,
  ): void {
    const r = this.renderer;
    // Resolution: aim for sigma ≈ 3.5 texels (a blurred shadow needs few texels), capped.
    const texel = Math.max(layer.sigma / 3.5, Math.max(W, D) / maxRes);
    const rx = THREE.MathUtils.clamp(Math.ceil(W / texel), 16, maxRes);
    const rz = THREE.MathUtils.clamp(Math.ceil(D / texel), 16, maxRes);
    if (rts.a.width !== rx || rts.a.height !== rz) {
      rts.a.setSize(rx, rz);
      rts.b.setSize(rx, rz);
    }

    r.setRenderTarget(rts.a);
    r.clear(true, false, false);
    if (!model) return;

    // Sheared orthographic "camera" looking up from below:
    //   view.x = x - kx*y,  view.y = z - kz*y,  view.z = -y   (depth = height above the floor)
    // so a point is drawn where the light ray through it hits the floor. Matrix4.set is row-major.
    const cam = this.captureCam;
    cam.matrixWorldInverse.set(1, -layer.kx, 0, 0, 0, -layer.kz, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    cam.matrixWorld.copy(cam.matrixWorldInverse).invert();
    cam.left = p.minX;
    cam.right = p.maxX;
    cam.bottom = p.minZ;
    cam.top = p.maxZ;
    cam.near = -layer.fade * 0.05 - 1; // allow parts that dip slightly below the floor
    cam.far = layer.fade + 1;
    cam.updateProjectionMatrix();

    this.strongMat.uniforms.uFade.value = Math.max(layer.fade, 1e-3);
    this.strongMat.uniforms.uPower.value = layer.power;
    r.render(model, cam);

    // Separable Gaussian blur, n iterations of (H, V); the variance of iterations adds up.
    const sigmaTex = layer.sigma / Math.max(W / rx, D / rz);
    const n = THREE.MathUtils.clamp(Math.ceil((sigmaTex / 2) ** 2), 1, 6);
    const spacing = sigmaTex / (2 * Math.sqrt(n));
    const step = this.blurMat.uniforms.uStep.value as THREE.Vector2;
    for (let i = 0; i < n; i++) {
      this.blurMat.uniforms.tMap.value = rts.a.texture;
      step.set(spacing / rx, 0);
      r.setRenderTarget(rts.b);
      r.render(this.quad, this.quadCam);
      this.blurMat.uniforms.tMap.value = rts.b.texture;
      step.set(0, spacing / rz);
      r.setRenderTarget(rts.a);
      r.render(this.quad, this.quadCam);
    }
    this.blurMat.uniforms.tMap.value = null;
  }

  dispose(): void {
    for (const t of [this.contactRT.a, this.contactRT.b, this.keyRT.a, this.keyRT.b]) t.dispose();
    this.strongMat.dispose();
    this.weakMat.dispose();
    this.blurMat.dispose();
    this.quad.geometry.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
