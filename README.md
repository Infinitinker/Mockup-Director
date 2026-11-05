# Mockup Director

**Mockup Director** to aplikacja na macOS i Windows, która zamienia płaskie projekty graficzne w fotorealistyczne
mockupy 3D (tzw. boxshoty): pudełka produktowe, opakowania DVD / Blu-ray (keep case),
pudełka CD (jewel case) i same płyty. Ustawiasz światło, miękki cień i odbicie od podłogi, a potem
eksportujesz gotowy obraz – także jako przezroczysty PNG do 4000 × 4000 px.

Mockup Director to otwartoźródłowy projekt, zainspirowany narzędziami dostępnymi tylko na Windows.
Nie zawiera cudzych nazw, szablonów, grafik ani logotypów.

## Funkcje

- **Modele:** pudełko produktowe (dowolne wymiary w mm, wariant slim i z siatki wykrojnika),
  DVD i Blu-ray keep case, pudełko CD, płyta CD / DVD / BD.
- **Grafika:** przeciągnij pliki obrazów na okno albo wybierz je z dysku; każda ściana
  ma swój slot. Do każdego slotu można pobrać szablon PNG z wymiarami, spadami i liniami pomocniczymi.
- **Scena:** obrót kamery, perspektywa / rzut ortogonalny, zoom i przesunięcie, presety oświetlenia,
  miękki cień, odbicie od podłogi, tło przezroczyste, jednolite lub gradientowe.
- **Eksport:** PNG (z przezroczystością) lub JPEG, do 4000 × 4000 px, z marginesem
  i zapisaną rozdzielczością druku (DPI).
- **Projekty:** zapis i otwieranie plików `.mockup`, cofnij / ponów.
- Interfejs po polsku i angielsku.

## Instalacja

Aplikację buduje GitHub Actions. Nie trzeba niczego kompilować.

### Windows

1. Pobierz instalator na jeden z dwóch sposobów:
   - **Releases** (wersje oznaczone tagiem `v…`): pobierz `Mockup Director_x.y.z_x64-setup.exe`.
   - **Actions → „Build Windows app” → ostatni zielony przebieg → sekcja Artifacts**:
     pobierz `MockupDirector-x.y.z-windows-setup` (ZIP z instalatorem w środku). Jest też
     `MockupDirector-x.y.z-windows-portable` – sam plik `.exe`, który działa bez instalacji.
2. Uruchom instalator. Instaluje aplikację tylko dla bieżącego użytkownika, więc nie wymaga
   uprawnień administratora.
3. Wymagany jest Windows 10 lub 11 (64-bit) z Microsoft Edge WebView2 – jest wbudowany w system,
   a w razie braku instalator pobierze go sam.

**Pierwsze uruchomienie:** aplikacja nie jest podpisana certyfikatem, więc Windows SmartScreen
pokaże komunikat „System Windows ochronił ten komputer”. Kliknij **„Więcej informacji” → „Uruchom mimo to”**.
Wystarczy zrobić to raz.

### macOS

1. Wejdź w repozytorium na GitHubie i pobierz plik `.dmg` na jeden z dwóch sposobów:
   - **Releases** (wersje oznaczone tagiem `v…`): pobierz `Mockup Director_x.y.z_universal.dmg`.
   - **Actions → „Build macOS app” → ostatni zielony przebieg → sekcja Artifacts**
     (dopóki repozytorium jest prywatne, ten build uruchamia się tylko przy tagach `v…`
     albo ręcznie: **Run workflow**):
     pobierz `MockupDirector-x.y.z-macos-dmg`. GitHub pakuje artefakty w ZIP – rozpakuj go,
     a w środku będzie `.dmg`. Potrzebne jest konto GitHub z dostępem do repozytorium.
2. Otwórz `.dmg` i przeciągnij **Mockup Director** do folderu **Aplikacje**.
3. Aplikacja jest uniwersalna: działa na Macach z Apple Silicon (M1–M4…) i Intel, macOS 12 (Monterey) lub nowszym – podgląd 3D wymaga silnika Safari 15+ (WebGL 2).

