/**
 * Building a phone or a tablet from its spec: frame, front and back glass, the lit screen, cameras,
 * side buttons and, for the tablet, the stylus beside it.
 *
 * Coordinate frame (see CONVENTIONS in core/types/model.ts): millimeters. The device is built in a
 * PORTRAIT local frame – width along X, height along Y, thickness along Z, centered on the origin,
 * the SCREEN facing +Z. For landscape the whole device group is rotated +90° about Z
 * (counter-clockwise seen from the front: the portrait top goes to the LEFT). The screen UVs are
 * computed in that rotated (world-aligned) frame, so the image always reads upright for the chosen
 * orientation. Finally the composition is put on the ground (standing on its edge), front = +Z.
 *
 * Construction (all meshes fresh per build, geometries/materials reused within a build):
 *  - metal (or ceramic/plastic) FRAME: rounded-rectangle slab with rounded edges (custom profile
 *    sweep, see slabGeometry),
 *  - FRONT GLASS: very dark slab with a "2.5D" rounded top edge, sitting on the frame,
 *  - SCREEN: flat rounded rectangle just above the glass. Lit look: map + emissiveMap = the same
 *    texture, emissive white, dark base color, clearcoat for glass reflections,
 *  - phone: frosted BACK GLASS; tablet: the frame forms a metal unibody back,
 *  - generic side buttons, optional punch-hole / bezel front camera, generic rear camera module
 *    (rounded rectangle with 1–2 lenses + flash), tablet: optional generic stylus lying in front.
 *
 * Designs are deliberately generic (no logos, no brand-specific camera layouts or notches).
 */
import * as THREE from 'three';
import type { ModelContext } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { castShadows, placeOnGround, planarUVs } from '../../geometry';
import { bool, num, str } from '../../params';
import { orientedScreen, resolveDims } from './dims';
import { type DeviceSpec, FINISHES, GLASS_INSET, SCREEN_LIFT } from './spec';
import { buildStylus } from './stylus';
import { buttonGeometry, edgeArc, type ProfilePt, roundedShape, slabGeometry } from './sweep';

/**
 * UV sub-rectangle that makes the image COVER a target of the given aspect (center crop), so
 * images of a different aspect are never distorted.
 */
function coverRect(tex: THREE.Texture, targetAspect: number): [number, number, number, number] {
  const img = tex.image as { width?: number; height?: number } | null | undefined;
  const iw = img?.width ?? 0;
  const ih = img?.height ?? 0;
  if (!iw || !ih) return [0, 0, 1, 1];
  const ia = iw / ih;
  if (Math.abs(ia / targetAspect - 1) < 0.005) return [0, 0, 1, 1];
  if (ia > targetAspect) {
    const k = targetAspect / ia;
    return [0.5 - k / 2, 0, 0.5 + k / 2, 1];
  }
  const k = ia / targetAspect;
  return [0, 0.5 - k / 2, 1, 0.5 + k / 2];
}

