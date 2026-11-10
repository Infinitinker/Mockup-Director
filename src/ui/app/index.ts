/**
 * Starts the app: creates the store and the open tabs, the 3D preview, the session keeper and the actions, builds
 * the layout and wires them together. Every open project is a tab (../../documents/tabs); the store works on the
 * active one, and the whole set of tabs is autosaved as a session (./sessionKeeper).
 */
import { MODELS } from '../../models/registry';
import { Store, hasAny } from '../../documents/store';
import { Documents, freshDocument } from '../../documents/tabs';
import type { AnimationProgress } from '../../export/animation';
import { inDesktopApp } from '../../platform/files';
import { handleOpenedFiles } from '../../platform/launch';
import { isMac } from '../../platform/os';
import { setWindowTitle } from '../../platform/window';
import { createArtworkActions } from './actions/artwork';
import { createExportingActions } from './actions/exporting';
import { createModelActions } from './actions/model';
import { createProjectActions } from './actions/projects';
import { createViewActions } from './actions/view';
import type { Actions, AppContext, TabId } from '../context';
import { Signal, h } from '../dom';
import { errorMessage, logShownError } from '../errors';
import { createGallery } from './gallery';
import { createInspector } from './inspector';
import { createPreview } from './preview';
import { keepSession } from './sessionKeeper';
import { installShortcuts } from './shortcuts';
import { createTabBar, tabLabel } from './tabbar';
import { mountToasts, notify } from '../toast';
import { createToolbar } from './toolbar';
import { createViewportShell } from './viewport';

export function startApp(root: HTMLElement): void {
  root.classList.add('app');
  // Only macOS draws traffic lights over the toolbar (titleBarStyle "Overlay"); Windows keeps its
  // native title bar, so no extra left inset there.
  root.classList.toggle('has-traffic-lights', isMac && inDesktopApp());
  mountToasts(document.body);

  const store = new Store(freshDocument(MODELS[0].id));
  /** The open projects (tabs); the store holds the active one. */
  const docs = new Documents(store, () => freshDocument(store.state.modelId));
  const exportBusy = new Signal(false);
  const animationProgress = new Signal<AnimationProgress | null>(null);
  const loadingSlots = new Signal<ReadonlySet<string>>(new Set());

  const viewport = createViewportShell();
  const preview = createPreview(store, viewport.host, (message) => viewport.showError(message));
  const session = keepSession(docs, exportBusy);

  let showTab: (tab: TabId) => void = () => undefined;
  const { openProjectFiles, ...projectActions } = createProjectActions({ store, docs, exportBusy });
  const actions: Actions = {
    ...createModelActions({ store }),
    ...projectActions,
    ...createExportingActions({ store, exportBusy, animationProgress, preview }),
    undo() {
      store.undo();
    },
    redo() {
      store.redo();
    },
    ...createViewActions({ store }),
    ...createArtworkActions({ store, docs, loadingSlots }),
    showTab(tab) {
      showTab(tab);
    },
  };

  store.subscribe((e) => {
    if (hasAny(e, 'model', 'params', 'artwork')) preview.rebuild.schedule();
    // Camera changes made in the viewport are already applied there – never push them back.
    if (e.kinds.has('scene') || (e.kinds.has('camera') && e.source !== 'stage')) preview.applyScene.schedule();
    if (hasAny(e, 'model', 'params', 'artwork', 'scene', 'camera', 'export')) session.scheduleAutosave();
  });

  const ctx: AppContext = { store, stage: preview.stage, actions, exportBusy, animationProgress, loadingSlots };

  const toolbar = createToolbar(ctx);
  const gallery = createGallery(ctx);
  const inspector = createInspector(ctx);
  const tabBar = createTabBar(docs, {
    onNew: () => void actions.newProject(),
    onClose: (id) => void actions.closeProject(id),
    onActivate: (id) => {
      if (!exportBusy.value) docs.activate(id);
    },
    busy: exportBusy,
  });
  showTab = inspector.show;
  viewport.mount(ctx);
  root.replaceChildren(
    toolbar.el,
    h(
      'div',
      { class: 'workspace' },
      gallery.el,
      h('div', { class: 'workspace-center' }, tabBar.el, viewport.el),
      inspector.el,
    ),
  );

  /** The window title names the active project, with a • when it has unsaved changes. */
  const updateTitle = () => {
    const tab = docs.tab(docs.activeId);
    setWindowTitle(tab ? `${tabLabel(tab)}${tab.dirty ? ' •' : ''} – Mockup Director` : 'Mockup Director');
  };
  docs.subscribe(updateTitle);
  updateTitle();

  installShortcuts(ctx);

  // Dropping files outside the drop zones must not navigate the web view away.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  window.addEventListener('unhandledrejection', (e) => {
    notify.error('An action could not be finished', errorMessage(e.reason));
  });

  // Keep the renderer sized to its container.
  preview.followSize();

  // First frame, then the restore of the last session.
  preview.applyScene.schedule();
  preview.applyScene.flush();
  preview.rebuild.schedule();
  preview.rebuild.flush();

  session.restore(() => {
    // Projects the operating system asked to open (a double-clicked .mdproj), each in a tab.
    void handleOpenedFiles(
      (files) => void openProjectFiles(files),
      (e) => {
        logShownError('Could not open the project', e);
        notify.error('Could not open the project', errorMessage(e));
      },
    );
  });
}
