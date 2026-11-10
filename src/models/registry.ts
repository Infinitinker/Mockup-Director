/** The models the gallery shows, in display order, and finding one by id. */
import type { ModelDefinition } from '../core/types/model';
import { boxModel } from './box';
import { dielineBoxModel } from './box/dieline';
import { slimBoxModel } from './box/slim';
import { blurayDiscModel, boxDiscModel, cdDiscModel, dvdDiscModel } from './composites';
import { discModel } from './disc';
import { cdCaseModel } from './disc/jewelCase';
import { blurayModel, dvdModel } from './disc/keepCase';
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
  dielineBoxModel,
  slimBoxModel,
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

export function getModel(id: string): ModelDefinition {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
