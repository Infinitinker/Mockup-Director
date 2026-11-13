/**
 * WebdriverIO config of npm run screenshots: the end-to-end tests' config (wdio.config.ts), running
 * screenshots.spec.ts instead of the tests.
 */
import { config as tests } from './wdio.config.ts';

export const config: WebdriverIO.Config = { ...tests, specs: ['./screenshots.spec.ts'] };