export function buildDevice(ctx: ModelContext, spec: DeviceSpec): THREE.Object3D {
  const p = ctx.params;
  const d = resolveDims(spec, p);
  const { W, H, T, r } = d;

  const finishId = str(p, 'frame', spec.defaultFrame);
  const finish = FINISHES[finishId] ?? FINISHES[spec.defaultFrame];
  const custom = finishId === 'custom' ? str(p, 'frameColor', '#7a7f88') : null;
  const frameColor = custom ?? finish.frame;
  const backColor = custom ?? finish.back;

  const root = new THREE.Group();
  root.name = spec.kind === 'phone' ? 'Smartphone' : 'Tablet';
  const device = new THREE.Group();
  device.name = 'device';
  root.add(device);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    device.add(m);
    return m;
  };

  // Materials.
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: frameColor,
    metalness: finish.metalness,
    roughness: finish.roughness,
    clearcoat: finish.metalness < 0.5 ? 0.6 : 0.15,
    clearcoatRoughness: 0.2,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#050506',
    metalness: 0,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
  const backMat =
    spec.backGlassT > 0
      ? // Frosted back glass.
        new THREE.MeshPhysicalMaterial({
          color: backColor,
          metalness: 0,
          roughness: 0.48,
          clearcoat: 0.7,
          clearcoatRoughness: 0.32,
        })
      : // Bead-blasted metal unibody back (same metal as the frame, a bit rougher).
        new THREE.MeshPhysicalMaterial({
          color: backColor,
          metalness: finish.metalness,
          roughness: Math.min(0.6, finish.roughness + 0.14),
        });

  // Frame (body).
  const gB = spec.backGlassT;
  const zf0 = -T / 2 + gB; // frame bottom (back)
  const zf1 = T / 2 - spec.glassT; // frame top (under the front glass)
  const frameT = zf1 - zf0;
  const eFront = Math.min(0.45, frameT / 2 - 0.05);
  // Phones: small radius under the back glass; tablets: softly rounded metal back edge.
  const eBack = gB > 0 ? eFront : clamp(frameT * 0.4, 0.5, 2.2);
  const frameProfile: ProfilePt[] = [...edgeArc(zf0, eBack, -1).reverse(), ...edgeArc(zf1, eFront, 1)];
  // With a metal back the frame's back cap IS the visible back, so it uses the back material.
  // Geometry groups: 0 = sides + front cap (frame material), 1 = back cap (back material).
  const frameGeo = slabGeometry(W, H, r, frameProfile, { start: gB === 0, end: true, startGroup: 1 });
  if (gB === 0) {
    const m = new THREE.Mesh(frameGeo, [frameMat, backMat]);
    m.name = 'frame';
    device.add(m);
  } else {
    add(frameGeo, frameMat, 'frame');
  }

  // Front glass.
  // Vertical side from the frame up, then a quarter-round "2.5D" edge into the flat top.
  const eg = spec.glassEdge;
  const gw = W - 2 * GLASS_INSET;
  const gh = H - 2 * GLASS_INSET;
  const gr = r - GLASS_INSET;
  const glassProfile: ProfilePt[] = [{ d: 0, z: zf1 - 0.05, a: 0 }, ...edgeArc(T / 2, eg, 1)];
  add(slabGeometry(gw, gh, gr, glassProfile, { start: false, end: true }), glassMat, 'front-glass');

  // Back glass (phone).
  if (gB > 0) {
    const backProfile: ProfilePt[] = [{ d: 0, z: zf0 + 0.05, a: 0 }, ...edgeArc(-T / 2, eg, -1)];
    add(slabGeometry(gw, gh, gr, backProfile, { start: false, end: true }), backMat, 'back-glass');
  }

  // Screen.
  const tex = ctx.getTexture('screen');
  const [ow, oh] = orientedScreen(d);
  const screenGeo = new THREE.ShapeGeometry(roundedShape(d.sw, d.sh, d.sr), 24);
  // UV orientation: projected in the WORLD-aligned frame of the chosen orientation – u grows to
  // the right, v upwards as seen from the front (+Z), so the image is upright and not mirrored.
  // For landscape the geometry is temporarily rotated like the device group (+90° about Z),
  // projected, and rotated back (rotation does not touch the UV attribute).
  if (d.landscape) screenGeo.rotateZ(Math.PI / 2);
  planarUVs(screenGeo, 'x', 'y', [-ow / 2, ow / 2], [-oh / 2, oh / 2], coverRect(tex, ow / oh));
  if (d.landscape) screenGeo.rotateZ(-Math.PI / 2);
  screenGeo.translate(0, 0, T / 2 + SCREEN_LIFT);
  const matte = str(p, 'screenFinish', 'glossy') === 'matte';
  const screenMat = new THREE.MeshPhysicalMaterial({
    color: '#1e1e1e',
    map: tex,
    emissive: '#ffffff',
    emissiveMap: tex,
    emissiveIntensity: clamp(num(p, 'brightness', 90), 0, 150) / 100,
    metalness: 0,
    roughness: matte ? 0.55 : 0.16,
    clearcoat: matte ? 0.5 : 1,
    clearcoatRoughness: matte ? 0.4 : 0.03,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  add(screenGeo, screenMat, 'screen');

  // Front camera.
  if (d.cam) {
    const zc = T / 2 + (d.cam.inScreen ? SCREEN_LIFT : 0) + 0.04;
    const holeMat = new THREE.MeshPhysicalMaterial({
      color: '#020203',
      roughness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const lensMat = new THREE.MeshPhysicalMaterial({
      color: '#18202e',
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const hole = new THREE.CircleGeometry(d.cam.r, 32).translate(d.cam.x, d.cam.y, zc);
    const lens = new THREE.CircleGeometry(d.cam.r * 0.42, 24).translate(d.cam.x, d.cam.y, zc + 0.02);
    add(hole, holeMat, 'front-camera');
    add(lens, lensMat, 'front-camera-lens');
  }

  // Side buttons.
  if (bool(p, 'buttons', true)) {
    const prot = 0.55;
    // Centered on the VERTICAL part of the side wall (between the back and front edge roundings),
    // so the buttons never sit over the strongly rounded metal back edge of the tablet.
    const wall0 = zf0 + eBack;
    const wall1 = zf1 - eFront;
    const bw = clamp(Math.min(frameT * 0.42, wall1 - wall0 + 0.6), 1.2, 2.6);
    const zMid = (wall0 + wall1) / 2;
    // Right side (+X): rotateY(+90°) maps local +Z (protrusion) -> +X, local x (bw) -> -Z.
    const rightButton = (len: number, y: number, name: string) => {
      const g = buttonGeometry(len, bw, prot)
        .rotateY(Math.PI / 2)
        .translate(W / 2, y, zMid);
      add(g, frameMat, name);
    };
    if (spec.kind === 'phone') {
      // Volume rocker above the power key, both on the right side (stays clear of the ground in
      // landscape, where the right side becomes the top). The rocker's top end is kept on the
      // straight part of the side (below the corner arc), otherwise a large corner radius on a
      // short body would leave it floating beside the receding corner.
      const volLen = H * 0.16;
      const volTop = Math.min(H * 0.38, H / 2 - r - 2);
      const powLen = H * 0.085;
      const powTop = volTop - volLen - H * 0.0575;
      rightButton(volLen, volTop - volLen / 2, 'volume-button');
      rightButton(powLen, powTop - powLen / 2, 'power-button');
    } else {
      rightButton(H * 0.09, H / 2 - r - 6 - H * 0.045, 'volume-button');
      // Power key on the top edge near the right corner: rotateX(-90°) maps local +Z -> +Y.
      const len = H * 0.07;
      const g = buttonGeometry(len, bw, prot)
        .rotateZ(Math.PI / 2) // outline: len along X, bw along Y
        .rotateX(-Math.PI / 2)
        .translate(W / 2 - r - 6 - len / 2, H / 2, zMid);
      add(g, frameMat, 'power-button');
    }
  }

  // Rear camera module.
  if (bool(p, 'rearCamera', true)) {
    const rs = spec.rear;
    const s = clamp(W / spec.width.def, 0.75, 1.25);
    const mw = rs.w * s;
    const mh = rs.h * s;
    const bump = Math.min(rs.bump, T * 0.2);
    // Module at the portrait top on the local +X side = top-LEFT when looking at the back.
    const mx = W / 2 - rs.margin * s - mw / 2;
    const my = H / 2 - rs.margin * s - mh / 2;
    const zBack = -T / 2;
    const zEnd = zBack - bump;
    const em = Math.min(0.5, bump * 0.6);
    const modProfile: ProfilePt[] = [{ d: 0, z: zBack + 0.25, a: 0 }, ...edgeArc(zEnd, em, -1)];
    const modMat =
      spec.backGlassT > 0
        ? new THREE.MeshPhysicalMaterial({
            color: backColor,
            metalness: 0,
            roughness: 0.2,
            clearcoat: 1,
            clearcoatRoughness: 0.05,
          })
        : backMat;
    add(
      slabGeometry(mw, mh, rs.r * s, modProfile, { start: false, end: true }).translate(mx, my, 0),
      modMat,
      'camera-module',
    );

    const ringMat = new THREE.MeshPhysicalMaterial({ color: '#1b1b1e', metalness: 0.85, roughness: 0.3 });
    const lensGlass = new THREE.MeshPhysicalMaterial({
      color: '#07080b',
      roughness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    });
    const pupilMat = new THREE.MeshPhysicalMaterial({
      color: '#1d2638',
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    });
    const lr = rs.lensR * s;
    const ringH = 0.5;
    // Lens geometries are shared between the lenses of this build. Circles face -Z (rotateY π;
    // they are rotationally symmetric, so the mirroring is irrelevant).
    const ringGeo = new THREE.CylinderGeometry(lr, lr, ringH, 48).rotateX(Math.PI / 2);
    const glassGeo = new THREE.CircleGeometry(lr * 0.8, 40).rotateY(Math.PI);
    const pupilGeo = new THREE.CircleGeometry(lr * 0.36, 32).rotateY(Math.PI);
    const zRing = zEnd - ringH / 2 + 0.1;
    const zFace = zEnd - ringH + 0.1;
    for (const [lx, ly] of rs.lenses) {
      const x = mx + lx * s;
      const y = my + ly * s;
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(x, y, zRing);
      ring.name = 'lens-ring';
      const glass = new THREE.Mesh(glassGeo, lensGlass);
      glass.position.set(x, y, zFace - 0.03);
      glass.name = 'lens';
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(x, y, zFace - 0.06);
      pupil.name = 'lens-pupil';
      device.add(ring, glass, pupil);
    }
    // Flash: inside the module when its x offset is 0, otherwise on the back beside the module.
    const fx = mx + rs.flash[0] * s;
    const fy = my + rs.flash[1] * s;
    const onModule = rs.flash[0] === 0;
    const fz = (onModule ? zEnd : zBack) - 0.04;
    // Decals 0.04 mm off the surface: polygonOffset keeps them free of z-fighting from afar.
    const decal = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    const flashMat = new THREE.MeshPhysicalMaterial({
      color: '#f2ecdc',
      roughness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      ...decal,
    });
    add(new THREE.CircleGeometry(rs.flashR * s, 28).rotateY(Math.PI).translate(fx, fy, fz), flashMat, 'flash');
    // Tiny microphone hole next to the flash (offset scaled with the module so it stays on its
    // flat face on small tablets).
    const micMat = new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.8, ...decal });
    add(
      new THREE.CircleGeometry(0.45, 16).rotateY(Math.PI).translate(fx, fy - (rs.flashR + 2.2) * s, fz),
      micMat,
      'microphone',
    );
  }

  if (d.landscape) device.rotation.z = Math.PI / 2;
  placeOnGround(device);

  // Stylus (tablet).
  if (spec.kind === 'tablet' && bool(p, 'stylus', false)) {
    device.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(device, true);
    const dark = new THREE.Color(frameColor).getHSL({ h: 0, s: 0, l: 0 }).l < 0.3;
    const stylus = buildStylus(dark);
    // Lying on the ground in front of the device, slightly turned for a natural look.
    stylus.position.set(0, 0, box.max.z + 16);
    stylus.rotation.y = -0.1;
    root.add(stylus);
  }

  castShadows(root);
  placeOnGround(root);
  return root;
}
