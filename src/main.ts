/**
 * The entry point: starts logging uncaught errors, then starts the app, and shows a plain error screen
 * when that fails. `./platform/uncaught` stays the first import, so that errors thrown while the other
 * modules are evaluated are logged too.
 */
import './platform/uncaught';
import './styles.css';
import { startApp } from './ui/app';
import { log } from './platform/log';

const root = document.getElementById('app');
if (root) {
  try {
    startApp(root);
  } catch (e) {
    // Last-resort error screen – the app itself failed to start.
    log.error('Mockup Director failed to start', e);
    root.textContent = '';
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText =
      'font:13px -apple-system,system-ui,sans-serif;padding:32px;max-width:560px;margin:10vh auto;line-height:1.5';
    const h = document.createElement('h1');
    h.style.cssText = 'font-size:17px;margin:0 0 8px';
    h.textContent = 'Mockup Director failed to start';
    const tip = document.createElement('p');
    tip.style.cssText = 'margin:0 0 8px';
    tip.textContent = 'Restart Mockup Director. If it still does not start, report the problem with the details below.';
    const p = document.createElement('pre');
    p.style.cssText = 'white-space:pre-wrap;opacity:.7';
    p.textContent = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    box.append(h, tip, p);
    root.appendChild(box);
  }
}
