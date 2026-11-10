/**
 * The entry point of the end-to-end test build (vite build --mode e2e): installs the WebdriverIO
 * Tauri bridge, which lets the tests mock commands such as the save dialog, then starts the app
 * exactly as src/main.ts does.
 */
import '@wdio/tauri-plugin';
import '../../../src/main';