#### Pierwsze uruchomienie aplikacji niepodpisanej (macOS 14 Sonoma / 15 Sequoia i nowsze)

Jeśli build nie był podpisany certyfikatem Apple Developer ID, macOS za pierwszym razem
zablokuje aplikację („Apple nie może sprawdzić…”). Wystarczy jednorazowo:

1. Uruchom Mockup Director (dwuklik) i zamknij komunikat.
2. Otwórz **Ustawienia systemowe → Prywatność i ochrona**, przewiń w dół
   i przy komunikacie o Mockup Director kliknij **„Otwórz mimo to”**. Potwierdź hasłem lub Touch ID.
3. Od tej pory aplikacja uruchamia się normalnie.

Alternatywnie w Terminalu (usuwa atrybut kwarantanny pobranego pliku):

```sh
xattr -dr com.apple.quarantine "/Applications/Mockup Director.app"
```

> Na macOS 15 nie działa już stary trik „prawy klik → Otwórz”. Trzeba skorzystać
> z „Otwórz mimo to” albo z polecenia powyżej.

## Dla programistów

Wymagania: Node.js 22+ (npm). Do budowania aplikacji desktopowej potrzebny jest
[Rust](https://rustup.rs/) (stable), a do tego:

- **Windows:** Microsoft C++ Build Tools (składnik „Programowanie aplikacji klasycznych w języku C++”)
  i WebView2 (jest w Windows 10/11),
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).

Gałęzie: `main` to wersja stabilna (każdy push buduje aplikacje), codzienna praca odbywa się na `dev`.
Build z `dev` można uruchomić ręcznie: **Actions → wybierz workflow → Run workflow → gałąź `dev`**.

```sh
npm install          # zależności
npm run dev          # wersja przeglądarkowa: http://localhost:1420
npm run build        # tsc --noEmit + produkcyjny build do dist/
npm run tauri dev    # aplikacja desktopowa z hot-reloadem (wymaga Rusta)
npm run tauri build  # Windows: instalator NSIS, macOS: .app + .dmg – w src-tauri/target/release/bundle/
npm run tauri build -- --target universal-apple-darwin   # macOS: build uniwersalny (wymaga obu targetów rustup)
cargo test --manifest-path src-tauri/Cargo.toml          # testy części Rust (po npm run build)
```

Ikony aplikacji generuje się z `app-icon.svg`: `npx tauri icon app-icon.svg`.

### Struktura projektu

```
src/
  core/        wspólny kontrakt: typy (types.ts), wartości domyślne, obrazy, placeholdery
  models/      modele 3D (box, keepcase, jewelcase, disc …) + registry.ts (lista w galerii)
  scene/       scena three.js: światło, cień, odbicie, kadrowanie kamery
  export/      eksport PNG/JPEG, szablony druku
  platform/    zapis/odczyt plików (Tauri lub przeglądarka)
  ui/          interfejs (vanilla TS + CSS), tłumaczenia PL/EN
src-tauri/     powłoka desktopowa Tauri v2 (Rust): okno, dialogi, komenda save_file
  tauri.conf.json          wspólna konfiguracja
  tauri.windows.conf.json  dodatki dla Windows (instalator NSIS), scalane automatycznie przez Tauri
  capabilities/default.json, icons/
  deny.toml                dozwolone licencje zależności Rust (cargo-deny)
  about.toml, about.hbs    generowanie listy licencji crate'ów Rust (cargo-about)
.github/workflows/
  build-windows.yml build instalatora .exe (x64) + wersja przenośna + draft Release dla tagów v*
  build-macos.yml   build .dmg (universal) + draft Release dla tagów v* (na razie tylko tagi i ręcznie)
  ci.yml            kontrola części webowej i licencji (Linux), dla main, dev i pull requestów
scripts/licenses.mjs   kontrola licencji pakietów npm + THIRD-PARTY-NOTICES (`npm run licenses`)
app-icon.svg   źródło ikony aplikacji
```

Stack: Vite + TypeScript (strict) + three.js, bez frameworka UI. Aplikacja desktopowa korzysta
z systemowego silnika WWW: na macOS to WKWebView (Safari), na Windows WebView2 (Chromium/Edge).
Kod musi więc działać w Safari 15+.

