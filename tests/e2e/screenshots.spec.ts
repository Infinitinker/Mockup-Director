/**
 * Takes the README's screenshots (docs/images/*.png) in the e2e build of the desktop app, at its
 * window size of 1440 × 900: each puts the artwork from docs/images/screenshot-artwork on a model,
 * sets what the shot shows, opens its tab of the inspector and saves the page. Not part of the
 * end-to-end tests: run it with npm run screenshots (docs/development.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser } from '@wdio/globals';

const IMAGES = fileURLToPath(new URL('../../docs/images/', import.meta.url));
const ARTWORK = join(IMAGES, 'screenshot-artwork');
const TOOLBAR = 'header.toolbar';
const model = (id: string) => `nav.sidebar-left button.gallery-item[data-model="${id}"]`;
const card = (slot: string) => `.slot-card[data-slot="${slot}"]`;
/** How long the 3D view gets to show a change before a screenshot. */
const SETTLE_MS = 2500;

/** One screenshot: the model, the artwork file of each slot, the settings and the tab it shows. */
interface Shot {
  file: string;
  model: string;
  artwork: Record<string, string>;
  selects?: Record<string, string>;
  tab: 'artwork' | 'model' | 'scene' | 'export';
}

const SHOTS: Shot[] = [
  {
    file: 'artwork.png',
    model: 'box',
    artwork: {
      front: 'box-front.svg',
      back: 'box-back.svg',
      left: 'box-side.svg',
      right: 'box-side.svg',
      top: 'box-top.svg',
      bottom: 'box-top.svg',
    },
    tab: 'artwork',
  },
  { file: 'scene.png', model: 'book-hardcover', artwork: { cover: 'book-cover.svg' }, tab: 'scene' },
  { file: 'model.png', model: 'device-laptop', artwork: { screen: 'laptop-screen.svg' }, tab: 'model' },
  {
    file: 'export.png',
    model: 'print-business-card',
    artwork: { front: 'card-front.svg', back: 'card-back.svg' },
    selects: { Arrangement: 'pair' },
    tab: 'export',
  },
];

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Drops an artwork file on the card of its slot, as a user would, and waits until the slot holds it. */
async function dropArtwork(slot: string, file: string): Promise<void> {
  const text = readFileSync(join(ARTWORK, file), 'utf8');
  await browser.execute(
    (selector, name, svg) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`No card matches ${selector}.`);
      const data = new DataTransfer();
      data.items.add(new File([svg], name, { type: 'image/svg+xml' }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    },
    card(slot),
    file,
    text,
  );
  await $(`${card(slot)}.filled`).waitForExist({ timeoutMsg: `the ${slot} slot did not take ${file}` });
}

/** Sets the select whose label is `label` in the open panel, as a user would. */
async function choose(label: string, value: string): Promise<void> {
  await browser.execute(
    (text, option) => {
      const field = Array.from(document.querySelectorAll('.ctl-select')).find(
        (el) => el.querySelector('.ctl-label')?.textContent === text,
      );
      const select = field?.querySelector('select');
      if (!select) throw new Error(`No select is labeled ${text}.`);
      select.value = option;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    label,
    value,
  );
}

/** Fails on an error toast, and closes the other toasts, so that none is in the screenshot. */
async function clearToasts(): Promise<void> {
  const errors = await browser.execute(() =>
    Array.from(document.querySelectorAll('.toasts .toast-error'), (el) => el.textContent ?? ''),
  );
  if (errors.length) throw new Error(`The app showed an error: ${errors.join('; ')}`);
  await browser.execute(() => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('.toasts .toast-close')) button.click();
  });
}

describe('README screenshots', () => {
  before(async () => {
    await $(TOOLBAR).waitForExist({ timeoutMsg: 'the toolbar did not appear' });
  });

  for (const shot of SHOTS) {
    it(`takes ${shot.file}`, async () => {
      await $(model(shot.model)).click();
      await browser.waitUntil(async () => (await $(model(shot.model)).getAttribute('aria-pressed')) === 'true', {
        timeoutMsg: `the model ${shot.model} was not selected`,
      });
      await $('#tab-artwork').click();
      for (const [slot, file] of Object.entries(shot.artwork)) await dropArtwork(slot, file);
      if (shot.selects) {
        await $('#tab-model').click();
        for (const [label, value] of Object.entries(shot.selects)) await choose(label, value);
      }
      await $(`#tab-${shot.tab}`).click();
      await pause(SETTLE_MS);
      await clearToasts();
      // No focus ring or hover in the picture.
      await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
      await pause(500);
      await browser.saveScreenshot(join(IMAGES, shot.file));

      // The next model starts without this one's artwork, so the gallery shows no count on it.
      await $('#tab-artwork').click();
      for (const slot of Object.keys(shot.artwork)) {
        await $(`${card(slot)} button[aria-label="Remove artwork"]`).click();
        await $(`${card(slot)}:not(.filled)`).waitForExist();
      }
    });
  }
});
