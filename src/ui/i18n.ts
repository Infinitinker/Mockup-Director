/**
 * UI translations – Polish first, English second.
 * `t(key, vars)` looks up the dictionary; `{name}` placeholders are replaced from `vars`.
 * `lt(text)` picks the current language from a LocalizedText.
 */
import type { Lang, LocalizedText } from '../core/types';
import { safeStorage } from './dom';

const DICT = {
  /* general */
  ok: ['OK', 'OK'],
  cancel: ['Anuluj', 'Cancel'],
  close: ['Zamknij', 'Close'],
  delete: ['Usuń', 'Delete'],
  rename: ['Zmień nazwę', 'Rename'],
  loading: ['Wczytywanie…', 'Loading…'],
  saved: ['Zapisano', 'Saved'],
  language: ['Język interfejsu', 'Interface language'],
  general: ['Ogólne', 'General'],
  import: ['Importuj…', 'Import…'],
  exportJson: ['Eksportuj…', 'Export…'],

  /* toolbar */
  new: ['Nowy', 'New'],
  open: ['Otwórz', 'Open'],
  save: ['Zapisz', 'Save'],
  undo: ['Cofnij', 'Undo'],
  redo: ['Ponów', 'Redo'],
  export: ['Eksportuj', 'Export'],
  newProject: ['Nowy projekt', 'New project'],
  openProject: ['Otwórz projekt…', 'Open project…'],
  saveProject: ['Zapisz projekt…', 'Save project…'],
  exportImage: ['Eksportuj obraz', 'Export image'],
  exportImageDots: ['Eksportuj obraz…', 'Export image…'],
  exporting: ['Eksportowanie…', 'Exporting…'],

  /* gallery */
  models: ['Modele', 'Models'],
  catBoxes: ['Pudełka', 'Boxes'],
  catDiscs: ['Płyty i pudełka na płyty', 'Discs & disc cases'],
  catBooks: ['Książki i notesy', 'Books & notebooks'],
  catPrint: ['Druk', 'Print'],
  catDevices: ['Urządzenia i ekrany', 'Devices & screens'],
  imagesAssigned: ['Przypisane grafiki: {n}', 'Images assigned: {n}'],

  /* viewport */
  viewBar: ['Widok', 'View'],
  viewFront: ['Przód', 'Front'],
  viewLeft34: ['3/4 lewo', '3/4 left'],
  viewRight34: ['3/4 prawo', '3/4 right'],
  viewSide: ['Bok', 'Side'],
  viewTop: ['Z góry', 'Top'],
  viewBack: ['Tył', 'Back'],
  resetView: ['Resetuj widok', 'Reset view'],
  perspective: ['Perspektywa', 'Perspective'],
  orthographic: ['Ortogonalny', 'Orthographic'],
  projection: ['Rzutowanie', 'Projection'],
  previewBackground: ['Tło podglądu', 'Preview background'],
  bgTransparent: ['Przezroczyste (szachownica)', 'Transparent (checkerboard)'],
  bgTransparentShort: ['Przezroczyste', 'Transparent'],
  bgColor: ['Kolor', 'Colour'],
  bgGradient: ['Gradient', 'Gradient'],
  viewportHint: [
    'Przeciągnij, by obracać · ⇧ + przeciągnij, by przesunąć · przewiń lub uszczypnij, by przybliżyć · dwuklik resetuje widok',
    'Drag to orbit · ⇧-drag to pan · scroll or pinch to zoom · double-click resets the view',
  ],
  dropHere: ['Upuść grafiki – trafią do pustych miejsc modelu', 'Drop artwork – it fills the empty slots of the model'],

  /* inspector */
  inspector: ['Inspektor', 'Inspector'],
  tabImages: ['Grafiki', 'Artwork'],
  tabModel: ['Model', 'Model'],
  tabScene: ['Scena', 'Scene'],
  tabExport: ['Eksport', 'Export'],
  tabStyles: ['Style', 'Looks'],

  /* images */
  imagesIntro: [
    'Przeciągnij plik na kartę albo na podgląd. Szablon to PNG 300 dpi z liniami cięcia i spadami.',
    'Drop a file on a card or on the preview. A template is a 300 dpi PNG with trim and bleed guides.',
  ],
  noImage: ['Brak grafiki – przeciągnij plik tutaj', 'No artwork – drop a file here'],
  choose: ['Wybierz…', 'Choose…'],
  chooseImageFor: ['Wybierz grafikę: {name}', 'Choose artwork: {name}'],
  removeImage: ['Usuń grafikę', 'Remove artwork'],
  template: ['Szablon', 'Template'],
  templateTitle: ['Pobierz szablon do druku (PNG, 300 dpi)', 'Download print template (PNG, 300 dpi)'],
  templateFilePrefix: ['szablon', 'template'],
  noTemplate: ['Ten element nie ma szablonu.', 'This item has no template.'],
  aspectBadge: ['Proporcje', 'Aspect'],
  aspectWarning: [
    'Proporcje grafiki ({actual}) różnią się od oczekiwanych ({expected}) o więcej niż 3% – obraz może zostać zniekształcony.',
    'Artwork aspect ratio ({actual}) differs from the expected one ({expected}) by more than 3% – the image may look distorted.',
  ],
  noSlots: ['Ten model nie ma miejsc na grafiki.', 'This model has no artwork slots.'],
  unsupportedFile: ['Nieobsługiwany plik – wybierz obraz (PNG, JPEG, WebP…).', 'Unsupported file – choose an image (PNG, JPEG, WebP…).'],
  tooManyFiles: ['Pominięto plików: {n} (brak wolnych miejsc).', 'Skipped files: {n} (no free slots).'],
  imagesAssignedTo: ['Grafiki przypisano do modelu „{name}”.', 'Artwork assigned to “{name}”.'],

  /* model */
  noParams: ['Ten model nie ma ustawień.', 'This model has no settings.'],
  restoreDefaults: ['Przywróć domyślne', 'Restore defaults'],

  /* scene */
  camera: ['Kamera', 'Camera'],
  yaw: ['Obrót', 'Rotation'],
  pitch: ['Nachylenie', 'Tilt'],
  roll: ['Przechył', 'Roll'],
  fov: ['Siła perspektywy (FOV)', 'Perspective strength (FOV)'],
  fovHint: ['Mała wartość = płaski „teleobiektyw”, duża = mocna perspektywa', 'Small = flat telephoto look, large = strong perspective'],
  zoom: ['Przybliżenie', 'Zoom'],
  panX: ['Przesunięcie poziome', 'Horizontal pan'],
  panY: ['Przesunięcie pionowe', 'Vertical pan'],
  light: ['Światło', 'Light'],
  lightPreset: ['Ustawienie światła', 'Light preset'],
  customLight: ['Własne', 'Custom'],
  azimuth: ['Kierunek (azymut)', 'Direction (azimuth)'],
  elevation: ['Wysokość', 'Elevation'],
  intensity: ['Natężenie', 'Intensity'],
  ambient: ['Światło otoczenia', 'Ambient light'],
  environment: ['Odbicia otoczenia', 'Environment reflections'],
  environmentHint: ['Siła odbić studia na błyszczących powierzchniach', 'Strength of studio reflections on glossy surfaces'],
  lightColor: ['Kolor światła', 'Light colour'],
  shadow: ['Cień', 'Shadow'],
  opacity: ['Krycie', 'Opacity'],
  softness: ['Miękkość', 'Softness'],
  reflection: ['Odbicie', 'Reflection'],
  falloff: ['Zanikanie', 'Falloff'],
  falloffHint: ['Część wysokości modelu, na której odbicie zanika', 'Part of the model height over which the reflection fades'],
  gap: ['Odstęp', 'Gap'],
  mode: ['Tryb', 'Mode'],
  bgColor1: ['Kolor (środek)', 'Colour (centre)'],
  bgColor2: ['Kolor (krawędzie)', 'Colour (edges)'],
  bgNote: [
    'Tło podglądu może być też użyte w eksporcie (Eksport → Tło: Jak w podglądzie).',
    'The preview background can also be used for export (Export → Background: As preview).',
  ],

  /* export */
  size: ['Rozmiar', 'Size'],
  sizePresets: ['Gotowe rozmiary (kwadrat)', 'Size presets (square)'],
  width: ['Szerokość', 'Width'],
  height: ['Wysokość', 'Height'],
  lockAspect: ['Zablokuj proporcje', 'Lock aspect ratio'],
  maxSize: ['Maksymalnie {n} × {n} px.', 'Maximum {n} × {n} px.'],
  margin: ['Margines', 'Margin'],
  sizing: ['Kadrowanie', 'Framing'],
  sizingCanvas: ['Dopasuj do płótna', 'Fit to canvas'],
  sizingTrim: ['Przytnij do obiektu', 'Trim to object'],
  sizingCanvasHint: ['Obraz ma dokładnie podany rozmiar, obiekt jest wyśrodkowany.', 'The image has exactly the given size, the object is centred.'],
  sizingTrimHint: ['Obraz jest przycięty do obiektu z marginesem – jeden bok zwykle jest mniejszy.', 'The image is cropped to the object plus margin – one side is usually smaller.'],
  formatSection: ['Format i tło', 'Format & background'],
  format: ['Format', 'Format'],
  quality: ['Jakość', 'Quality'],
  webpUnsupported: ['WebP nie jest obsługiwany przez ten silnik przeglądarki – użyj PNG.', 'WebP encoding is not supported by this browser engine – use PNG.'],
  exportBackground: ['Tło', 'Background'],
  bgAsPreview: ['Jak w podglądzie', 'As preview'],
  jpegNoAlpha: ['JPEG nie obsługuje przezroczystości – tło będzie białe.', 'JPEG has no transparency – the background will be white.'],
  summaryTrim: ['do {w} × {h} px (przycięte)', 'up to {w} × {h} px (trimmed)'],
  summaryTransparent: ['przezroczyste tło', 'transparent background'],
  summaryOpaque: ['z tłem', 'with background'],

  /* export – animation */
  exportMode: ['Rodzaj eksportu', 'Export type'],
  exportModeImage: ['Obraz', 'Image'],
  exportModeAnimation: ['Animacja', 'Animation'],
  animMotion: ['Ruch', 'Motion'],
  animMotionType: ['Rodzaj ruchu', 'Motion type'],
  animLoop: ['Obrót 360°', '360° turn'],
  animSwing: ['Wahadło', 'Swing'],
  animLoopHint: ['Produkt obraca się o pełne 360° ze stałą prędkością – animacja zapętla się płynnie.', 'The product turns a full 360° at constant speed – the animation loops seamlessly.'],
  animSwingHint: ['Produkt obraca się tam i z powrotem o ±{a}° wokół bieżącego widoku.', 'The product turns back and forth by ±{a}° around the current view.'],
  animSwingAngle: ['Wychylenie (±)', 'Swing angle (±)'],
  animDirection: ['Kierunek (widok z góry)', 'Direction (seen from above)'],
  animCw: ['Zgodnie z zegarem', 'Clockwise'],
  animCcw: ['Przeciwnie do zegara', 'Counter-clockwise'],
  animEasing: ['Wygładzenie ruchu', 'Easing'],
  animEaseSine: ['Płynne (sinus)', 'Smooth (sine)'],
  animEaseLinear: ['Liniowe', 'Linear'],
  animDuration: ['Czas trwania', 'Duration'],
  animFps: ['Klatki na sekundę', 'Frames per second'],
  animUseView: ['Zoom i przesunięcie z podglądu', 'Zoom & pan from the preview'],
  animUseViewHint: ['Wyłączone: cała kompozycja zawsze mieści się w kadrze. Włączone: zoom i przesunięcie z podglądu są nakładane na stały kadr (może przycinać).', 'Off: the whole composition always fits. On: the preview zoom and pan are applied on top of the fixed framing (may crop).'],
  animStartNote: ['Animacja zaczyna się od bieżącego widoku – kąt kamery, światło, cień i odbicie zostają zachowane, a kadr jest stały dla wszystkich klatek.', 'The animation starts from the current view – camera angle, lighting, shadow and reflection are kept, and the framing is fixed for all frames.'],
  animSizePresets: ['Gotowe rozmiary (kwadrat)', 'Size presets (square)'],
  animMaxSize: ['Maksymalnie {n} px na bok ({fmt}).', 'Maximum {n} px per side ({fmt}).'],
  animMp4Even: ['MP4 wymaga parzystych wymiarów – plik będzie miał {w} × {h} px.', 'MP4 needs even dimensions – the file will be {w} × {h} px.'],
  animQualityLow: ['Niska', 'Low'],
  animQualityMedium: ['Średnia', 'Medium'],
  animQualityHigh: ['Wysoka', 'High'],
  animDither: ['Dithering', 'Dithering'],
  animDitherFloyd: ['Floyd–Steinberg', 'Floyd–Steinberg'],
  animDitherOrdered: ['Uporządkowany (Bayer)', 'Ordered (Bayer)'],
  animDitherNone: ['Brak', 'None'],
  animPalette: ['Paleta kolorów', 'Colour palette'],
  animPaletteGlobal: ['Wspólna', 'Global'],
  animPaletteFrame: ['Na klatkę', 'Per frame'],
  animPaletteHint: ['Wspólna paleta: stabilne kolory i mniejszy plik. Paleta na klatkę: wierniejsze kolory, większy plik.', 'Global palette: stable colours and a smaller file. Per frame: more accurate colours, a larger file.'],
  animWebpUnsupported: ['Animowany WebP jest niedostępny – ten silnik (Safari / macOS) nie koduje WebP.', 'Animated WebP is unavailable – this engine (Safari / macOS) cannot encode WebP.'],
  animMp4Unsupported: ['MP4 wymaga WebCodecs (Safari 16.4+ / macOS 13.3+ albo Windows z WebView2) – niedostępne w tym systemie.', 'MP4 needs WebCodecs (Safari 16.4+ / macOS 13.3+ or Windows with WebView2) – not available on this system.'],
  animGifAlphaNote: ['GIF ma tylko 1-bitową przezroczystość: miękki cień i odbicie znikną, a krawędzie mogą być postrzępione. Lepiej wybrać tło jak w podglądzie albo WebP.', 'GIF only has 1-bit transparency: the soft shadow and reflection disappear and edges may look jagged. Prefer the preview background or WebP.'],
  animMp4NoAlpha: ['MP4 nie obsługuje przezroczystości – tło będzie białe.', 'MP4 has no transparency – the background will be white.'],
  animSummary: ['{w} × {h} px · {fmt} · {d} s · liczba klatek: {n}', '{w} × {h} px · {fmt} · {d} s · {n} frames'],
  exportAnimationDots: ['Eksportuj animację…', 'Export animation…'],
  animPhasePrepare: ['Przygotowanie…', 'Preparing…'],
  animPhasePalette: ['Analiza kolorów: {done} / {total}', 'Analysing colours: {done} / {total}'],
  animPhaseFrames: ['Klatki wyrenderowane i zakodowane: {done} / {total}', 'Frames rendered & encoded: {done} / {total}'],
  animPhaseFinalize: ['Zapisywanie pliku…', 'Finishing the file…'],
  animCancelled: ['Anulowano eksport animacji', 'Animation export cancelled'],
  errExportAnimation: ['Eksport animacji nie powiódł się', 'Animation export failed'],

  /* batch export */
  batchExport: ['Eksport wsadowy', 'Batch export'],
  batchExportDots: ['Eksport wsadowy…', 'Batch export…'],
  batchExportHint: ['Wiele mockupów naraz, spakowanych w jeden plik ZIP (bieżące ustawienia eksportu).', 'Many mockups at once, packed into one ZIP file (current export settings).'],
  batchMode: ['Tryb eksportu wsadowego', 'Batch export mode'],
  batchModeImages: ['Wiele grafik', 'Many images'],
  batchModeViews: ['Wiele widoków', 'Many views'],
  batchModeProjects: ['Wiele projektów', 'Many projects'],
  batchModeImagesHint: ['Wiele grafik → jeden model: każdy plik trafia do wybranego slotu i powstaje z niego osobny mockup. Pozostałe sloty, parametry i scena zostają bez zmian.', 'Many images → one model: every file goes into the chosen slot and becomes a separate mockup. Other slots, parameters and the scene stay unchanged.'],
  batchModeViewsHint: ['Bieżący projekt z kilku ujęć kamery – po jednym obrazie na każdy zaznaczony widok.', 'The current project from several camera views – one image per selected view.'],
  batchModeProjectsHint: ['Każdy plik projektu (.mockup, także starszy .coverbox) jest renderowany z własnym modelem, grafikami i sceną.', 'Every project file (.mockup, also legacy .coverbox) is rendered with its own model, artwork and scene.'],
  batchModel: ['Model: {name}', 'Model: {name}'],
  batchSlot: ['Zmieniany slot', 'Slot to vary'],
  batchSlotHint: ['Jeśli ustawiona jest grafika owijki (okładka całości), może ona zasłaniać osobne ściany – wtedy wybierz slot owijki.', 'If a wrap-around cover image is set it may take precedence over separate faces – choose the cover slot then.'],
  batchPickImages: ['Wybierz grafiki…', 'Choose images…'],
  batchPickProjects: ['Wybierz projekty…', 'Choose projects…'],
  batchClear: ['Wyczyść listę', 'Clear list'],
  batchRemove: ['Usuń z listy', 'Remove from list'],
  batchDropHint: ['Pliki można też upuścić na to okno.', 'You can also drop files onto this window.'],
  batchUnsupportedDrop: ['Nieobsługiwane pliki – upuść obrazy albo pliki projektów (.mockup).', 'Unsupported files – drop images or project files (.mockup).'],
  batchNoFiles: ['Nie wybrano jeszcze plików.', 'No files chosen yet.'],
  batchFilesCount: ['Wybrane pliki: {n}', 'Files chosen: {n}'],
  batchCurrentView: ['Bieżący widok', 'Current view'],
  batchOwnExport: ['Użyj ustawień eksportu z każdego projektu', 'Use each project’s export settings'],
  batchOwnSettingsSummary: ['ustawienia eksportu z każdego projektu', 'each project’s export settings'],
  batchOutput: ['Wynik', 'Output'],
  batchOutputSummary: ['Liczba obrazów: {n} · {settings} → jeden plik ZIP', 'Images: {n} · {settings} → one ZIP file'],
  batchStart: ['Rozpocznij', 'Start'],
  batchProgress: ['{i} / {n}: {name}', '{i} / {n}: {name}'],
  batchFinishing: ['Kończenie…', 'Finishing…'],
  batchStopping: ['Zatrzymywanie po bieżącym elemencie…', 'Stopping after the current item…'],
  batchDone: ['Gotowe: {done} z {n}.', 'Done: {done} of {n}.'],
  batchCancelledMsg: ['Przerwano – gotowe: {done} z {n}.', 'Stopped – done: {done} of {n}.'],
  batchSavedAs: ['Zapisano archiwum „{name}”.', 'Saved the archive “{name}”.'],
  batchNothing: ['Nie powstał żaden obraz.', 'No images were created.'],
  batchErrors: ['Błędy ({n})', 'Errors ({n})'],
  batchWarnings: ['Ostrzeżenia ({n})', 'Warnings ({n})'],
  batchSaveZip: ['Zapisz ZIP…', 'Save ZIP…'],
  batchDiscard: ['Odrzuć', 'Discard'],
  batchSaved: ['Zapisano archiwum ZIP', 'ZIP archive saved'],
  batchZipLimit: ['Archiwum osiągnęło limit 4 GB – pozostałe elementy pominięto.', 'The archive reached the 4 GB limit – the remaining items were skipped.'],
  batchBusy: ['Trwa inny eksport – poczekaj na jego zakończenie.', 'Another export is running – wait for it to finish.'],
  errBatch: ['Eksport wsadowy nie powiódł się', 'Batch export failed'],

  /* styles */
  saveCurrentStyle: ['Zapisz bieżący styl', 'Save current look'],
  styleName: ['Nazwa stylu', 'Look name'],
  styleNamePlaceholder: ['np. Jasne studio – klient X', 'e.g. Bright studio – client X'],
  styleDefaultName: ['Mój styl', 'My look'],
  includeCamera: ['Zapisz również ustawienie kamery', 'Also save the camera'],
  saveStyle: ['Zapisz styl', 'Save look'],
  myStyles: ['Moje style', 'My looks'],
  builtinStyles: ['Wbudowane style', 'Built-in looks'],
  noUserStyles: ['Nie masz jeszcze zapisanych stylów.', 'You have no saved looks yet.'],
  applyStyle: ['Zastosuj styl', 'Apply look'],
  withCamera: ['+ kamera', '+ camera'],
  renameStyle: ['Zmień nazwę stylu', 'Rename look'],
  deleteStyleTitle: ['Usunąć styl „{name}”?', 'Delete look “{name}”?'],
  deleteStyleMsg: ['Tej operacji nie można cofnąć.', 'This cannot be undone.'],
  styleSaved: ['Zapisano styl „{name}”', 'Saved look “{name}”'],
  styleApplied: ['Zastosowano styl „{name}”', 'Applied look “{name}”'],
  importStyles: ['Importuj style z pliku JSON', 'Import looks from a JSON file'],
  exportStyles: ['Eksportuj moje style do pliku JSON', 'Export my looks to a JSON file'],
  stylesImported: ['Zaimportowano style: {n}', 'Imported looks: {n}'],
  noStylesInFile: ['W pliku nie znaleziono stylów.', 'No looks found in the file.'],

  /* projects */
  defaultProjectName: ['projekt', 'project'],
  newProjectTitle: ['Rozpocząć nowy projekt?', 'Start a new project?'],
  newProjectMsg: ['Bieżące grafiki i ustawienia zostaną usunięte z obszaru roboczego.', 'Current artwork and settings will be removed from the workspace.'],
  newProjectOk: ['Nowy projekt', 'New project'],
  newProjectDone: ['Utworzono nowy projekt', 'New project created'],
  projectOpened: ['Otwarto projekt', 'Project opened'],
  projectSaved: ['Zapisano projekt', 'Project saved'],
  restored: ['Przywrócono ostatnią sesję', 'Restored your last session'],
  imagesFailed: ['Nie udało się wczytać grafik: {n}', 'Could not load images: {n}'],

  /* errors */
  errNotProject: ['To nie jest plik projektu Mockup Director.', 'This is not a Mockup Director project file.'],
  errProjectVersion: ['Plik projektu pochodzi z nowszej wersji Mockup Director.', 'The project file comes from a newer Mockup Director version.'],
  errOpen: ['Nie udało się otworzyć projektu', 'Could not open the project'],
  errSave: ['Nie udało się zapisać projektu', 'Could not save the project'],
  errExport: ['Eksport nie powiódł się', 'Export failed'],
  errExportEmpty: ['Wyrenderowany obraz jest pusty.', 'The rendered image is empty.'],
  errImage: ['Nie udało się wczytać „{name}”', 'Could not load “{name}”'],
  errPick: ['Nie udało się wybrać pliku', 'Could not pick the file'],
  errTemplate: ['Nie udało się utworzyć szablonu', 'Could not create the template'],
  errBuild: ['Błąd budowania modelu „{name}”', 'Could not build model “{name}”'],
  errScene: ['Błąd ustawień sceny', 'Scene settings error'],
  errWebgl: ['Podgląd 3D jest niedostępny – WebGL nie działa na tym komputerze', '3D preview unavailable – WebGL does not work on this computer'],
  errImportStyles: ['Nie udało się zaimportować stylów', 'Could not import looks'],
  errExportStyles: ['Nie udało się wyeksportować stylów', 'Could not export looks'],
  errUnexpected: ['Wystąpił nieoczekiwany błąd', 'An unexpected error occurred'],
} as const satisfies Record<string, readonly [string, string]>;

