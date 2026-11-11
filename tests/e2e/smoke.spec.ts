/**
 * Smoke test of the desktop app: it starts, shows the 3D view (or its message for missing WebGL),
 * switches models, and saves a project through a mocked save dialog; writes a report of the steps,
 * their durations and the WebGL check, which the E2E workflow shows in its job summary.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { arch, tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { OUTPUT, logFile } from './folders.ts';

const TOOLBAR = 'header.toolbar';
/** The last-resort screen of src/main.ts, which replaces everything in #app. */
const START_FAILED = '#app > [role="alert"]';
const RECOVERY = '.modal-backdrop form.dialog[role="dialog"]';
const TAB = '.doctabs .doctab';
const CANVAS = 'main.viewport .stage-host .mockup-director-stage > canvas';
const NO_WEBGL = 'main.viewport .viewport-error[role="alert"]:not([hidden])';
const NO_WEBGL_TEXT = 'The 3D preview is not available: WebGL does not work on this computer.';
const model = (id: string) => `nav.sidebar-left button.gallery-item[data-model="${id}"]`;
const SAVE = 'header.toolbar button[aria-label^="Save project"]';
const ACTIVE_TAB_LABEL = '.doctabs .doctab.active .doctab-label';
/**
 * How long the session restore, which starts after the toolbar appears, gets to open the recovery
 * dialog or restored tabs. With a clean profile it finds nothing at once.
 */
const RESTORE_SETTLE_MS = 2000;

/** What the page's own WebGL probe found. */
interface Probe {
  webgl2: boolean;
  maxTextureSize: number | null;
  userAgent: string;
  innerWidth: number;
  innerHeight: number;
}

/** The report (OUTPUT/report.json, see tests/e2e/folders.ts), shown in the E2E workflow's job summary. */
interface Report {
  os: string;
  arch: string;
  passed: string[];
  failed: { test: string; error: string }[];
  startMs?: number;
  switchMs?: number;
  saveMs?: number;
  view?: 'webgl' | 'no-webgl';
  probe?: Probe;
  probeMatchesView?: boolean;
  dialogMock?: { calls: number; args: unknown };
  savedFile?: { bytes: number; app: unknown; version: unknown; modelId: unknown; folder: string[] };
  screenshot?: string;
  appLog: string;
}

const report: Report = { os: process.platform, arch: arch(), passed: [], failed: [], appLog: logFile() };
const began = performance.now();

/** The toasts on screen: the titles of the success ones, and title and detail of the error ones. */
interface Toasts {
  success: string[];
  errors: string[];
}

/** Reads all toasts at once, so that one disappearing meanwhile cannot make a later query wait. */
function toasts(): Promise<Toasts> {
  return browser.execute((): Toasts => {
    const text = (el: Element, selector: string) => el.querySelector(selector)?.textContent ?? '';
    const of = (kind: string) => Array.from(document.querySelectorAll(`.toasts .toast.toast-${kind}`));
    return {
      success: of('success').map((el) => text(el, '.toast-title')),
      errors: of('error').map((el) =>
        [text(el, '.toast-title'), text(el, '.toast-detail')].filter((t) => t !== '').join(': '),
      ),
    };
  });
}

/** The texts of the error toasts on screen: a model build or save failure shows one. */
async function errorToasts(): Promise<string[]> {
  return (await toasts()).errors;
}

/** The ids of the open tabs. */
function tabIds(): Promise<string[]> {
  return browser.execute(
    (selector) => Array.from(document.querySelectorAll(selector), (el) => el.getAttribute('data-tab') ?? ''),
    TAB,
  );
}

