# Planner: Den Reader — Text Selection, Screen Space Optimization & Two-Page Landscape Spread

**Target Repository**: `mobile-book-reader-pro`  
**App Target**: `apps/reader` (`com.icybear.den`)  
**Status**: Ready for User Review  

---

## 1. Executive Summary

This plan outlines the architecture, UX design, and implementation steps for three core capabilities requested for the **Den** book reader:

1. **Double-Tap Text Selection & One-Tap Copy**:
   - Double-tapping text detects the word/sentence at the touch point, displays a calm paper highlighter overlay, and presents a minimal floating **"Copy"** button.
2. **Optimal Screen Space Utilization (Eliminating Vertical Letterboxing)**:
   - Eliminating the large top/bottom dead space caused by aspect ratio mismatch (tall ~20:9 phone displays vs. 3:2 book PDFs) through smart margin trimming and height-priority viewport scaling.
3. **Landscape Two-Page Physical Book Spread**:
   - Automatically detecting device rotation (`portrait` ↔ `landscape`) and rendering a realistic two-page physical book spread (Left/Verso + Right/Recto) with a central binding spine and dual-page flip dynamics.

---

## 2. Feature 1: Double-Tap Text Selection & One-Tap Copy

### Problem & Objectives
- PDFs rendered as pure bitmaps provide no native text selection unless coordinates are bridged from the PDF text layer.
- Long-pressing interferes with pan/scroll gestures. A crisp **double-tap** gesture provides an unambiguous, intuitive interaction for readers to select a word or sentence without accidental triggers during page flips.
- Once selected, a single, distraction-free **"Copy"** button floats directly above the selection, copying the raw text to the device clipboard and dismissing the overlay.

### Technical Architecture
`io.legere:pdfiumandroid:2.0.1` already includes native C++ bindings for text extraction and spatial mapping:
- `openTextPage(doc, pageIndex)`: Initializes the text layer for the active page.
- `textPageCountChars(doc, pageIndex)`: Character count for string offsets.
- `textPageGetText(doc, pageIndex, startIndex, count)`: Extracts UTF-8 text.
- `mapRectToPage(doc, pageIndex, ...)` / `mapPageCoordsToDevice(...)`: Translates screen touch coordinates `(x, y)` in dp/pixels to PDF point coordinates.
- `textPageGetRect(doc, pageIndex, rectIndex)` / `textPageCountRects(...)`: Extracts line bounding boxes for text ranges.

### Implementation Blueprint
1. **Native Layer (`PdfSkiaModule.kt`)**:
   - Expose `getTextAtPoint(pageIndex: Int, xPt: Float, yPt: Float, targetWidth: Int): Promise<TextSelectionResult>`:
     - Maps touch point `(x, y)` to character index.
     - Expands selection to word boundaries (space/punctuation delimiters).
     - Returns:
       - `text: String` (the selected text).
       - `rects: Array<{ x, y, width, height }>` in screen coordinates for highlighting.
   - Expose `copyToClipboard(text: String)`:
     - Uses Android's `ClipboardManager` to write plain text directly.
2. **Gesture & Overlay Layer (`Reader.tsx` / `TextSelectionOverlay.tsx`)**:
   - Add a `Gesture.Tap().numberOfTaps(2)` gesture handler simultaneous with existing single-tap and pan.
   - On double tap, trigger `getTextAtPoint`.
   - Render semi-transparent warm highlighter rectangles (`rgba(224, 185, 90, 0.32)`) matching physical book highlighters.
   - Render a floating pill button `[ Copy ]` above the top rectangle with a smooth fade-in animation.
   - Tapping anywhere outside clears the selection.

---

## 3. Feature 2: Eliminating Empty Top & Bottom Space (Vertical Screen Optimization)

### Problem Analysis
- **The Screen**: Modern Android devices (like the test device `1080×2344`) have tall `~19.5:9` to `20:9` aspect ratios (ratio `~2.17`).
- **The Book**: Standard 6×9" book PDFs have a `1.5` aspect ratio (`MediaBox: 432 × 648`).
- **The Issue**: Fitting a 1.5 ratio page to the width leaves `~260 dp` of empty vertical space (split between top and bottom). Furthermore, PDFs have 0.75" to 1.25" of printed whitespace margins built into each page, exacerbating the feeling of wasted space.

### Proposed Solution
1. **Trim Margins / Content Crop (Recommended Default)**:
   - Calculate the PDF's content bounding box (ignoring empty outer margins) via pdfium text/drawing rect boundaries or configurable margin trim percentage (typically `12%` top/bottom, `8%` sides).
   - Zoom/scale the rendered content so the actual readable text fills the viewport height comfortably, increasing font readability by ~25–35%.
