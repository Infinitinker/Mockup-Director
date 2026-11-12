# Your first model

This guide walks you through adding a model to Mockup Director, step by step, with no programming experience needed. You will add a mounted poster: a print on a stiff board that stands on the floor of the scene. On the way you will see your model in the app, make it your own, check it and send it to the project. It takes about an hour the first time.

A model is one kind of product the app can show, such as a box, a book or a phone. Each model is a single short file that describes it: its name, the artwork it takes, the sizes you can change, and how to build its 3D shape. The app builds its menus from that file, so you never touch the rest of the interface.

When you want to know more than this guide shows, [models.md](models.md) is the full reference.

## What you need

- A [GitHub](https://github.com/) account, to send your model to the project.
- [Git](https://git-scm.com/downloads), which downloads the project and records your changes.
- [Node.js](https://nodejs.org/) 22 or newer, which runs the app from its source code. Its installer adds `npm`, the command that installs and starts everything.
- A text editor that saves plain text, such as a code editor. A word processor won't do.

You don't need Rust or the other tools in [development.md](development.md): you will see your model in your web browser.

The commands below go in a terminal: on Windows the Command Prompt or Git Bash, on macOS the Terminal app, on Linux any terminal. Type or paste one command, press Enter, and wait until it has finished before you type the next.

## 1. Get the code

On GitHub, open [the project's page](https://github.com/Infinitinker/Mockup-Director) and click **Fork**: this makes your own copy of the project, which you can change. Then download your copy, replacing `YOUR-NAME` with your GitHub user name:

```bash
git clone --branch dev https://github.com/YOUR-NAME/Mockup-Director.git
```

`--branch dev` gets the `dev` branch, where new work goes. Go into the new folder:

```bash
cd Mockup-Director
```

Install what the project needs. This downloads a few hundred megabytes into a `node_modules` folder and takes a minute or two:

```bash
npm install
```

## 2. Start the app

```bash
npm run dev
```

The terminal shows an address, `http://localhost:1420`. Open it in your web browser: it is Mockup Director, running from the code on your computer. Leave the terminal open while you work. Every time you save a file, the page updates by itself. To stop the app, press Ctrl+C in the terminal.

## 3. Write the model

Every model lives in the `src/models` folder. Create a new file there named `poster.ts`, paste this into it, and save it:

```ts
/** A mounted poster ('print-poster'): a print on a stiff board, with its width, height and thickness. */
import * as THREE from 'three';
import type { ModelDefinition } from '../core/types/model';
import { castShadows, placeOnGround } from './geometry';
import { icon } from './icon';
import { printMaterial, solidPlastic } from './materials';
import { mmParam, num } from './params';

export const posterModel: ModelDefinition = {
  id: 'print-poster',
  category: 'print',
  name: 'Mounted poster',
  icon: icon('<rect x="16" y="8" width="32" height="48" rx="1"/>'),
  slots: [{ id: 'front', label: 'Front', aspect: 210 / 297 }],
  params: [
    mmParam('width', 'Width', 210, 50, 1000),
    mmParam('height', 'Height', 297, 50, 1000),
    mmParam('thickness', 'Thickness', 5, 1, 30, 0.5),
  ],
  build(ctx) {
    const width = num(ctx.params, 'width', 210);
    const height = num(ctx.params, 'height', 297);
    const thickness = num(ctx.params, 'thickness', 5);
    // A box has six sides, in this order: right, left, top, bottom, front, back.
    const edge = solidPlastic('#f2f2f2', 0.6);
    const front = printMaterial(ctx.getTexture('front'));
    const sides = [edge, edge, edge, edge, front, edge];
    const board = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), sides);
    return placeOnGround(castShadows(board));
  },
};
```

What each part does:

- **The first line**, between `/**` and `*/`, says in a sentence what the file is. Every file in the project starts with one.
- **The `import` lines** bring in the tools the model uses: `THREE` is [three.js](https://threejs.org/), the library that draws the 3D scene, and the others are helpers the built-in models share, from the files next to yours (`geometry.ts`, `icon.ts`, `materials.ts`, `params.ts`).
- **`id: 'print-poster'`** is the model's name inside the app. Project files save it, so it never changes once the model is released. It is lowercase words joined by hyphens, starting with the prefix that models of its kind share: `print-` for print, `box-` for boxes, `device-` for devices.
- **`category: 'print'`** is the group the model appears in: `box`, `disc`, `book`, `print` or `device`.
- **`name: 'Mounted poster'`** is what you see in the app, with only the first word capitalized.
- **`icon`** is the small drawing next to the name, on a grid of 64 × 64. This one is a tall rectangle: 32 wide and 48 high, starting 16 from the left and 8 from the top.
- **`slots`** are the places artwork goes. The poster has one, `front`. Its `aspect`, width divided by height, is that of an A4 sheet, 210 by 297 mm: the app warns when someone's artwork has other proportions.
- **`params`** are the settings in the **Model** tab. `mmParam('width', 'Width', 210, 50, 1000)` makes a size in millimeters named `width`, labeled "Width", which starts at 210 and goes from 50 to 1000. The thickness also gives a step of 0.5 mm.
- **`build`** makes the 3D object from those settings, every time they change:
  - `num(ctx.params, 'width', 210)` reads a setting's current value; 210 is used if there is none.
  - `solidPlastic('#f2f2f2', 0.6)` is the material of the board's edges: a light gray (a color written as in web pages) that is fairly matte (0 is glossy, 1 is fully matte).
  - `printMaterial(ctx.getTexture('front'))` is printed paper showing the artwork of the `front` slot, or a placeholder while there is none.
  - `new THREE.BoxGeometry(width, height, thickness)` is a box of that size. One unit is one millimeter, and the front of the box faces the camera. `sides` gives each of its six sides a material: the artwork goes on the front, the edge material on the rest.
  - `placeOnGround(castShadows(board))` lets the board cast shadows and stands it on the floor, in the middle of the scene.

## 4. Add it to the gallery

The app shows the models listed in `src/models/registry.ts`. Open that file and make two changes.

At the end of the `import` lines at the top, add:

```ts
import { posterModel } from './poster';
```

In the list `MODELS` below them, add `posterModel,` on its own line after `bifoldModel,`, the last of the print models:

```ts
  bifoldModel,
  posterModel,
```

Save the file. The page in your browser reloads: open **Print** in the gallery on the left and choose **Mounted poster**. Drop an image on its **Front** card in the **Artwork** tab, and change its size in the **Model** tab.

If the page shows an error instead, read its first line: it names the file and the line where something is wrong, usually a missing comma or quote. Fix it and save again.

## 5. Make it yours

Now change it into the model you have in mind. A few things to try, saving after each one to see the result:

- Change the starting size, or the color of the edges.
- Change the `id`, `name` and `icon` to those of your model, and the name `posterModel` (in both files) to match.
- Look at how a built-in model you like does something. The table at the top of [models.md](models.md) says which file holds each one; `print/flat/` and `box/` are good places to start.

[models.md](models.md) lists everything a model can have: a description, settings with on/off switches or choices, a camera to start with, print templates for the artwork, and the helpers for shapes and materials. Keep to the project's rules for models, which are in its [Naming](models.md#naming) section: models stay generic, with no brand names, logos or shapes that copy a real product.

## 6. Run the checks

The project checks every model automatically. Before you send yours, run the same checks on your computer. Stop the app with Ctrl+C first, or open a second terminal in the same folder.

1. In `README.md`, near the top, raise the number in "Shows your artwork on … models" by one. A check compares it with the list of models.
2. The tests keep a record of the names that project files save. Add your model to it:

   ```bash
   npm test -- -u tests/models
   ```

   It takes a minute or two. In the summary at the end, the `Snapshots` line says `2 updated`.
3. Let the project lay out your code the way all its files are laid out:

   ```bash
   npm run format
   ```

4. Check the code's style. It should end with no errors:

   ```bash
   npm run lint
   ```

5. Check the code for mistakes and build the app. It should end with a line that starts with `✓ built in`:

   ```bash
   npm run build
   ```

6. Run all the tests. They build your model with the smallest, the largest and many other sizes, and check that it stands on the floor, faces the front and never changes the artwork. In the summary at the end, the `Tests` line should say `passed` and nothing `failed`:

   ```bash
   npm test
   ```

When a check fails, its message says what is wrong, and for a test which model and which check. [Testing](models.md#testing) explains each check.

## 7. Send it

Record your changes in Git, in a branch of their own, with a short message saying what they add:

```bash
git switch -c poster
```

```bash
git add --all
```

```bash
git commit -m "feat(models): add a mounted poster"
```

If this is the first time you use Git, it asks who you are and shows the two commands that tell it your name and email. Run them with yours, then run the `git commit` command again.

Then send them to your copy on GitHub:

```bash
git push -u origin poster
```

Open your copy on GitHub: it offers **Compare & pull request**. Click it, choose `dev` as the base branch, say what your model is, and add a screenshot. Then click **Create pull request**. The project's checks run on it, and someone will review it.

Stuck at any step? Ask in your pull request, or [open an issue](https://github.com/Infinitinker/Mockup-Director/issues/new/choose) with the model request form and describe the model you want: someone may build it.
