# Den — project plan

> **Den is a placeholder, not a decision.** It exists so the repo, package names,
> and issue labels have somewhere to live while we build. It is not final; see
> [Naming](#12-naming). Status: planning. No app code written yet.

## 1. What this is

A calm, fast Android PDF reader that treats a document like a physical book:
it turns pages with a real curl, lets you pinch and read closely, lets you lift
a passage and hand it to Google or an AI app, and remembers exactly where you
stopped. No account, no cloud, no AI built in, no network permission.

One sentence: **your PDFs, bound to your device.**

## 2. Principles

1. **The page is the interface.** Chrome disappears while reading. The book is
   the only thing on screen.
2. **Calm, not clever.** Warm paper, one muted accent, no neon, no badges, no
   confetti. Motion exists to explain a page turn, not to entertain.
3. **Private by construction.** The release build declares no network
   permission. The app cannot phone home even if it wanted to. Reading data
   never leaves the device unless the user explicitly shares it.
4. **One job.** Read PDFs well. Everything that is not reading lives behind an
   intent to another app.
5. **Free and open.** MIT licensed, no ads, no paid tier, no telemetry.

## 3. Non-goals (v1)

- No AI integration of any kind. The app only builds text and hands it off.
- No accounts, sync, cloud storage, analytics, crash reporting, or OTA updates.
- No EPUB/MOBI. PDF only in v1.
- No annotation layer beyond bookmarks and text selection. Highlights are
  reserved in the data model but not built.
- No DRM or encrypted PDFs. Password-protected PDFs are a later decision.
- No iOS release in v1. The PDFKit path exists in the native module but Android
  ships first.
- No library management features: collections, tags, reading stats, goals.

## 4. Decisions

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | PDF engine | Custom RN module over pdfium (Android) and PDFKit (iOS) | Only path that gives page textures, text boxes, and selection under MIT. `react-native-pdf` has no Android selection. |
| D2 | Build system | Expo + prebuild, dev client, EAS Build | Native modules still work; Play Store AAB can be built without a Mac. |
| D3 | Repo shape | pnpm monorepo: `apps/reader` + `packages/pdf-skia` | One repo for all; the engine is reusable and publishable, which is what earns stars. |
| D4 | Network | Release build has **no `INTERNET` permission** | The strongest privacy claim available. Debug/dev-client builds keep it. |
| D5 | License | MIT | Lowest friction for reuse and contributions. |
| D6 | Page layout | Single page, fit-page default, smart crop, pinch zoom | Preserves the physical-book illusion; zoom is a utility mode, not the default. |
| D7 | Storage | Copies of PDFs in app storage, SQLite metadata | Library survives the source file moving or being deleted. |

## 5. Architecture

### Repo layout

```
apps/reader/            Expo app, navigation, library, reading screen
packages/pdf-skia/      RN module: pdfium/PDFKit + Skia reader surface
  android/              JNI shim + pdfium
  ios/                  PDFKit bridge
  src/                  TS API, gestures, curl shader, selection layer
docs/                   PLAN.md, ADRs (later)
samples/                Real PDFs used to validate geometry and text layers
```

### Module API

The JS side never parses a PDF. The native module exposes the minimum:

```ts
openPdf(uri: string): Promise<DocumentInfo>          // pages, crop boxes, rotation, hasText
renderPage(page: number, region: Rect, scale: number): Promise<Uint8Array>
getTextPage(page: number): Promise<TextPage>          // lines, chars, boxes; lazy
searchPage(page: number, query: string): Promise<Rect[]>
```

Coordinate rule: PDF points with a bottom-left origin (pdfium) are converted in
one place to top-left Skia space. Every geometry bug starts here, so this layer
gets unit tests and a synthetic PDF fixture.

### Rendering

- Pages become Skia textures. Current page at 2x, neighbours at 0.5x for the
  curl preload.
- Zoom does not upscale a blurry texture forever: after the gesture settles,
  the visible region is re-rendered at the higher scale.
- Texture cache holds at most three pages. Evicted by distance from the
  current page.
- The curl is a Skia `RuntimeShader` cylinder projection driven by a shared
  gesture value on the UI thread. Release commits or cancels by velocity.
  Reference: William Candillon's Riveo, and the Skia page-curl components.

### Text selection

- Android: `FPDFText_GetCharIndexAtPos` for hit testing, then
  `FPDFText_CountRects` / `FPDFText_GetRect` for the selected range. Selection
  handles and quads are drawn in Skia.
- iOS: `PDFSelection` and `PDFPage.selection(for:)`.
- Text is extracted per page on demand, never for the whole document.
- A page with no text layer disables selection with a quiet explanation. It is
  not an error state.

### Smart crop

Render the page small, measure ink coverage per row and column, take the
content bounding box, add ~3% padding, and clamp the crop at 18% per side so
art and full-bleed pages do not get cut. Result is stored per page.

### State and data

- SQLite for anything durable. `expo-sqlite` unless profiling says otherwise.
- Zustand for screen state that should not hit disk.
- `expo-router` for navigation.
- `react-native-gesture-handler`, `react-native-reanimated`, and
  `@shopify/react-native-skia` for the reading surface.

### Data model

```
books(id, title, author, file_path, cover_path, page_count, has_text_layer,
      size_bytes, added_at, last_opened_at)

progress(book_id PK, page_index, zoom, pan_x, pan_y, updated_at)

bookmarks(id, book_id, page_index, label, created_at)

page_cache(book_id, page_index, crop_json, text_path)

settings(key, value)          -- theme, handoff provider, motion scale

-- reserved for v2, not created in v1
highlights(id, book_id, page_index, text, rects_json, note, color, created_at)
```

## 6. Interaction spec

### Reading

- Drag from the page edge: the sheet lifts and follows the finger. Shadow tracks
  the fold. The backside is blank paper. Release commits or cancels by
  velocity. A short haptic tick fires on commit.
- Tap: a fast curl, about 260 ms.
- No visible chrome. Tap the centre to reveal it; it fades out again.

### Zoom

- Pinch suspends curling. Above 1x, dragging pans.
- While zoomed, a page turn happens only from the horizontal edge, so panning
  never fights the turn.
- Returning to fit-page restores the curl.

### Selection

- Long-press freezes the page and selects the word under the finger.
- Dragging the handles extends the selection by line, using the char boxes.
- Action bar: **Search** (Google, default), **Explain**, **Translate**,
  **Copy**.
- Explain and Translate send the selection to the selected external app with a
  prompt prefix. Nothing is sent until the user taps.

### Resume and bookmarks

- Reopening restores page, zoom, and pan offset exactly.
- A bookmark stores a page and an optional label. It is drawn as a small paper
  marker on the page edge, never as a modal.

## 7. Handoff to other apps

The app has no AI SDK, no API key, and no network code. It only composes text
and opens an intent.

| Action | Default | Prefix |
|--------|---------|--------|
| Search | Google (URL) | none |
| Explain | chosen provider | `Explain the following passage:` |
| Translate | chosen provider | `Translate the following passage:` |

- **Installed apps** are reached with a share intent targeted at the package
  (ChatGPT, Claude, Gemini). This is reliable and keeps the passage out of a
  URL and out of browser history.
- **Fallback** is a URL template opened with `ACTION_VIEW`:
  - Google: `https://www.google.com/search?q={text}`
  - Gemini: `https://gemini.google.com/app?q={text}`
  - ChatGPT: `https://chatgpt.com/?q={text}`
  - Claude: `https://claude.ai/new?q={text}`
- A custom template field lets a user point at anything else.
- Selections over ~1,500 characters are trimmed with a quiet note, because both
  share intents and URLs have practical limits.
- Because the user's choice of provider is the only thing stored, and no request
  is made by our process, the Play Store data-safety form stays simple.

## 8. Visual direction

| Token | Light | Dark |
|-------|-------|------|
| Background | `#F7F3EA` (warm paper) | `#101010` |
| Surface | `#FFFCF6` | `#171614` |
| Ink | `#1E1A16` | `#E8E2D6` |
| Muted | `#6B6258` | `#9A9186` |
| Accent | `#8C6A4F` (muted clay) | `#C08F6B` |
| Hairline | `#E4DCCF` | `#2A2723` |

- One accent only. No gradients on text, no glow, no neon.
- UI type: the platform sans (Inter/SF/Roboto). The document supplies its own
  type; never re-typeset it.
- Radius 10–14. Motion 220–280 ms with spring easing for the curl and
  ease-out for chrome fades.
- The placeholder icon (`#ea580c`) is replaced by a single muted mark.

## 9. Milestones

**M0 — Spike (2–3 weeks, ~100 h).** Throwaway Expo app, one hardcoded PDF, only the
native module and the Skia surface. Go/no-go criteria:

- curl at 60 fps on a mid-range Android phone
- selection accurate to within ~2 px, handles usable
- a 300-page PDF opens to page one in under ~1.5 s
- memory stays flat while flipping, under the budget below

If the spike fails, fall back to `react-native-pdf-jsi` or pdf.js before writing
app architecture.

**M1 — Reader core.** Import via the system file picker, library, cover
thumbnails, render + smart crop, resume, bookmarks.

**M2 — Selection and handoff.** Text boxes, selection handles, action bar,
provider settings, share/URL handoff, trimming.

**M3 — Launch.** Polish, accessibility pass, CI, signed AAB, Play Store
listing, README with a demo GIF, privacy policy, MIT license.

**v2 backlog (not v1):** in-book search, highlights, local reading log for
agents, tablet two-page spreads, EPUB.

## 10. Performance budgets

| Metric | Budget |
|--------|--------|
| Page turn | 60 fps, under 1% dropped frames |
| Cold open, 300 pages | < 1.5 s to first page |
| Resume | < 500 ms |
| Peak memory | < 250 MB |
| Texture cache | 3 pages max |
| Install size | < 30 MB (app bundle, split ABIs) |
| Min Android | API 26 (Android 8) — proposed |

## 11. Risks

1. **Coordinate transforms.** Crop box, rotation, and zoom stacking are the most
   likely source of subtle selection and highlight bugs. Mitigation: single
   conversion layer, synthetic fixtures, unit tests.
2. **A4 geometry.** A physical book page is ~5×7 in; a PDF page is often
   8.3×11.7 in. On a phone, whole-page view makes text tiny, which kills the
   book illusion. Mitigation: smart crop, then decide with real samples whether
   a fit-width column mode is needed.
3. **Scanned PDFs.** No text layer means no selection. Accept and state clearly;
   OCR is out of scope.
4. **Skia curl memory.** High-resolution textures plus a shader can spike
   memory. Mitigation: tiles, neighbour downscaling, strict cache eviction.
5. **Single-maintainer dependencies.** Prefer libraries we can vendor or patch.
6. **Naming and trademark.** See below; check before publishing.

## 12. Naming

**Den is the working placeholder.** The repo lives at
`github.com/Icy-Bear/den`, the Android package is `com.icybear.den`, and the
display name is "Den" until the name is settled. Choosing a placeholder on
purpose unblocks the build: renaming before the first Play Store upload costs
one repo rename (GitHub redirects the old path) plus three strings and the
application id. Nothing about the architecture depends on the name.

The placeholder is not final. It was picked because it is short, cozy, and
descends from `Icy-Bear` — a den being where a bear reads. If it survives
testing, it can stay; if not, we rename before v1.0.

Criteria for the real name: calm, literary, not descriptive (`PDF`, `Book`,
`Reader`), no `Pro`, no AI connotation, easy to spell out loud, good icon
potential. Repo names under `Icy-Bear` only need to be unique to that account,
so GitHub handle availability is not a constraint; npm names can be scoped
(`@icybear/...`).

Candidates worth revisiting later, all checked on 2026-11-03:

| Name | Meaning | Notes |
|------|---------|-------|
| **Den** | a bear's home; a quiet reading den | Placeholder. Short, warm, ties to `Icy-Bear`. Generic enough that a final check is needed. |
| **Boreal** | the northern forest; cold outside, warm inside | Distinctive and calm, but three syllables and less immediate. |
| **Chapbook** | a small, hand-bound book of poems or stories | Very bookish and uncommon; two syllables; may read as a product for chapbooks specifically. |
| **Bookplate** | the ex-libris label inside a cover | Distinctive, npm name free, but slightly formal. |
| **Octavo** | a book format (8vo) | Elegant and precise; may sound technical. |

Previously considered and rejected: **Flyleaf**, **Endpaper**, **Verso**, and
**Livre** (the owner did not like any of them); **Folio** (crowded), **Quire**
(project-management app), **Codex** (strong AI association), **Vellum**
(book-formatting app), **Leaflet** (mapping library), **Imprint** (fintech app),
**Tome** (heavy connotation), **Colophon** (too obscure).

Before the Play Store listing, do a trademark check and a domain check. Neither
is needed to start building.

## 13. Open questions

Resolved: the sample library has been measured (see §14). Ten of twelve books
have a real text layer; two are pure scans.

1. **Name.** Den is a placeholder; revisit before v1.0.
2. **Focus mode.** The measurements say fit-page alone is too small for most of
   the library. Build a column-focus mode into v1, or ship fit-page plus pinch
   zoom first? The hour difference is in §15.
3. **OCR.** The two scanned books cannot support selection or search without
   OCR. Defer unless those books matter for v1.
4. **Password-protected PDFs.** Support in v1 or defer?
5. **Tablets and landscape.** Single page only in v1?
6. **Play Store account.** Who owns the listing, and where does the privacy
   policy live (a page in this repo is enough)?

## 14. Sample library findings

Measured 2026-11-03 with PyMuPDF. Twelve files, 5,696 pages, ~112 MiB.

| Book | Pages | Trim | Text / scan pages | Notes |
|------|------:|------|-------------------|-------|
| Autobiography of a Yogi | 537 | 8.5×11 | 537 / 0 | large trim, 16% side margins |
| Practical Malware Analysis | 802 | 7×9.25 | 780 / 22 | 38% top margin, figures |
| Generative AI v4 | 17 | 8.5×11 | 17 / 0 | marketing layout |
| Hinduism for Schools | 130 | 8.5×11 | 2 / 128 | **scanned** |
| Hacking: Art of Exploitation | 492 | 7×9.25 | 483 / 9 | code-heavy |
| LinalDiff | 9 | 8.5×11 | 9 / 0 | math, rotated sidebar |
| Modern X86 Assembly | 685 | 6×9 | 684 / 1 | 37% top margin |
| Penetration Testing | 531 | 7×9.25 | 500 / 31 | figures |
| Primary Hinduism | 125 | 8.5×11 | 0 / 125 | **scanned** |
| Art of Assembly | 764 | 7×9.25 | 748 / 16 | 23 MiB, watermark |
| Laws of Human Nature | 690 | A4 | 686 / 4 | 32% bottom margin |
| Web App Hacker's Handbook | 914 | 7.36×9.25 | 897 / 17 | 914 pages |

What this means:

1. **All twelve are single-column.** My crude column detector fired on sidebars
   and code blocks, not real two-column text. There is no reflow problem to
   solve, which saves a lot of work.
2. **94% of pages have a text layer** (5,343 of 5,696). Selection, search, and
   handoff work on ten books. The two scanned books (253 pages) have none.
3. **Fit-page is not enough for most of the library.** On a 400 dp phone, the
   6×9 book lands near a comfortable ~17 dp body size. The 7×9.25 and Letter/A4
   books land around 11–13 dp after smart crop, which reads as small. A
   column-focus mode is the difference between a reading app and a pinch-zoom
   app. This is the main product finding.
4. **Margins are large** (10–38%), so smart crop is high value and pays for
   itself.
5. **The performance bar is set high:** 800–900 page books and a 23 MiB file.
   Cold open, cache eviction, and memory must be designed for that, not for a
   demo PDF.
6. **Scanned pages are interleaved** in otherwise digital books (100 pages
   across seven files). Crop and selection must degrade gracefully per page,
   not per document.

## 15. Effort to v1

Assumptions:

- Android only; one developer (me) with AI assistance; you test on device and
  make the product calls.
- The M0 spike becomes the production module; its hours are not thrown away.
- Includes a Play Store release, not just a sideloadable APK.
- Excludes OCR, EPUB/reflow, highlights, the in-book search UI, the agent log,
  tablet spreads, and iOS.

| Milestone | Low | Likely | High |
|-----------|----:|-------:|-----:|
| M0 spike: pdfium core, Skia curl, selection proof | 80 | 100 | 120 |
| M1 reader core: import, library, crop, focus mode, resume, bookmarks | 110 | 135 | 160 |
| M2 selection and handoff | 60 | 75 | 90 |
| M3 polish, performance, QA, release | 100 | 125 | 155 |
| **Total** | **350** | **435** | **525** |

**Roughly 435 focused engineering hours, range 350–525.** That is about 11 weeks
at 40 h/week, 14.5 weeks at 30, 22 weeks at 20, or 44 weeks at 10. Elapsed time
runs 20–30% higher once device testing and review cycles are included.

Scenarios:

- **Full v1.1** — comfortable for the whole shelf, Play Store, full polish: ~435 h.
- **Lean v1** (recommended first release) — ~310 h. See below.
- **Ultra-lean core** — ~270 h. Drops lite focus; pinch zoom only.
- **With OCR** for the two scanned books: +100–150 h on top of whichever.

What moves the number:

- Full focus mode: +40–60 h.
- OCR: +100–150 h.
- iOS: +150–200 h.
- Tablet two-page spread: +20–30 h.
- Password-protected PDFs: +8–12 h.
- Dropping the curl: −50–70 h (not recommended; it is the product).

### Lean v1 (recommended first release)

Target **~310 h, range 260–360**. It keeps every promise that defines the
product and defers polish and store presence. Do not try to make it work well on
every file in `samples/`; target the six book-shaped files, which are 4,188 of
the 5,696 pages.

| Cut from the 435 h plan | Saves | Cost |
|-------------------------|------:|------|
| Signed APK on GitHub instead of Play Store | 25 h | Sideload for v1; store later |
| Full focus mode replaced by lite focus (text-column zoom + vertical pan) | 30 h | No per-page auto-scroll or mode transitions |
| No cover thumbnails or library polish | 12 h | Plain list with title and page count |
| No tiling; render at 2x and re-render after zoom settles | 12 h | Brief softness while zooming very large pages |
| Restore page and reading mode, not exact pan offset | 6 h | Reopens at the top of the page |
| Page-only bookmarks, no labels | 4 h | Cannot name a bookmark |
| Defer the full accessibility audit; keep basic labels | 8 h | Weaker TalkBack experience |
| Test one phone plus one emulator, not a device matrix | 12 h | Less coverage of odd hardware |
| Skip CI and launch assets until public launch | 10 h | Add before the repo goes public |
| Do not tune for the 900-page / 23 MiB outliers | 8 h | They open, just slower |
| **Total** | **~127 h** | **~310 h** |

What remains in lean v1:

- import and a plain library list
- smart crop, curl, pinch and pan, lite focus
- selection, Google search, share-sheet explain/translate with a saved provider
- page resume and page bookmarks
- calm light/dark UI
- signed APK

What it deliberately does not do:

- selection in the two scanned books
- per-page column auto-scroll (lite focus only)
- fast cold open on the 900-page outlier
- highlights, in-book search UI, agent log, iOS, tablets

Below ~250 h the only things left to cut are the curl or Android selection.
Neither is acceptable; that is the floor.
