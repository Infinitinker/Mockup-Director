/** The models the gallery shows, in display order, and finding one by id. */
import type { ModelDefinition } from '../core/types/model';
import { boxModel } from './box';
import { dielineBoxModel } from './box/dieline';
import { slimBoxModel } from './box/slim';
import { blurayDiscModel, boxDiscModel, cdDiscModel, dvdDiscModel } from './composites';
import { discModel } from './disc';
import { cdCaseModel } from './disc/jewelCase';
import { blurayModel, dvdModel } from './disc/keepCase';
import { hardcoverModel, paperbackModel } from './book/bound';
import { spiralNotebookModel } from './book/notebook';
import { brochureModel } from './print/flat/brochure';
import { businessCardModel } from './print/flat/businessCard';
import { flyerModel } from './print/flat/flyer';
import { plasticCardModel } from './print/flat/plasticCard';
import { postcardModel } from './print/flat/postcard';
import { bifoldModel } from './print/folded/bifold';
import { greetingCardModel } from './print/folded/greetingCard';
import { trifoldModel } from './print/folded/trifold';
import { laptopModel } from './device/computer/laptop';
import { monitorModel } from './device/computer/monitor';
import { phoneModel } from './device/handheld/phone';
import { tabletModel } from './device/handheld/tablet';
import { browserWindowModel } from './device/screen/browser';
import { screenshotModel } from './device/screen/screenshot';

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
  hardcoverModel,
  paperbackModel,
  spiralNotebookModel,
  businessCardModel,
  flyerModel,
  postcardModel,
  plasticCardModel,
  brochureModel,
  trifoldModel,
  greetingCardModel,
  bifoldModel,
  phoneModel,
  tabletModel,
  laptopModel,
  monitorModel,
  screenshotModel,
  browserWindowModel,
];

export function getModel(id: string): ModelDefinition {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