### Konwencje 3D (skrót z `src/core/types.ts`)

- Jednostki świata to **milimetry**.
- Model stoi na podłodze (najniższy punkt `y = 0`), jest wyśrodkowany w `x`/`z`,
  front jest skierowany do `+Z`, góra do `+Y`.
- Tekstur z `ctx.getTexture()` nie wolno modyfikować (repeat/offset/flipY). Obszary obrazu
  mapuje się przez UV. Grafika nigdy nie może być odbita lustrzanie ani do góry nogami.
- Materiały: `MeshStandardMaterial` / `MeshPhysicalMaterial`; siatki rzucające cień mają `castShadow = true`.

### Jak dodać nowy model

1. Utwórz plik w `src/models/`, np. `poster.ts`, i wyeksportuj obiekt `ModelDefinition`:

   ```ts
   import * as THREE from 'three';
   import type { ModelDefinition } from '../core/types';
   import { L, castShadows, mmParam, num, placeOnGround, printMaterial, solidPlastic } from './shared';

   export const posterModel: ModelDefinition = {
     id: 'poster',
     category: 'box',
     name: L('Plakat na podkładzie', 'Mounted poster'),
     icon: '<svg viewBox="0 0 64 64"><rect x="16" y="8" width="32" height="48" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
     slots: [{ id: 'front', label: L('Przód', 'Front'), aspect: 210 / 297 }],
     params: [
       mmParam('w', L('Szerokość', 'Width'), 210, 50, 1000),
       mmParam('h', L('Wysokość', 'Height'), 297, 50, 1000),
       mmParam('t', L('Grubość', 'Thickness'), 5, 1, 30, 0.5),
     ],
     build(ctx) {
       const w = num(ctx.params, 'w', 210), h = num(ctx.params, 'h', 297), t = num(ctx.params, 't', 5);
       // BoxGeometry material order: +X, -X, +Y, -Y, +Z (front), -Z (back).
       const edge = solidPlastic('#f2f2f2', 0.6);
       const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), [
         edge, edge, edge, edge, printMaterial(ctx.getTexture('front')), edge,
       ]);
       return placeOnGround(castShadows(mesh));
     },
   };
   ```

2. Dopisz go do tablicy `MODELS` w `src/models/registry.ts` – pojawi się w galerii,
   a panel parametrów i sloty obrazów zbuduje się automatycznie z `params` i `slots`.
3. Opcjonalnie dodaj `template` do slotu (szablon druku z wymiarami i spadami)
   i `defaultCamera` (kadr startowy).

### Podpisywanie i notaryzacja (opcjonalnie)

Bez sekretów workflow buduje aplikację podpisaną ad-hoc (`signingIdentity: "-"`). Taka aplikacja
działa, ale przy pierwszym uruchomieniu trzeba ją odblokować (patrz wyżej). Żeby GitHub Actions
budował aplikację podpisaną i znotaryzowaną, dodaj w **Settings → Secrets and variables → Actions**:

