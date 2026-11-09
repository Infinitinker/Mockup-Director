import type { ModelDefinition } from '../core/types';
import { boxModel, extraBoxModels } from './box';
import { dvdModel, blurayModel } from './keepCase';
import { cdCaseModel } from './jewelCase';
import { discModel } from './disc';
import { boxDiscModel, dvdDiscModel, blurayDiscModel, cdDiscModel, compositeModels } from './composites';
import { bookModels } from './books';
import { flatPrintModels } from './printFlat';
import { foldedPrintModels } from './printFolded';
import { handheldModels } from './handheld';
import { computerModels } from './computer';
import { screenModels } from './screen';

/**
 * All models shown in the gallery, in display order (the gallery groups them by category and
 * keeps this order inside each group). Every "... with disc" composite follows its base model.
 */
export const MODELS: ModelDefinition[] = [
  boxModel,
  ...extraBoxModels,
  boxDiscModel,
  dvdModel,
  dvdDiscModel,
  blurayModel,
  blurayDiscModel,
  cdCaseModel,
  cdDiscModel,
  discModel,
  ...bookModels,
  ...flatPrintModels,
  ...foldedPrintModels,
  ...handheldModels,
  ...computerModels,
  ...screenModels,
];

// Safety net: any composite added later but not placed above is still listed.
for (const m of compositeModels) if (!MODELS.includes(m)) MODELS.push(m);

export function getModel(id: string): ModelDefinition {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
