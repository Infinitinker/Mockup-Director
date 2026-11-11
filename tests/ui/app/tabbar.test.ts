/** The name a project tab shows: the project's name, or "Untitled" numbered from the second on. */
import { describe, expect, it } from 'vitest';
import type { TabInfo } from '../../../src/documents/tabs';
import { tabLabel } from '../../../src/ui/app/tabbar';

const tab = (name: string, untitledNumber: number): TabInfo => ({
  id: 'tab-1',
  name,
  untitledNumber,
  dirty: false,
  active: true,
});

describe('tabLabel', () => {
  it("shows the project's name", () => {
    expect(tabLabel(tab('Album cover', 0))).toBe('Album cover');
    expect(tabLabel(tab('Album cover', 3))).toBe('Album cover');
  });

  it('calls the first project never saved "Untitled" and numbers the others', () => {
    expect(tabLabel(tab('', 1))).toBe('Untitled');
    expect(tabLabel(tab('', 2))).toBe('Untitled 2');
    expect(tabLabel(tab('', 12))).toBe('Untitled 12');
  });
});