| Sekret | Opis |
| --- | --- |
| `APPLE_CERTIFICATE` | certyfikat „Developer ID Application” wyeksportowany do `.p12`, zakodowany base64 (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | hasło do pliku `.p12` |
| `APPLE_SIGNING_IDENTITY` | np. `Developer ID Application: Imię Nazwisko (TEAMID)` |
| `APPLE_ID` | Apple ID konta deweloperskiego (notaryzacja) |
| `APPLE_PASSWORD` | hasło aplikacji (app-specific password) dla tego Apple ID |
| `APPLE_TEAM_ID` | identyfikator zespołu (Team ID) |

Podpisywanie włącza się, gdy ustawione są trzy pierwsze sekrety. Notaryzacja wymaga dodatkowo trzech
kolejnych. Brakujące sekrety są pomijane, więc build bez nich nadal przechodzi.

### Wydanie nowej wersji

1. Podnieś wersję w `package.json` i `src-tauri/tauri.conf.json` (oraz `src-tauri/Cargo.toml`).
   Aktualizując Tauri, podnoś razem pakiety npm (`@tauri-apps/api`, `@tauri-apps/plugin-dialog`,
   `@tauri-apps/cli`) i zakresy `~2.x` w `src-tauri/Cargo.toml` – CLI przerywa build, gdy wersje
   `major.minor` crate'ów Rust i pakietów npm się różnią. Po pierwszym lokalnym buildzie zacommituj
   `src-tauri/Cargo.lock`.
2. Scal `dev` do `main`, a potem `git tag v0.2.0 && git push --tags`. Workflowy dla Windows i macOS
   dołączą instalator `.exe` i plik `.dmg` do jednego **szkicu** Release. Sprawdź go i opublikuj
   ręcznie na GitHubie.

## Licencja

Kod jest udostępniony na licencji [MIT](LICENSE).

Zależności mają wyłącznie licencje liberalne (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode) oraz
MPL-2.0 – słaby copyleft obejmujący tylko pliki samej biblioteki, nie kod aplikacji. Pilnuje tego CI:
job **„License check”** przerywa się, gdy jakakolwiek zależność npm lub Rust ma licencję spoza listy
(np. GPL, AGPL, LGPL). Listy dozwolonych licencji są w `scripts/licenses.mjs` (npm)
i `src-tauri/deny.toml` (Rust). Przy zmianie trzeba je aktualizować razem z `src-tauri/about.toml`.

Ten sam job generuje plik **THIRD-PARTY-NOTICES.md** z pełnymi tekstami licencji wszystkich bibliotek
dołączonych do aplikacji (Actions → przebieg „CI” → Artifacts → `third-party-notices`). Licencje MIT
i Apache wymagają dołączenia tych informacji do dystrybuowanej aplikacji, więc przed wydaniem
wersji warto dołączyć ten plik do Release.

Lokalnie część npm sprawdzisz poleceniem `npm run licenses`.

## Znaki towarowe

Mockup Director nie zawiera logotypów ani znaków towarowych osób trzecich (np. logo DVD Video, Blu-ray Disc,
Apple). Jeśli Twój projekt ich wymaga, umieść je we własnej grafice zgodnie z licencją właściciela znaku.
Wszystkie nazwy handlowe należą do ich właścicieli.

---

## English (short)

**Mockup Director** is a macOS and Windows app that turns flat artwork into photorealistic 3D product mockups:
product boxes, DVD / Blu-ray keep cases, CD jewel cases and discs. It has lighting, soft shadows,
floor reflections and transparent PNG export up to 4000 × 4000 px. The UI is in Polish and English.

- **Install on Windows:** download `*_x64-setup.exe` from *Releases* or from *Actions → Build Windows app →
  latest run → Artifacts* (a portable `.exe` is there too). Windows 10/11 x64. The build is unsigned, so on
  first launch click *More info → Run anyway* in the SmartScreen dialog.
- **Install on macOS:** download the `.dmg` from *Releases* (tags `v*`) or from *Actions → Build macOS app →
  latest run → Artifacts* (it comes zipped). Then drag Mockup Director to Applications. It is a universal
  binary (Apple Silicon + Intel) and needs macOS 12+ (Safari 15+ WebKit for WebGL 2).
- **Unsigned build, first launch:** open the app once, then go to *System Settings → Privacy & Security
  → Open Anyway*. Or run `xattr -dr com.apple.quarantine "/Applications/Mockup Director.app"`.
- **Develop:** `npm install`, `npm run dev` (browser), `npm run tauri dev` / `npm run tauri build`
  (Rust + MSVC Build Tools on Windows, Rust + Xcode CLT on macOS). Branches: `main` = stable, `dev` = daily work.
- **New model:** export a `ModelDefinition` (see `src/core/types.ts`) and add it to `MODELS` in
  `src/models/registry.ts`.
- **Signing:** set the `APPLE_*` repository secrets listed above. Builds without them stay ad-hoc signed.
- **License:** [MIT](LICENSE). CI ("License check") fails if any npm or Rust dependency has a license outside
  the allow list (no GPL/AGPL/LGPL) and produces `THIRD-PARTY-NOTICES.md` as an artifact.
- **Trademarks:** no third-party logos are included. All trademarks belong to their owners.