export type DictKey = keyof typeof DICT;

const LANG_KEY = 'mockup-director.lang';
let lang: Lang = 'pl';

/** Read the remembered language (Polish by default). */
export function initLang(): Lang {
  const stored = safeStorage.get(LANG_KEY);
  lang = stored === 'en' || stored === 'pl' ? stored : 'pl';
  return lang;
}

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  lang = l;
  safeStorage.set(LANG_KEY, l);
}

export function t(key: DictKey, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  let s: string = entry ? entry[lang === 'en' ? 1 : 0] : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Pick the current language from a LocalizedText (falls back to the other language). */
export function lt(text: LocalizedText | undefined | null): string {
  if (!text) return '';
  return (lang === 'en' ? text.en || text.pl : text.pl || text.en) ?? '';
}

/** Format a number for display (Polish uses a decimal comma). */
export function formatNumber(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '';
  let s = v.toFixed(decimals);
  if (s === '-0' || /^-0[.,]0+$/.test(s)) s = s.slice(1);
  return lang === 'pl' ? s.replace('.', ',') : s;
}

/** Parse user-typed numbers – accepts both "1,5" and "1.5", ignores spaces and a trailing unit. */
export function parseNumber(s: string): number | null {
  const cleaned = s.trim().replace(/\s+/g, '').replace(',', '.').replace(/[^0-9.eE+\-]+$/, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
