/**
 * Tests src/platform/files.ts in the desktop app, with the shell and the save dialog faked: the file
 * goes to the shell in chunks, in order, a save that fails is aborted and reported as a `UserError`,
 * and a name that gets its extension added never replaces a file the dialog did not ask about.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../../src/core/errors';
import { chunkRanges, SAVE_CHUNK_BYTES, saveBlob } from '../../src/platform/files';

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown, options?: unknown) => Promise<unknown>>(),
  save: vi.fn<(options: { defaultPath?: string }) => Promise<string | null>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: shell.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: shell.save }));

const FILTERS = [{ name: 'ZIP file', extensions: ['zip'] }];
const PATH = '/home/ania/Projekty/Okładka.zip';

/** The commands the shell was called with, without the log's. */
function commands(): string[] {
  return shell.invoke.mock.calls.map(([command]) => command).filter((command) => command !== 'write_log');
}

beforeEach(() => {
  shell.save.mockResolvedValue(PATH);
  shell.invoke.mockImplementation(async (command) => (command === 'save_open' ? 3 : undefined));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('chunkRanges', () => {
  it('has no chunk for an empty file', () => {
    expect(chunkRanges(0, 4)).toEqual([]);
  });

  it('splits a file into whole chunks and a last, shorter one', () => {
    expect(chunkRanges(8, 4)).toEqual([
      [0, 4],
      [4, 8],
    ]);
    expect(chunkRanges(9, 4)).toEqual([
      [0, 4],
      [4, 8],
      [8, 9],
    ]);
  });
});

describe('saveBlob in the desktop app', () => {
  it('opens the save, sends the chunks in order, and commits', async () => {
    const bytes = new Uint8Array(SAVE_CHUNK_BYTES + 3);
    bytes[0] = 1;
    bytes[SAVE_CHUNK_BYTES] = 2;

    await expect(saveBlob(new Blob([bytes]), 'batch.zip', FILTERS)).resolves.toBe('Okładka.zip');

    expect(commands()).toEqual(['save_open', 'save_write', 'save_write', 'save_commit']);
    const [open, first, second, commit] = shell.invoke.mock.calls;
    expect(open[1]).toEqual({ path: PATH, replace: true });
    expect(first[2]).toEqual({ headers: { 'x-save-id': '3' } });
    const firstBytes = new Uint8Array(first[1] as ArrayBuffer);
    const secondBytes = new Uint8Array(second[1] as ArrayBuffer);
    expect([firstBytes.length, firstBytes[0]]).toEqual([SAVE_CHUNK_BYTES, 1]);
    expect([secondBytes.length, secondBytes[0]]).toEqual([3, 2]);
    expect(commit[1]).toEqual({ id: 3, size: SAVE_CHUNK_BYTES + 3 });
  });

  it('reads the next chunk only once the previous one is written', async () => {
    const blob = new Blob([new Uint8Array(2 * SAVE_CHUNK_BYTES)]);
    const slice = vi.spyOn(blob, 'slice');
    let finishFirstWrite = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      finishFirstWrite = resolve;
    });
    let writes = 0;
    shell.invoke.mockImplementation(async (command) => {
      if (command === 'save_open') return 3;
      if (command === 'save_write' && writes++ === 0) await firstWrite;
      return undefined;
    });

    const saved = saveBlob(blob, 'batch.zip', FILTERS);
    await vi.waitFor(() => expect(commands()).toContain('save_write'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(slice).toHaveBeenCalledTimes(1);

    finishFirstWrite();
    await saved;
    expect(slice).toHaveBeenCalledTimes(2);
    expect(commands()).toEqual(['save_open', 'save_write', 'save_write', 'save_commit']);
  });

  it('commits an empty file without sending a chunk', async () => {
    await saveBlob(new Blob([]), 'batch.zip', FILTERS);
    expect(commands()).toEqual(['save_open', 'save_commit']);
    expect(shell.invoke).toHaveBeenCalledWith('save_commit', { id: 3, size: 0 });
  });

  it('does nothing when the user cancels the save dialog', async () => {
    shell.save.mockResolvedValue(null);
    await expect(saveBlob(new Blob(['x']), 'batch.zip', FILTERS)).resolves.toBeNull();
    expect(commands()).toEqual([]);
  });

  it('aborts a save whose chunk cannot be written and reports the error for its kind', async () => {
    shell.invoke.mockImplementation(async (command) => {
      if (command === 'save_open') return 3;
      if (command === 'save_write') throw { kind: 'disk-full', path: PATH };
      if (command === 'save_abort') throw { kind: 'invalid-request', path: '' };
      return undefined;
    });

    const saved = saveBlob(new Blob(['x']), 'batch.zip', FILTERS);
    await expect(saved).rejects.toBeInstanceOf(UserError);
    await expect(saved).rejects.toThrow('“Okładka.zip” could not be saved: the drive is full.');
    expect(commands()).toEqual(['save_open', 'save_write', 'save_abort']);
    expect(shell.invoke).toHaveBeenCalledWith('save_abort', { id: 3 });
    // The abort's own failure is logged; the write's error is the one reported.
    expect(shell.invoke).toHaveBeenCalledWith('write_log', expect.objectContaining({ level: 'warn' }));
  });

  it('aborts a save whose chunk cannot be read, and says so', async () => {
    const unreadable = {
      size: 5,
      type: '',
      slice: () => ({ arrayBuffer: () => Promise.reject(new DOMException('The blob is gone', 'NotReadableError')) }),
    } as unknown as Blob;

    const saved = saveBlob(unreadable, 'batch.zip', FILTERS);
    await expect(saved).rejects.toBeInstanceOf(UserError);
    await expect(saved).rejects.toThrow('“Okładka.zip” could not be saved: Mockup Director could not read');
    expect(commands()).toEqual(['save_open', 'save_abort']);
  });

  it('does not abort a save whose commit failed: the commit ended it', async () => {
    shell.invoke.mockImplementation(async (command) => {
      if (command === 'save_open') return 3;
      if (command === 'save_commit') throw { kind: 'permission-denied', path: PATH };
      return undefined;
    });

    await expect(saveBlob(new Blob(['x']), 'batch.zip', FILTERS)).rejects.toThrow('the system does not allow writing');
    expect(commands()).toEqual(['save_open', 'save_write', 'save_commit']);
  });

  it('reports a save that cannot be opened without sending anything', async () => {
    shell.invoke.mockImplementation(async (command) => {
      if (command === 'save_open') throw { kind: 'not-found', path: PATH };
      return undefined;
    });

    await expect(saveBlob(new Blob(['x']), 'batch.zip', FILTERS)).rejects.toThrow('its folder no longer exists');
    expect(commands()).toEqual(['save_open']);
  });
});

describe('saveBlob in the desktop app, for a name without its extension', () => {
  const PNG = [{ name: 'PNG image', extensions: ['png'] }];
  const BARE = '/home/ania/Projekty/poster';
  const CORRECTED = '/home/ania/Projekty/poster.png';

  /** The shell refuses CORRECTED when it is not to be replaced, as when a file of that name is there. */
  function existingCorrectedFile(): void {
    shell.invoke.mockImplementation(async (command, args) => {
      if (command !== 'save_open') return undefined;
      const { path, replace } = args as { path: string; replace: boolean };
      if (path === CORRECTED && !replace) throw { kind: 'already-exists', path };
      return 3;
    });
  }

  it('saves at once when no file of the corrected name is there', async () => {
    shell.save.mockResolvedValue(BARE);
    await expect(saveBlob(new Blob(['x']), 'export.png', PNG)).resolves.toBe('poster.png');
    expect(shell.save).toHaveBeenCalledTimes(1);
    expect(commands()).toEqual(['save_open', 'save_write', 'save_commit']);
    expect(shell.invoke).toHaveBeenCalledWith('save_open', { path: CORRECTED, replace: false });
  });

  it('shows the dialog again with the corrected name when a file of that name is there', async () => {
    existingCorrectedFile();
    shell.save.mockResolvedValueOnce(BARE).mockResolvedValueOnce(CORRECTED);

    await expect(saveBlob(new Blob(['x']), 'export.png', PNG)).resolves.toBe('poster.png');

    expect(shell.save.mock.calls.map(([options]) => options.defaultPath)).toEqual(['export.png', CORRECTED]);
    // The second time the dialog asked about replacing it.
    expect(shell.invoke.mock.calls.filter(([command]) => command === 'save_open').map(([, args]) => args)).toEqual([
      { path: CORRECTED, replace: false },
      { path: CORRECTED, replace: true },
    ]);
    expect(commands()).toEqual(['save_open', 'save_open', 'save_write', 'save_commit']);
  });

  it('cancels the save when the dialog shown again is canceled', async () => {
    existingCorrectedFile();
    shell.save.mockResolvedValueOnce(BARE).mockResolvedValueOnce(null);

    await expect(saveBlob(new Blob(['x']), 'export.png', PNG)).resolves.toBeNull();
    expect(shell.save).toHaveBeenCalledTimes(2);
    expect(commands()).toEqual(['save_open']);
  });
});
