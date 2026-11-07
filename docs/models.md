# Adding a model

Each model is a `ModelDefinition` (see `src/core/types.ts`): its name and gallery icon, its image slots, its parameters, and a `build()` function that makes the 3D object. The parameter panel and the image slots in the interface are built from the definition, so a model needs no UI code. Follow the [3D conventions](architecture.md#3d-conventions).

1. Create a file in `src/models/`, for example `poster.ts`, and export a `ModelDefinition`:

   ```ts
   import * as THREE from 'three';
   import type { ModelDefinition } from '../core/types';
   import { L, castShadows, mmParam, num, placeOnGround, printMaterial, solidPlastic } from './shared';

   export const posterModel: ModelDefinition = {
     id: 'poster',
     category: 'print',
     name: L('Mounted poster'),
     icon: '<svg viewBox="0 0 64 64"><rect x="16" y="8" width="32" height="48" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
     slots: [{ id: 'front', label: L('Front'), aspect: 210 / 297 }],
     params: [
       mmParam('w', L('Width'), 210, 50, 1000),
       mmParam('h', L('Height'), 297, 50, 1000),
       mmParam('t', L('Thickness'), 5, 1, 30, 0.5),
     ],
     build(ctx) {
       const w = num(ctx.params, 'w', 210), h = num(ctx.params, 'h', 297), t = num(ctx.params, 't', 5);
       // BoxGeometry material order: +X, -X, +Y, -Y, +Z (front), -Z (back).
       const edge = solidPlastic('#f2f2f2', 0.6);
       const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), [
         edge, edge, edge, edge, printMaterial(ctx.getTexture('front')), edge,
       ]);
       return placeOnGround(castShadows(mesh));
     },
   };
   ```

2. Add it to the `MODELS` array in `src/models/registry.ts`. It then appears in the gallery, and its parameter panel and image slots are built from `params` and `slots`.
3. Optionally give a slot a `template` (a print template with dimensions and bleed, which users can download) and the model a `defaultCamera` (its starting view).
4. Translate its texts: every `L()` text needs an entry in the `texts` table of each locale other than English, for example in `src/i18n/pl.ts`:

   ```ts
   'Mounted poster': 'Plakat na podkładzie',
   ```

   `npm run check:i18n` lists the texts that are still missing. Texts that already exist (such as `'Front'` or `'Width'`) are translated once for all models. See [translations.md](translations.md), also for texts with numbers in them and for contexts.