/** Fails unless the tab the app started with is still the only one and no recovery dialog is open. */
async function expectCleanProfile(firstTab: string): Promise<void> {
  const tabs = await tabIds();
  if (await $(RECOVERY).isExisting()) throw new Error('The e2e profile was not clean: the recovery dialog opened.');
  if (tabs.length !== 1 || tabs[0] !== firstTab)
    throw new Error(`The e2e profile was not clean: the session restore opened tabs (now ${tabs.length}).`);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Mockup Director', () => {
  let modelId = '';
  let firstTab = '';

  afterEach(function () {
    const test = this.currentTest;
    if (!test) return;
    if (test.state === 'passed') report.passed.push(test.title);
    else report.failed.push({ test: test.title, error: test.err?.message ?? String(test.state) });
  });

  after(async () => {
    try {
      await browser.saveScreenshot(join(OUTPUT, 'app.png'));
      report.screenshot = 'app.png';
    } catch (e) {
      report.screenshot = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    writeFileSync(join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  });

  it('starts', async () => {
    await browser.waitUntil(async () => (await $(TOOLBAR).isExisting()) || (await $(START_FAILED).isExisting()), {
      timeoutMsg: 'neither the toolbar nor the start failure screen appeared',
    });
    // The failure screen holds the error and its stack.
    if (await $(START_FAILED).isExisting())
      throw new Error(`The app failed to start: ${await $(START_FAILED).getText()}`);
    report.startMs = Math.round(performance.now() - began);
    const tabs = await tabIds();
    expect(tabs.length).toBe(1);
    firstTab = tabs[0] ?? '';
    await pause(RESTORE_SETTLE_MS);
    await expectCleanProfile(firstTab);
  });

  it('shows the 3D view or the no-WebGL message', async () => {
    const probe = await browser.execute((): Probe => {
      const gl = document.createElement('canvas').getContext('webgl2');
      return {
        webgl2: gl !== null,
        maxTextureSize: gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : null,
        userAgent: navigator.userAgent,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      };
    });
    report.probe = probe;
    await browser.waitUntil(async () => (await $(CANVAS).isExisting()) || (await $(NO_WEBGL).isDisplayed()), {
      timeoutMsg: 'neither the 3D view nor the no-WebGL message appeared',
    });
    if (await $(CANVAS).isExisting()) {
      const canvas = $(CANVAS);
      await expect(canvas).toBeDisplayed();
      const size = await canvas.getSize();
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      report.view = 'webgl';
    } else {
      const text = await $(NO_WEBGL).getText();
      expect(text.slice(0, NO_WEBGL_TEXT.length)).toBe(NO_WEBGL_TEXT);
      report.view = 'no-webgl';
    }
    report.probeMatchesView = probe.webgl2 === (report.view === 'webgl');
    // The app shows the same message for any failure to create the 3D view. A canvas although the
    // probe found no WebGL 2 is only reported.
    if (probe.webgl2 && report.view === 'no-webgl')
      throw new Error('The 3D view failed to start although WebGL 2 works in the page: see the app log.');
    expect(await errorToasts()).toEqual([]);
  });

  it('switches to another model', async () => {
    const start = performance.now();
    await expectCleanProfile(firstTab);
    modelId = (await $(model('device-phone')).getAttribute('aria-pressed')) === 'true' ? 'box' : 'device-phone';
    await $(model(modelId)).click();
    // The gallery renders its buttons again, so each check queries the button afresh.
    await browser.waitUntil(async () => (await $(model(modelId)).getAttribute('aria-pressed')) === 'true', {
      timeoutMsg: `the model ${modelId} was not selected`,
    });
    expect(await errorToasts()).toEqual([]);
    report.switchMs = Math.round(performance.now() - start);
    // A model that fails to build shows an error toast a moment later.
    await pause(1000);
    expect(await errorToasts()).toEqual([]);
  });

  it('saves a project through the save dialog', async () => {
    const start = performance.now();
    const folder = mkdtempSync(join(tmpdir(), 'mockup-director-e2e-'));
    let dialog: Awaited<ReturnType<typeof browser.tauri.mock>> | undefined;
    try {
      const target = join(folder, 'smoke.mdproj');
      // The path is absolute and ends in .mdproj, so the app writes it as returned (replace) and
      // never shows the dialog again.
      dialog = await browser.tauri.mock('plugin:dialog|save');
      await dialog.mockResolvedValue(target);
      await $(SAVE).click();
      // Ends on the success message, or on an error toast, which says why the save failed.
      let shown: Toasts = { success: [], errors: [] };
      await browser.waitUntil(
        async () => {
          shown = await toasts();
          return shown.success.includes('Project saved') || shown.errors.length > 0;
        },
        { interval: 100, timeoutMsg: 'neither a "Project saved" message nor an error appeared' },
      );
      if (!shown.success.includes('Project saved')) throw new Error(`The save failed: ${shown.errors.join('; ')}`);
      await expect($(ACTIVE_TAB_LABEL)).toHaveText('smoke');
      report.saveMs = Math.round(performance.now() - start);

      await dialog.update();
      const calls = dialog.mock.calls;
      report.dialogMock = { calls: calls.length, args: calls[0] };
      expect(calls.length).toBe(1);
      const args = calls[0]?.[0] as { options?: { filters?: { extensions?: string[] }[] } } | undefined;
      expect(args?.options?.filters?.[0]?.extensions).toEqual(['mdproj']);

      expect(existsSync(target)).toBe(true);
      const bytes = statSync(target).size;
      const file = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
      const listed = readdirSync(folder);
      report.savedFile = { bytes, app: file.app, version: file.version, modelId: file.modelId, folder: listed };
      expect(bytes).toBeGreaterThan(0);
      expect(file.app).toBe('mockup-director');
      expect(file.version).toBe(1);
      expect(file.modelId).toBe(modelId);
      // No temporary file of the save is left next to it.
      expect(listed).toEqual(['smoke.mdproj']);
    } finally {
      // Later saves reach the real dialog again, not the folder removed here.
      await dialog?.mockRestore();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
