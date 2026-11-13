/**
 * The project actions: a new project, opening project files (each in its own tab, held back while an export runs),
 * saving to the tab's file or to one the user picks, closing with the unsaved-changes question, and switching tabs.
 */
import { freshDocument } from '../../../documents/tabs';
import { type SavedFile, saveBlobAs, writeBlob } from '../../../platform/files';
import { type OpenedProject, pickProjectFiles } from '../../../platform/opened';
import {
  PROJECT_EXT,
  PROJECT_FILE_FILTER,
  hydrateProject,
  projectFileText,
  projectNameOf,
  projectWarning,
  readProjectFile,
  toProjectFile,
} from '../../../project/format';
import type { ActionContext, Actions } from '../../context';
import { choiceDialog } from '../../dialogs/modal';
import { errorMessage, logShownError } from '../../errors';
import { tabLabel } from '../tabbar';
import { notify } from '../../toast';

export interface ProjectActions
  extends Pick<
    Actions,
    'newProject' | 'openProject' | 'saveProject' | 'saveProjectAs' | 'closeProject' | 'switchProject'
  > {
  /**
   * Opens project files, each in its own tab that saves back to the file's path; the first may take the place of
   * an untouched new tab. A file that cannot be opened is reported and skipped; one whose parts were left out
   * opens with a warning.
   */
  openProjectFiles(projects: OpenedProject[]): Promise<void>;
}

/** Reports a project file that could not be opened. */
function reportOpenFailure(e: unknown, fileName?: string): void {
  logShownError(fileName ? `Could not open the project ${fileName}` : 'Could not open the project', e);
  notify.error('Could not open the project', fileName ? `${fileName}: ${errorMessage(e)}` : errorMessage(e));
}

/** The project actions; project files that arrive during an export open when it ends. */
export function createProjectActions({
  store,
  docs,
  exportBusy,
}: Pick<ActionContext, 'store' | 'docs' | 'exportBusy'>): ProjectActions {
  /** Project files that arrived while an export ran; they open when it ends. */
  let waitingFiles: OpenedProject[] = [];

  const openProjectFiles = async (projects: OpenedProject[]): Promise<void> => {
    if (!projects.length) return;
    if (exportBusy.value) {
      waitingFiles.push(...projects);
      notify.info(`Projects to open: ${projects.length}. They open when the export ends.`);
      return;
    }
    document.body.classList.add('is-busy');
    try {
      for (const { file: f, path } of projects) {
        try {
          const { file, report } = await readProjectFile(f);
          const { state, failed } = await hydrateProject(file);
          const name = projectNameOf(f.name);
          // An export may have started while the file was read: the stage must keep its project.
          if (exportBusy.value) {
            docs.add(state, { name, path, activate: false });
          } else if (docs.activeIsPristine()) {
            store.replace(state, 'project');
            docs.markActiveOpened(name, path);
          } else {
            docs.add(state, { name, path });
          }
          notify.success('Project opened', f.name);
          const warning = projectWarning(report, failed, 'file');
          if (warning) notify.warning(warning, f.name);
        } catch (e) {
          reportOpenFailure(e, f.name);
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

  /**
   * Saves the tab's project: to its file, or, with `ask` or when it has none, to a file the user picks, which
   * becomes its file. Resolves true when it was saved.
   */
  const save = async (tabId: string, ask: boolean): Promise<boolean> => {
    try {
      // Everything is taken from the tab now: other tabs may become active while the save dialog
      // is open (a project opened from the system), and edits may continue while it writes.
      const tab = docs.tab(tabId);
      if (!tab) return false;
      docs.activate(tabId);
      const revision = store.revision;
      const blob = new Blob([projectFileText(toProjectFile(store.state))], { type: 'application/json' });
      let saved: SavedFile | null;
      if (tab.path && !ask) {
        saved = { name: await writeBlob(blob, tab.path), path: tab.path };
      } else {
        // The dialog starts in the folder of the tab's file, when it has one.
        const suggested = tab.path ?? `${tab.name || 'project'}.${PROJECT_EXT}`;
        saved = await saveBlobAs(blob, suggested, [PROJECT_FILE_FILTER]);
      }
      if (!saved) return false;
      docs.markSaved(tabId, revision, projectNameOf(saved.name), saved.path);
      notify.success('Project saved', saved.name);
      return true;
    } catch (e) {
      logShownError('Could not save the project', e);
      notify.error('Could not save the project', errorMessage(e));
      return false;
    }
  };

  const actions: ProjectActions = {
    openProjectFiles,

    async newProject() {
      if (exportBusy.value) return;
      docs.add(freshDocument(store.state.modelId));
    },

    async openProject(file?: File) {
      try {
        if (file) return await openProjectFiles([{ file, path: null }]);
        const { projects, errors } = await pickProjectFiles(`.${PROJECT_EXT}`);
        for (const error of errors) reportOpenFailure(error);
        await openProjectFiles(projects);
      } catch (e) {
        reportOpenFailure(e);
      }
    },

    saveProject: (tabId = docs.activeId) => save(tabId, false),

    saveProjectAs: () => save(docs.activeId, true),

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
            // Saving asks where only for a project without a file.
            { id: 'save', label: tab.path ? 'Save' : 'Save…', primary: true },
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
