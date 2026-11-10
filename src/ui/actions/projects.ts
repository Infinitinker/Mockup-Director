/**
 * The project actions: a new project, opening project files (each in its own tab, held back while an export runs),
 * saving, closing with the unsaved-changes question, and switching tabs.
 */
import { freshDocument } from '../../documents/tabs';
import { pickFiles, saveBlob } from '../../platform/files';
import {
  PROJECT_EXT,
  PROJECT_FILE_FILTER,
  hydrateProject,
  projectNameOf,
  projectWarning,
  readProjectFile,
  toProjectFile,
} from '../../project/format';
import type { ActionContext, Actions } from '../context';
import { choiceDialog } from '../dialog';
import { errorMessage, logShownError } from '../errors';
import { tabLabel } from '../tabbar';
import { notify } from '../toast';

export interface ProjectActions
  extends Pick<Actions, 'newProject' | 'openProject' | 'saveProject' | 'closeProject' | 'switchProject'> {
  /**
   * Opens project files, each in its own tab; the first may take the place of an untouched new tab.
   * A file that cannot be opened is reported and skipped; one whose parts were left out opens with a
   * warning.
   */
  openProjectFiles(files: File[]): Promise<void>;
}

/** The project actions; project files that arrive during an export open when it ends. */
export function createProjectActions({
  store,
  docs,
  exportBusy,
}: Pick<ActionContext, 'store' | 'docs' | 'exportBusy'>): ProjectActions {
  /** Project files that arrived while an export ran; they open when it ends. */
  let waitingFiles: File[] = [];

  const openProjectFiles = async (files: File[]): Promise<void> => {
    if (!files.length) return;
    if (exportBusy.value) {
      waitingFiles.push(...files);
      notify.info(`Projects to open: ${files.length}. They open when the export ends.`);
      return;
    }
    document.body.classList.add('is-busy');
    try {
      for (const f of files) {
        try {
          const { file, report } = await readProjectFile(f);
          const { state, failed } = await hydrateProject(file);
          const name = projectNameOf(f.name);
          // An export may have started while the file was read: the stage must keep its project.
          if (exportBusy.value) {
            docs.add(state, { name, activate: false });
          } else if (docs.activeIsPristine()) {
            store.replace(state, 'project');
            docs.markActiveOpened(name);
          } else {
            docs.add(state, { name });
          }
          notify.success('Project opened', f.name);
          const warning = projectWarning(report, failed, 'file');
          if (warning) notify.warning(warning, f.name);
        } catch (e) {
          logShownError(`Could not open the project ${f.name}`, e);
          notify.error('Could not open the project', `${f.name}: ${errorMessage(e)}`);
        }
      }
    } finally {
      document.body.classList.remove('is-busy');
    }
  };

  exportBusy.subscribe((busy) => {
    if (busy || !waitingFiles.length) return;
    const files = waitingFiles;
    waitingFiles = [];
    void openProjectFiles(files);
  });

  const actions: ProjectActions = {
    openProjectFiles,

    async newProject() {
      if (exportBusy.value) return;
      docs.add(freshDocument(store.state.modelId));
    },

    async openProject(file?: File) {
      try {
        const files = file ? [file] : await pickFiles(`.${PROJECT_EXT}`, true);
        await openProjectFiles(files);
      } catch (e) {
        logShownError('Could not open the project', e);
        notify.error('Could not open the project', errorMessage(e));
      }
    },

    async saveProject(tabId = docs.activeId) {
      try {
        // Everything is taken from the tab now: other tabs may become active while the save dialog
        // is open (a project opened from the system), and edits may continue while it writes.
        if (!docs.tab(tabId)) return false;
        docs.activate(tabId);
        const revision = store.revision;
        const file = toProjectFile(store.state);
        const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
        const suggested = `${docs.tab(tabId)?.name || 'project'}.${PROJECT_EXT}`;
        const saved = await saveBlob(blob, suggested, [PROJECT_FILE_FILTER]);
        if (!saved) return false;
        docs.markSaved(tabId, revision, projectNameOf(saved));
        notify.success('Project saved', saved);
        return true;
      } catch (e) {
        logShownError('Could not save the project', e);
        notify.error('Could not save the project', errorMessage(e));
        return false;
      }
    },

    async closeProject(tabId = docs.activeId) {
      if (exportBusy.value) return;
      const tab = docs.tab(tabId);
      if (!tab) return;
      if (tab.dirty) {
        // Show the project the question is about.
        docs.activate(tabId);
        const choice = await choiceDialog({
          title: `Save changes to “${tabLabel(tab)}”?`,
          message: 'Your changes will be lost if you don’t save them.',
          choices: [
            { id: 'save', label: 'Save…', primary: true },
            { id: 'discard', label: 'Don’t save', danger: true },
            { id: 'cancel', label: 'Cancel' },
          ],
        });
        // The tab may have been closed meanwhile; save exactly this tab, whatever is active now.
        if (!docs.tab(tabId)) return;
        if (choice === 'save') {
          if (!(await actions.saveProject(tabId))) return;
        } else if (choice !== 'discard') {
          return;
        }
      }
      docs.close(tabId);
    },

    switchProject(step) {
      if (exportBusy.value) return;
      docs.cycle(step);
    },
  };
  return actions;
}