2. **Vertical Alignment & Bleed**:
   - Anchor the page top closer to the reading header rather than centering with massive dead gutters.
   - Integrate the bottom folio (`page / count`) right into the lower margin, treating the phone screen as the page itself rather than a card floating inside empty margins.
3. **Optional Display Mode Toggle**:
   - In floating settings or quick tap:
     - **"Fill Screen (Trim Margins)"** (Maximum text size, optimal screen usage).
     - **"Fit Entire Page"** (Original full page view showing printed margins).

---

## 4. Feature 3: Landscape Mode & Two-Page Physical Book Spread

### Problem & Objectives
- Currently, `apps/reader/app.json` has `"orientation": "portrait"`, and `AndroidManifest.xml` has `android:screenOrientation="portrait"`. The app cannot rotate when the phone is turned.
- In landscape mode (`width > height`), a single page looks excessively wide and awkward to read. A real physical book opened horizontally naturally displays a **two-page spread** (Left/Verso page + Right/Recto page) with a central binding spine.

### Architecture & Mechanics
1. **Orientation Unlocking**:
   - Update `app.json`: Change `"orientation": "portrait"` to `"default"`.
   - Update `AndroidManifest.xml`: Remove hardcoded `android:screenOrientation="portrait"` or set to `"unspecified"`.
   - Add dynamic runtime unlock in `PdfSkiaModule.kt`:
     ```kotlin
     currentActivity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR
     ```
2. **Two-Page Spread Layout (`SpreadLayout.tsx`)**:
   - Detect orientation via `useWindowDimensions()`: `isLandscape = width > height`.
   - In landscape:
     - **Left Page (Verso)**: Even page index `N` (or blank on page 1 if treating page 1 as standalone cover).
     - **Center Spine Crease**: Deep central vertical gradient shadow (`width: 32dp`) simulating the bound valley between open pages.
     - **Right Page (Recto)**: Odd page index `N + 1`.
     - **Sizing**: Each page width = `(width - spineWidth) / 2`. Heights scaled to fit `height`.
3. **Landscape Page Turn Animation**:
   - When turning forward in two-page mode:
     - The Right Page (Recto) lifts from its outer right edge, rotates along the center spine (`rotateY: 0° → -180°`), and folds over onto the left side, becoming the new Verso page.
     - The underneath page reveals the next spread.
   - When turning backward:
     - The Left Page lifts from the center spine and swings back to the right.

---

## 5. Implementation Roadmap & Milestones

| Milestone | Scope | Deliverables |
| :--- | :--- | :--- |
| **Milestone 1**<br>Native & Config Foundation | Native Kotlin APIs & Manifests | • Update `app.json` & `AndroidManifest.xml` for sensor orientation.<br>• Implement `getTextAtPoint`, `extractSelection`, and `copyToClipboard` in `PdfSkiaModule.kt`.<br>• Compile and test debug build via CI pipeline. |
| **Milestone 2**<br>Screen Space Optimization | Margin Crop & Vertical Scaling | • Implement content margin trimming in `Reader.tsx`.<br>• Eliminate dead top/bottom gutters in portrait mode.<br>• Verify text sizing and readability on device. |
| **Milestone 3**<br>Text Selection & Copy UI | Gestures & Highlight Overlay | • Implement double-tap gesture handler.<br>• Render warm highlighter rects on tapped word.<br>• Render floating `[Copy]` pill button with clipboard integration.<br>• Verify copy-to-clipboard on Android. |
| **Milestone 4**<br>Two-Page Landscape Spread | Dual-Page Reader & Center Spine | • Implement orientation listener (`isLandscape`).<br>• Render dual-page spread (Verso + Recto) with central spine shadow.<br>• Implement dual-page turn animation around central spine.<br>• Test on device by rotating screen. |

---

## 6. Open Review Points for the User

1. **Text Selection Scope on Double-Tap**:
   - *Option A*: Select the specific **word** double-tapped (standard behavior, quick to copy a word or lookup term).
   - *Option B*: Select the entire **sentence / paragraph** double-tapped.
   - *Recommendation*: Double-tap selects the **word**, with selection drag handles to expand if desired.
2. **Page 1 Cover Handling in Two-Page Mode**:
   - *Option A*: Page 1 displays centered as a single cover page; turning page 1 opens the two-page spread (Pages 2 & 3).
   - *Option B*: Page 1 displays immediately on the right side with a blank left endpaper.
   - *Recommendation*: Option A (Page 1 centered as cover, subsequent pages in 2-page spreads).
3. **Screen Space Optimization Mode**:
   - *Recommendation*: Default to smart margin trimming (~15% whitespace crop) so text fills the vertical height without letterboxing, with a tap toggle to view untouched margins.
