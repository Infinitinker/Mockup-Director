/**
 * Tests saving and opening projects: Save writes to the tab's file without asking and asks only for a project
 * without one, Save as always asks and the file picked becomes the tab's, a canceled or failed save leaves the
 * tab unsaved, and a project picked with Open… opens with its file's path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../../../../src/core/errors';
import { Store } from '../../../../src/documents/store';
import { Documents } from '../../../../src/documents/tabs';
import { saveBlobAs, writeBlob } from '../../../../src/platform/files';
import { pickProjectFiles } from '../../../../src/platform/opened';
import { projectFileText, toProjectFile } from '../../../../src/project/format';
import { createProjectActions } from '../../../../src/ui/app/actions/projects';
import { Signal } from '../../../../src/ui/dom';
import { notify } from '../../../../src/ui/toast';
import { documentState } from '../../../fixtures';

vi.mock('../../../../src/platform/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/platform/files')>()),
  saveBlobAs: vi.fn(),
  writeBlob: vi.fn(),
}));
vi.mock('../../../../src/platform/opened', () => ({ pickProjectFiles: vi.fn() }));
vi.mock('../../../../src/ui/toast', () => ({
  notify: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

const BOX = '/projects/Box.mdproj';

beforeEach(() => {
  // Opening marks the page busy; the tests run without a DOM.
  vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const store = new Store(documentState('box'));
  const docs = new Documents(store, () => documentState('box'));
  const actions = createProjectActions({ store, docs, exportBusy: new Signal(false) });
  return { store, docs, actions };
}

/** One change to the active project, so its tab has something to save. */
function change(store: Store): void {
  store.update(['params'], (s) => {
    s.params.box = { width: 120 };
  });
  store.endBurst();
}

/** A tab that holds the project of the file at `path`, with a change not saved yet. */
function openedTab(store: Store, docs: Documents, path: string): string {
  docs.markActiveOpened('Box', path);
  change(store);
  return docs.activeId;
}

describe('saveProject', () => {
  it('asks where to save a project without a file, and saves it there from then on', async () => {
    const { store, docs, actions } = setup();
    change(store);
    vi.mocked(saveBlobAs).mockResolvedValue({ name: 'Box.mdproj', path: BOX });

    expect(await actions.saveProject()).toBe(true);
    expect(saveBlobAs).toHaveBeenCalledWith(expect.any(Blob), 'project.mdproj', [
      expect.objectContaining({ extensions: ['mdproj'] }),
    ]);
    expect(docs.tab(docs.activeId)).toMatchObject({ name: 'Box', path: BOX, dirty: false });

    change(store);
    vi.mocked(writeBlob).mockResolvedValue('Box.mdproj');
    expect(await actions.saveProject()).toBe(true);
    expect(saveBlobAs).toHaveBeenCalledTimes(1);
    expect(writeBlob).toHaveBeenCalledWith(expect.any(Blob), BOX);
    expect(docs.tab(docs.activeId)?.dirty).toBe(false);
  });

  it("writes the project's file to its path", async () => {
    const { store, docs, actions } = setup();
    const id = openedTab(store, docs, BOX);
    vi.mocked(writeBlob).mockResolvedValue('Box.mdproj');

    expect(await actions.saveProject(id)).toBe(true);
    const blob = vi.mocked(writeBlob).mock.calls[0][0];
    expect(await blob.text()).toBe(projectFileText(toProjectFile(store.state)));
    expect(saveBlobAs).not.toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith('Project saved', 'Box.mdproj');
  });

  it('keeps the tab unsaved when its file cannot be written', async () => {
    const { store, docs, actions } = setup();
    const id = openedTab(store, docs, BOX);
    vi.mocked(writeBlob).mockRejectedValue(new UserError('“Box.mdproj” could not be saved: the folder is gone.'));

    expect(await actions.saveProject(id)).toBe(false);
    expect(docs.tab(id)).toMatchObject({ path: BOX, dirty: true });
    expect(notify.error).toHaveBeenCalledWith(
      'Could not save the project',
      '“Box.mdproj” could not be saved: the folder is gone.',
    );
  });

  it('keeps the tab unsaved when the save dialog is canceled', async () => {
    const { store, docs, actions } = setup();
    change(store);
    vi.mocked(saveBlobAs).mockResolvedValue(null);

    expect(await actions.saveProject()).toBe(false);
    expect(docs.tab(docs.activeId)).toMatchObject({ name: '', path: null, dirty: true });
  });
});

describe('saveProjectAs', () => {
  it('asks even for a project with a file, starting at that file, and saves to the new file from then on', async () => {
    const { store, docs, actions } = setup();
    const id = openedTab(store, docs, BOX);
    vi.mocked(saveBlobAs).mockResolvedValue({ name: 'Box copy.mdproj', path: '/projects/Box copy.mdproj' });

    expect(await actions.saveProjectAs()).toBe(true);
    expect(saveBlobAs).toHaveBeenCalledWith(expect.any(Blob), BOX, expect.any(Array));
    expect(writeBlob).not.toHaveBeenCalled();
    expect(docs.tab(id)).toMatchObject({ name: 'Box copy', path: '/projects/Box copy.mdproj', dirty: false });
  });

  it('keeps the tab on its file when the dialog is canceled', async () => {
    const { store, docs, actions } = setup();
    const id = openedTab(store, docs, BOX);
    vi.mocked(saveBlobAs).mockResolvedValue(null);

    expect(await actions.saveProjectAs()).toBe(false);
    expect(docs.tab(id)).toMatchObject({ name: 'Box', path: BOX, dirty: true });
  });
});

describe('openProject', () => {
  it("opens the picked projects with their files' paths and reports the files that could not be read", async () => {
    const { docs, actions } = setup();
    const text = projectFileText(toProjectFile(documentState('box')));
    const unreadable = new UserError('“Lost.mdproj” could not be found.');
    vi.mocked(pickProjectFiles).mockResolvedValue({
      projects: [{ file: new File([text], 'Box.mdproj'), path: BOX }],
      errors: [unreadable],
    });

    await actions.openProject();
    expect(docs.tabs()).toEqual([expect.objectContaining({ name: 'Box', path: BOX, dirty: false })]);
    expect(notify.error).toHaveBeenCalledWith('Could not open the project', '“Lost.mdproj” could not be found.');
  });

  it('opens a dropped project without a path, so saving it asks where', async () => {
    const { docs, actions } = setup();
    const text = projectFileText(toProjectFile(documentState('box')));

    await actions.openProject(new File([text], 'Box.mdproj'));
    expect(pickProjectFiles).not.toHaveBeenCalled();
    expect(docs.tabs()).toEqual([expect.objectContaining({ name: 'Box', path: null })]);
  });
});
