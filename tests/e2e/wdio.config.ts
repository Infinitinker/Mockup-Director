/**
 * WebdriverIO config of the end-to-end tests: starts the e2e build of the desktop app (npm run
 * e2e:build) with the embedded WebDriver server, one instance at a time.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TauriCapabilities } from '@wdio/tauri-service';
import { SevereServiceError } from 'webdriverio';
import { APP, OUTPUT, clearProfile } from './folders.ts';

// 'tauri:options' is not part of WebdriverIO.Capabilities; TauriCapabilities adds it.
const capabilities: TauriCapabilities[] = [
  {
    browserName: 'tauri',
    'tauri:options': { application: APP },
    // The embedded server speaks classic WebDriver, not WebDriver BiDi.
    'wdio:enforceWebDriverClassic': true,
  },
];

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./smoke.spec.ts'],
  // Mocks belong to the one app instance.
  maxInstances: 1,
  capabilities,
  services: [
    [
      '@wdio/tauri-service',
      {
        // On every system: no msedgedriver, WebKitWebDriver or tauri-driver.
        driverProvider: 'embedded',
        // A debug build on a CI runner starts slowly (the default is 60 s).
        startTimeout: 120_000,
        captureBackendLogs: true,
        captureFrontendLogs: true,
        // Each test starts with the real commands, not the mocks of an earlier one.
        restoreMocks: true,
      },
    ],
  ],
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 180_000 },
  reporters: ['spec'],
  logLevel: 'info',
  outputDir: join(OUTPUT, 'wdio-logs'),
  // The first frames with software rendering (llvmpipe, WARP) take seconds.
  waitforTimeout: 60_000,
  // Runs before the service starts the app. Only a SevereServiceError stops the run.
  onPrepare() {
    if (!existsSync(APP)) throw new SevereServiceError(`No e2e build at ${APP}: run npm run e2e:build first.`);
    mkdirSync(OUTPUT, { recursive: true });
    try {
      clearProfile();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new SevereServiceError(
        `Cannot clear the e2e app data folder (${reason}): close the e2e app, then try again.`,
      );
    }
  },
};
