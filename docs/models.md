# Writing models

A model is one kind of product the app can show: a box, a keep case, a book, a phone. Each is a `ModelDefinition` (`src/core/types.ts`) in a file in `src/models/`, listed in `MODELS` in `src/models/registry.ts`. The definition says what the user can change (parameters), which artwork the model takes (slots), and how to make the 3D object (`build`). The gallery, the Model tab and the Artwork tab are built from it, so adding a model never needs UI code. Every model follows the [3D conventions](architecture.md#3d-conventions); the full list is at the top of `src/core/types.ts`. The built-in models are the examples:

| File | Models |
|---|---|
| `box.ts`, `box/` | `box`, `box-dieline`, `box-slim` |
| `keepCase.ts` | `dvd-case`, `bluray-case` |
| `jewelCase.ts` | `cd-case` |
| `disc.ts` | `disc` |
| `composites.ts`, `composites/` | `box-disc`, `dvd-case-disc`, `bluray-case-disc`, `cd-case-disc` |
| `books.ts` | `book-hardcover`, `book-paperback`, `notebook-spiral` |
| `printFlat.ts` | `print-business-card`, `print-flyer`, `print-postcard`, `print-plastic-card`, `print-brochure` |
| `printFolded.ts` | `print-trifold`, `print-greeting-card`, `print-bifold` |
| `handheld.ts` | `device-phone`, `device-tablet` |
| `computer.ts` | `device-laptop`, `device-monitor` |
| `screen.ts` | `device-screenshot`, `device-browser` |

## The definition

Texts (`name`, labels, hints) are plain English strings, written where they are used.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Unique, kebab-case ID (`dvd-case-disc`). Saved in project files and used in file names; see [Naming](#naming). |
| `category` | `ModelCategory` | yes | Gallery group: `box`, `disc`, `book`, `print` or `device`. The gallery shows the groups in that order (`src/ui/gallery.ts`); a new category needs a change to `ModelCategory`, and to `CATEGORY_ORDER` and `CATEGORY_LABEL` (its heading) in `src/ui/gallery.ts`. |
| `name` | `string` | yes | Shown in the gallery and as the Model tab's title. |
| `description` | `string` | no | One sentence: the gallery's tooltip (instead of the name) and the line under the Model tab's title. |
| `icon` | `string` | yes | Inline SVG markup for the gallery: `viewBox="0 0 64 64"`, line art in `currentColor`. |
| `slots` | `ImageSlotDef[]` | yes | The artwork the model takes, in the order of the Artwork tab. May be empty. See [Slots and artwork](#slots-and-artwork). |
| `params` | `ParamDef[]` | yes | What the user can change, in the order of the Model tab. May be empty. See [Parameters](#parameters). |
| `defaultCamera` | `Partial<CameraSettings>` | no | The starting view, laid over the default camera (`DEFAULT_SCENE` in `src/core/defaults.ts`) when the model is picked and on Reset view. Usually `{ yaw, pitch }`, sometimes `fov`. |
| `build` | `(ctx: ModelContext) => THREE.Object3D` | yes | Makes a new object tree. See [Building](#building). |

`MODELS` is the gallery's order within each category. `getModel(id)` returns the model with that ID, or the first model for an unknown one; a project file whose active model this build does not have is refused with a message to update Mockup Director (`parseProjectFile` in `src/ui/project.ts`), and such a tab of the autosaved session is kept for a newer version (see [Session](architecture.md#session)).

## Parameters

A parameter is one setting in the Model tab. Every kind has these fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | Unique within the model, camelCase (`cornerRadius`). The key of its value in `ctx.params` and in project files. |
| `type` | `'number' \| 'boolean' \| 'select' \| 'color'` | The kind, below. |
| `label` | `string` | Shown next to the control. |
| `group` | `string`, optional | The section of the Model tab it appears in. |
| `default` | depends on the kind | The value in a new project and after Restore defaults. |

| Kind | Own fields | Value | Control |
|---|---|---|---|
| `number` | `min`, `max`, `step`, `unit?` | `number` | A number field with a slider. Typed values are snapped to `step` and kept between `min` and `max`. `unit` is `'mm'` (shown as mm), `'deg'` (°), `'%'` or `''` (none). |
| `boolean` | – | `boolean` | A switch. |
| `select` | `options: { value: string; label: string }[]` | one of the `value`s | Segmented buttons when there are at most 3 options whose labels together have at most 26 characters; otherwise a menu. |
| `color` | – | `'#rrggbb'` | A color picker. |

- Lengths are in millimeters, angles in degrees, percentages from 0 to 100 (the model divides by 100 itself, as `discOffset` in `composites.ts` does).
- Parameters are grouped by `group`, in the order each group first appears; parameters without a group go into a General section. Groups match by their text, so define a group once (`const G_DIM = 'Dimensions'`) and reuse it.
- Values are checked wherever they come from (`sanitizeParam` in `src/ui/modelUtils.ts`): a number outside `min`..`max` is clamped, a select value that is not an option, a color that is not `#rrggbb`, or a value of the wrong type is dropped and the default used instead.
- When the user switches to a model they have not changed yet, artwork and parameter values carry over from the previous model wherever the slot or parameter ID is the same (`selectModel` in `src/ui/app.ts`). Use the same ID for the same meaning: `width`, `front`, `finish`.

Helpers that create parameters:

| Helper | File | Makes |
|---|---|---|
| `mmParam(id, label, default, min, max, step = 1, group?)` | `src/models/shared.ts` | A number parameter in millimeters. |
| `widthParam`, `heightParam`, `depthParam` | `src/models/box/common.ts` | `width`, `height` and `depth` in millimeters, in the Dimensions group. |
| `bevelParam`, `finishParam`, `sideColorParam`, `bleedParam`, `colorParam(id, label, default, group?)` | `src/models/box/common.ts` | Edge rounding, print finish, the color of faces without artwork, the switch for artwork with bleed, and any color, shared by the boxes. |
| `discParams` | `src/models/disc.ts` | The disc's parameters, all prefixed `disc`, reused by the composites. |

Other parameters are written as object literals (`NumberParamDef`, `SelectParamDef` and so on).

## Slots and artwork

A slot is one piece of artwork: a face, a wrap-around cover, a disc label, a screen. Each is a card in the Artwork tab.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | `string` | yes | Unique within the model, camelCase (`front`, `lidSides`). The key of its artwork in project files. |
| `label` | `string` | yes | The card's title; also drawn on the placeholder and on the print template. |
| `hint` | `string` | no | Help under the title: the size the artwork should have, which edge meets which. |
| `aspect` | `number` | yes | Expected width / height of the artwork. Shapes the placeholder and the aspect warning. |
| `anyAspect` | `boolean` | no | The slot takes any aspect ratio (a screenshot whose panel follows the artwork). No warning is shown. |
| `template` | `PrintTemplate` or `(params) => PrintTemplate` | no | A downloadable print template; see [Print templates](#print-templates). |

The Artwork tab warns when the artwork's aspect ratio is more than 3 % away from every expected one: the slot's `aspect`, the template's full size, and the template's size without bleed (`expectedAspects` and `aspectMismatch` in `src/ui/modelUtils.ts`).

`ctx.getTexture(slotId)` returns the user's artwork, or a placeholder when there is none: a gradient with the slot's label in the slot's aspect ratio, round if its template is circular (`src/core/placeholder.ts`). It never returns `null`, also not for an ID the model does not list. `ctx.hasArtwork(slotId)` says whether the user gave artwork, for models that fall back to a plain material or to another slot (a keep case uses `front`, `spine` and `back` when there is no `cover`).

The textures are shared: the store's artwork and the placeholder cache own them, and the same texture is used by every build and every model that shows it. **A model never changes them**: no `repeat`, `offset`, `rotation`, `center` or `flipY`, and it never disposes them. Map a part of the image with UVs instead. A model that really needs a changed copy clones the texture and sets `texture.userData.disposeWithModel = true`, so it is freed with the model; textures a model draws itself are flagged the same way (`modelTexture` in `printFlat.ts`).

Artwork textures are `CanvasTexture`s with `flipY = true` and the sRGB color space (`src/core/images.ts`), so UV `(0, 0)` is the image's bottom-left corner and `v = 0` its bottom edge. A three.js `BoxGeometry` or `PlaneGeometry` face shows the whole image upright. To show part of an image, `remapUVs` maps a geometry's 0–1 UVs into a rectangle of the image, and `planarUVs` projects UVs along two axes, for example onto the caps of an `ExtrudeGeometry` (both in `src/models/shared.ts`). Artwork must never come out mirrored or upside down: a back face is seen from behind, so it is mapped as a page turned around the vertical axis (see the comment at the top of `printFlat.ts`).

## Print templates

A print template is a PNG the user downloads with the Template… button on a slot's card, to design the artwork on: the exact physical size at 300 dpi, with bleed, trim line, safe area, labeled regions and fold lines. The PNG records its resolution, so an image editor opens it at print size. It is drawn by `src/export/templates.ts`, and saved as `mockup-director-<model id>-template-<slot label, slugified>-<width>x<height>mm-<dpi>dpi.png`, with the resolution actually used. Very large templates are drawn at a lower resolution, which the legend states.

`template` is a `PrintTemplate`, or a function of the parameters when the size depends on them (a box's net follows its width, height and depth). The function gets the model's complete parameters when the user downloads it, and an empty object when the placeholder checks whether the template is round, so read values with `num()` and its fallbacks.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `widthMm`, `heightMm` | `number` | yes | The full artwork size, including bleed. Must be above 0, or the slot has no template. |
| `bleedMm` | `number` | no | Bleed on every side. Drawn as a tinted band outside the trim line. |
| `guides` | `TemplateGuide[]` | no | Lines across the template: `orientation` (`'v'` or `'h'`), `posMm` from the template's top or left edge (bleed included), and an optional `label` (default "Fold"). Drawn dash-dot, the convention for folds. |
| `regions` | `TemplateRegion[]` | no | Labeled rectangles (front, spine, back): `xMm`, `yMm`, `wMm`, `hMm` from the top-left corner, bleed included, and `label`. Each is tinted and labeled with its size after trimming; the safe area is drawn inside each one. Without regions, the whole trim area is labeled with the slot's label. |
| `circle` | `{ outerMm, innerMm, printOuterMm?, printInnerMm? }` | no | Makes the template round (disc labels): outer and hole diameter. `printInnerMm` sets the inner edge of the printable ring; without it the template uses 0.15 × the outer diameter for discs of 60 mm or more. `printOuterMm` is not drawn; the disc model marks the outer print edge with guides. |

The safe area is 3 mm inside the trim line (`SAFE_MARGIN_MM`). Models with artwork that includes bleed use 3 mm of bleed and map the trim area of the image onto the faces (`trimRect` in `printFlat.ts`). `panelTemplate` in `printFlat.ts` is a short example: one panel with bleed, four trim guides and one region; `discSlot` in `disc.ts` is a round one.

## Building

```ts
interface ModelContext {
  getTexture(slotId: string): THREE.Texture; // the user's artwork or a placeholder, never null
  hasArtwork(slotId: string): boolean;        // true if the user gave artwork for the slot
  params: ParamValues;                        // every parameter, checked, defaults filled in
}

build(ctx: ModelContext): THREE.Object3D;
```

- `build` returns a new object tree on every call. The app calls it whenever a parameter or the artwork changes (at most once per frame) and for every item of a batch export (`src/ui/app.ts`, `src/ui/batch.ts`).
- The returned object follows the [3D conventions](architecture.md#3d-conventions): millimeters, lowest point at `y = 0`, centered on `x = 0` and `z = 0`, front facing `+Z`, top facing `+Y`. Build in whatever frame is convenient, then call `placeOnGround`.
- Materials are `MeshStandardMaterial` or `MeshPhysicalMaterial`. The stage adds the lights, the environment for reflections, the shadow and the floor reflection; a model adds none of them. Meshes that cast a shadow set `castShadow` (`castShadows` sets it on the whole tree).
- The stage owns what `build` returns. When it shows the next object, it frees the previous one with `disposeObject`: every geometry and material in the tree, and textures flagged `disposeWithModel`. So create geometries and materials in each build rather than keeping them between builds. A texture a model caches at module level is not flagged and is never freed (the data-side texture in `disc.ts`).
- `ctx.params` is complete, but read values with `num`, `bool` and `str` and a fallback: they also cover a composite that builds its base with changed parameters.
- An exception from `build` is shown to the user as "Could not build model “…”", and the previous object stays on screen. For a problem the user can fix, throw a `UserError` (`src/core/errors.ts`) whose message says what happened, then what to do: it is shown as it is. Any other error is shown as an unexpected error, with its message as detail (`errorMessage` in `src/ui/dom.ts`).
- Transparent parts (clear plastic, which writes no depth) are drawn in `renderOrder`, then by depth. The stage draws the floor reflection at -3 and -2 and the shadow at -1 (`src/scene/reflection.ts`, `src/scene/shadows.ts`), so a model's transparent parts stay above -1.

Helpers in `src/models/shared.ts`:

| Helper | What it does |
|---|---|
| `placeOnGround(root)` | Moves the object so its lowest point is at `y = 0` and it is centered on `x` and `z`. Uses bounding boxes of the geometry, which can be too big for rotated parts; `composites.ts` measures vertices instead. |
| `castShadows(root)` | Sets `castShadow` on every mesh in the tree. |
| `disposeObject(root)` | Frees geometries, materials and flagged textures. The stage calls it; models rarely need it. |
| `printMaterial(map, { roughness, metalness, gloss })` | Printed paper or cardboard; `gloss` adds a clear coat. |
| `solidPlastic(color, roughness)` | Opaque plastic. |
| `clearPlastic({ tint, opacity, roughness })` | See-through plastic with alpha blending, which also works in transparent exports. |
| `roundedRectShape(w, h, r)` | A rounded rectangle centered on the origin, for extrusions. |
| `remapUVs(geo, u0, v0, u1, v1)` | Maps a geometry's 0–1 UVs into a rectangle of the image. |
| `planarUVs(geo, uAxis, vAxis, uRange, vRange, rect)` | Projects UVs from two axes of the vertex positions. |
| `num`, `bool`, `str` | Read a parameter value, with a fallback for a missing or wrong one. |
| `mmParam(...)` | A number parameter in millimeters. |
| `round1(v)` | Rounds to one decimal, for a number shown in a text. |

The app's side of the contract is in `src/ui/modelUtils.ts` (`completeParams`, `sanitizeParam`, `slotFor`, `resolveTemplate`, `expectedAspects`, `snapToStep`) and `defaultParams` in `src/core/defaults.ts`; models do not import them.

## Composite models

A composite shows one model together with another object. Today's composites, in `src/models/composites.ts`, put a loose 120 mm disc next to a box, a DVD or Blu-ray keep case, or a CD jewel case:

- **Slots:** the base model's slots and the disc's `disc` slot (`compositeSlots`); a `disc` slot of the base is replaced, not repeated.
- **Parameters:** the base model's parameters, then three for the composition (`discPlacement`: behind, front or flat; `discOffset`; `discAngle`), then `discParams` (`compositeParams`). Base parameters that would clash are left out (the jewel case's `showDisc` and the base's own disc parameters), and of two parameters with one ID the first wins.
- **IDs:** every slot and parameter keeps the base model's ID, so artwork and settings carry over between, say, `dvd-case` and `dvd-case-disc`.
- **Build:** the base is built by the same function as the stand-alone model (`buildBox`, `buildKeepCase`, `buildJewelCase`, exported by their files), with the same context or one with changed parameters (`baseContext`). The composite measures the base's exact bounds from its vertices and places the disc against them with closed-form math (`discPose` in `composites/placement.ts`), so the disc never cuts into the case for any parameter value. It then reorders the disc's transparent parts against the case's, and puts the whole group on the floor, centered.

To add a composite, export the base model's build function from its file, define the composite in `composites.ts` with `compositeSlots`, `compositeParams` and `compose`, add it to `compositeModels`, and list it in `MODELS` right after its base model. A composite missing from `MODELS` is added at the end, so it never disappears from the gallery.

## Naming

- **IDs** of models are kebab-case (`print-business-card`); IDs of slots and parameters are camelCase (`lidSides`, `discPlacement`). IDs, and the values of select options, are saved in project files and in the autosaved session. **They are never renamed**: a project whose active model ID is unknown is refused with a message to update Mockup Director, and unknown models, slots, parameters and option values elsewhere in it are left out and reported in one warning (see [Project file](architecture.md#project-file-mdproj)); a session tab that names an unknown model is kept for a newer version.
- Related models share a prefix (`box-`, `print-`, `device-`); a composite adds `-disc` to its base model's ID.
- **Labels**, names and option labels are in sentence case ("Label inner diameter", "DVD case with disc"), with no unit (the parameter's `unit` shows it). Hints are full sentences.
- Format names are allowed (DVD, Blu-ray, CD, A4, ID-1). No brands, product names, logos or shapes that copy a real product: device models stay generic.

## Adding a model

1. Create a file in `src/models/`, for example `poster.ts`, and export a `ModelDefinition`:

   ```ts
   import * as THREE from 'three';
   import type { ModelDefinition } from '../core/types';
   import { castShadows, mmParam, num, placeOnGround, printMaterial, solidPlastic } from './shared';

   export const posterModel: ModelDefinition = {
     id: 'poster',
     category: 'print',
     name: 'Mounted poster',
     icon: '<svg viewBox="0 0 64 64"><rect x="16" y="8" width="32" height="48" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
     slots: [{ id: 'front', label: 'Front', aspect: 210 / 297 }],
     params: [
       mmParam('width', 'Width', 210, 50, 1000),
       mmParam('height', 'Height', 297, 50, 1000),
       mmParam('thickness', 'Thickness', 5, 1, 30, 0.5),
     ],
     build(ctx) {
       const w = num(ctx.params, 'width', 210), h = num(ctx.params, 'height', 297), t = num(ctx.params, 'thickness', 5);
       // BoxGeometry material order: +X, -X, +Y, -Y, +Z (front), -Z (back).
       const edge = solidPlastic('#f2f2f2', 0.6);
       const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), [
         edge, edge, edge, edge, printMaterial(ctx.getTexture('front')), edge,
       ]);
       return placeOnGround(castShadows(mesh));
     },
   };
   ```

2. Add it to the `MODELS` array in `src/models/registry.ts`, at its place in the gallery. It then appears in its category, with its Model and Artwork tabs.
3. Where it helps, give a slot a `template` and a `hint`, and the model a `description` and a `defaultCamera`.
4. Its new IDs and slots change the snapshots of the model tests (see [Testing](#testing)): update them with `npx vitest run -u tests/models`, and check in the diff that they only add. Add tests for what the model does beyond the contract, then run the checks:

   ```bash
   npm run lint
   ```

   ```bash
   npm run build
   ```

   ```bash
   npm test
   ```

## Testing

Every model in `MODELS` is checked by `tests/models/registry.test.ts`, so a new model is covered as soon as it is registered. Like every test (`vitest.config.ts`), it runs in Node: no WebGL and no DOM. `build` needs neither, since it only creates three.js objects. `tests/models/fakeContext.ts` holds the fakes: a context whose artwork is plain `THREE.Texture` objects shaped like each slot's aspect, with or without artwork in the slots, and a `document` whose canvases have no 2D context, which the models that draw on a 2D canvas (`books.ts`, `printFlat.ts`, `screen.ts`) already handle by leaving the drawing out. Tests for what one model does beyond the contract go in `tests/models/` too, mirroring `src/models/`.

The registry test checks:

- **Registry:** model IDs are unique and kebab-case, and `getModel` finds each model by its ID and falls back to the first one for an unknown ID.
- **Definition:** the category is a known one and the icon has a 64 × 64 view box.
- **Parameters:** IDs are unique and camelCase; every number has `min <= default <= max` and a `step` above 0; every boolean's default is a boolean; every select's option values are unique and its default is one of them; every color's default is `#rrggbb`.
- **Slots:** IDs are unique and camelCase, and every `aspect` is a finite number above 0.
- **Templates:** a template function gives a positive size with the defaults, with all number parameters at their `min`, with all at their `max`, with each one alone at its `min` and at its `max`, and with an empty object. At the defaults, the slot's `aspect` matches the template's width / height within 0.1 %.
- **Front:** at the defaults, the primary slot's artwork is on faces whose normals point to `+Z`, within about 25 degrees.
- **Placement:** built with the defaults and with all number parameters at their `min` and at their `max`, each with and without artwork, with each number parameter alone at its `min` and at its `max`, and with 20 sets of seeded random parameter values, the object has no `NaN` in any vertex position, its lowest point is at `y = 0` and it is centered on `x` and `z`, within 0.01 mm.
- **Shared textures:** after a build with the defaults and with all number parameters at their `min` and at their `max`, with and without artwork, and with each option of each select, the textures from `getTexture` keep their state (`repeat`, `offset`, `center`, `rotation`, wrapping, `flipY`, color space, anisotropy, filters, mipmaps, `version`, `matrixAutoUpdate` and `userData`) and their image, and are not disposed, also after `disposeObject` on the result.
- **Shown slots:** the slots whose texture is on a material at the defaults, with and without artwork, match a snapshot; update it (`npx vitest run -u tests/models`) only when a model is meant to show other slots.

A model that cannot meet a check yet is listed as an exception in the test, never left out: `PLACEMENT_EXCEPTIONS` lists models placed less exactly, for all parameter values or only for those its `when` picks, with a tolerance per axis as a fraction of the largest size (or none, which skips that axis), and `FRONT_EXCEPTIONS` lists models whose primary artwork faces `+Y` at the defaults. Every entry gives its reason; a known issue says so, and its entry goes when the issue is fixed.

`tests/models/ids.test.ts` pins the IDs that project files save: every model's ID and category, its slot IDs, its parameter IDs with their kind, the range and step of number parameters, and the values of select options. They are unique, and every select's default is one of its options. A snapshot diff that removes or narrows an entry means something saved in project files was renamed or narrowed, which must not happen (see [Naming](#naming)): never update the snapshot to make the test pass. A new model, slot, parameter or option, or a wider range, only adds or widens: update the snapshots with `npx vitest run -u tests/models`, and check in the diff that this is all they do.
