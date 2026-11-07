import './styles.css';
import { startApp } from './ui/app';

const root = document.getElementById('app');
if (root) {
  try {
    startApp(root);
  } catch (e) {
    // Last-resort error screen – the app shell itself failed to start.
    console.error('[mockup-director] startup failed', e);
    root.textContent = '';
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'font:13px -apple-system,system-ui,sans-serif;padding:32px;max-width:560px;margin:10vh auto;line-height:1.5';
    const h = document.createElement('h1');
    h.style.cssText = 'font-size:17px;margin:0 0 8px';
    h.textContent = 'Mockup Director failed to start';
    const p = document.createElement('pre');
    p.style.cssText = 'white-space:pre-wrap;opacity:.7';
    p.textContent = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    box.append(h, p);
    root.appendChild(box);
  }
}
