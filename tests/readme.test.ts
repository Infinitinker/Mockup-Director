/** Checks README.md against the code it describes: the number of models it states. */
import { describe, expect, it } from 'vitest';
import readme from '../README.md?raw';
import { MODELS } from '../src/models/registry';

describe('README.md', () => {
  it('states the number of models in MODELS', () => {
    const match = /Shows your artwork on (\d+) models/.exec(readme);
    if (!match) {
      throw new Error(
        'README.md no longer says "Shows your artwork on N models": update this test to the sentence that states the number of models.',
      );
    }
    expect(Number(match[1]), 'the number of models in README.md').toBe(MODELS.length);
  });
});
