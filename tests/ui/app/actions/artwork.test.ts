/**
 * Tests assigning artwork files to slots: the files are decoded one after another, each into its own slot, and a file
 * that cannot be decoded gets its own error while the others are still assigned.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../../../../src/core/errors';
import { loadImageFile } from '../../../../src/core/images';
import { Store } from '../../../../src/documents/store';
import type { Documents } from '../../../../src/documents/tabs';
import { createArtworkActions } from '../../../../src/ui/app/actions/artwork';
import { Signal } from '../../../../src/ui/dom';
import { notify } from '../../../../src/ui/toast';
import { documentState, fakeImage } from '../../../fixtures';

vi.mock('../../../../src/core/images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/images')>()),
  loadImageFile: vi.fn(),
}));
vi.mock('../../../../src/ui/toast', () => ({
  notify: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function setup() {
  const store = new Store(documentState('box'));
  const docs = { activeId: 'tab', tab: () => ({}), activate: vi.fn() } as unknown as Documents;
  const loadingSlots = new Signal<ReadonlySet<string>>(new Set());
  return { store, loadingSlots, actions: createArtworkActions({ store, docs, loadingSlots }) };
}

describe('assignArtwork', () => {
  it('decodes one file at a time and assigns every file that decodes', async () => {
    let decoding = 0;
    let most = 0;
    vi.mocked(loadImageFile).mockImplementation(async (file) => {
      decoding += 1;
      most = Math.max(most, decoding);
      await new Promise((resolve) => setTimeout(resolve, 1));
      decoding -= 1;
      if (file.name === 'bad.png') throw new UserError('The file “bad.png” is damaged.');
      return fakeImage(file.name).asset;
    });
    const { store, loadingSlots, actions } = setup();
    const files = ['front.png', 'bad.png', 'left.png'].map((name) => new File([], name));
    await actions.assignArtwork(files, ['front', 'back', 'left']);
    expect(most).toBe(1);
    expect(loadImageFile).toHaveBeenCalledTimes(3);
    expect(store.state.artwork.box?.front?.name).toBe('front.png');
    expect(store.state.artwork.box?.back).toBeUndefined();
    expect(store.state.artwork.box?.left?.name).toBe('left.png');
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalledWith('Could not load “bad.png”', 'The file “bad.png” is damaged.');
    expect(loadingSlots.value.size).toBe(0);
  });
});
