# NovelType — Change Log

I use this file to keep track of what has changed in NovelType and what still needs to be done.

## Reading, typing, and navigation

- Dropped the custom keyboard idea and kept the other planned changes. Added arrow-key navigation for the Continue, Retry, and Library actions shown after a session.
- Made settings help appear only when hovering over a setting name, and added the Vintage theme to the theme help.
- Added a second homepage layout with a control to switch layouts. Added a subtle center glow to one version and adjusted the homepage and typing layout to use space more comfortably.
- Reworked the reading page, made reading and typing separate pages, and added chapter-by-chapter reading. Added keyboard controls for changing chapters and scrolling, and fixed page clipping and chapter progress issues.
- Updated the chapter picker so it opens from its own button and follows the site theme. Selecting a chapter in typing mode resets the cursor to that chapter's start.
- Made the typing layout closer to the reading layout, centered the active typing text, and adjusted the fade as the text moves between lines. Removed the fade when asked, then added it back and tuned it after the focus-mode issue was fixed.
- Restored the original Focus icon, added a Focus hover label, enabled fullscreen in Focus mode, and expanded the reading area to use the space at the top. Kept the text above the cursor visible when Focus mode starts.
- Added Ctrl+Backspace and hid the visible scrollbars throughout the site.
- Changed the dark and Vintage themes using the supplied references, then reduced the center light in both themes.
- Reorganized the homepage, reverted the Radiance changes, removed Folio, and used the supplied PageTyper homepage as a reference for the alternate layout.
- Improved performance and mobile layout. Typing is disabled on mobile with a notice; mobile reading now follows the finger continuously instead of jumping by a page.

## Library and deployment

- The library stores book text and reading progress in the browser. I also addressed theme and book persistence problems noticed around deployment. Books remain local to that browser unless they are moved using the app's backup flow; they do not automatically sync between devices.

## PDF support

- Added PDF import to the existing reading flow.
- Fixed the cleanup error caused by calling `destroy()` on the PDF document instead of its loading task.
- Added the PDF.js reader, matching worker, and supporting font, CMap, ICC, and WASM files under `vendor/pdfjs`, so PDF reading does not depend on a remote CDN. The included license is in that folder.
- Made PDF books read-only across the app. The Type button and mode setting are disabled while a PDF is open.
- Checked the local app with a two-page text PDF: it imported, displayed text from both pages, and kept typing disabled.
- Before deployment, I need to include the complete `vendor/pdfjs` folder with the app changes.





## Keeping this log current

- 2026-10-03 — Made the PDF Read only button show a short notice beside itself when clicked, and clarified on the home screens that PDFs are read-only.
- 2026-10-03 — Restyled the PDF read-only notice to use the same themed tooltip as settings help.
- 2026-10-03 — Fixed the PDF notice not appearing by moving the shared tooltip outside the closed settings dialog.
- 2026-10-05 — Restored the settings tooltip inside its modal layer and gave the PDF read-only notice a separate matching tooltip.
- 2026-10-05 — Removed the underline and help cursor from settings labels while keeping hover tips available.
- 2026-10-05 — Added four switchable library layouts (Shelves, Grid, Compact, and Catalog), retained Current as the fifth, and saved the selected layout on the device.
- 2026-10-05 — Replaced the five library layouts with one themed shelf: EPUBs appear as upright books and PDFs as paper documents.
- 2026-10-05 — Split the shelf into separate Books and Documents sections and gave all shelf items a consistent footprint.
- 2026-10-05 — Removed the background panel behind the shelf while keeping its subtle edge.
- 2026-10-05 — Cleared the remaining shelf edge and hid the Books/Documents headings without moving the items.
- 2026-10-05 — Removed the theme-specific grey library panel that overrode the transparent shelf background.
- 2026-10-05 — Reduced the vertical gap between the Books and Documents shelves.
- 2026-10-05 — Tightened the shelf section gap a little more.
- 2026-10-05 — Added Shelf and Original tabs to switch between the bookshelf and compact library list; the chosen tab is saved on this device.
- 2026-10-05 — Added distinct book-cover and PDF-paper treatments for Dark, Vintage, and Light themes.
- 2026-10-05 — Limited each shelf to three visible items and added scroll arrows when more books or documents are available.
- 2026-10-05 — Removed the accent-colored hover outline from shelf books and documents.
- 2026-10-05 — Kept book and document titles in their normal color when hovered.
- 2026-10-05 — Restored the previous Dark library styling while keeping the Vintage and Light treatments.
- 2026-10-05 — Removed the “Your library” heading and renamed the Original view tab to List.
- 2026-10-05 — Blocked re-uploads when the parsed file contents and format already exist in the library.
- 2026-10-05 — Extended duplicate checks across EPUB/PDF formats using normalized title/author metadata and normalized text similarity.
- 2026-10-05 — Made EPUB cover colors stable by deriving each book’s palette choice from its title and author instead of its shelf position.
- 2026-10-05 — Assigned every EPUB a distinct saved cover color that stays with the book across sorting, reloads, and library imports.
- 2026-10-05 — Shifted the book-cover palette to muted cool hues with softer differences in saturation and brightness.
- 2026-10-05 — Restored the original five book-cover colors while keeping a distinct saved color assignment for every EPUB.
- 2026-10-05 — Added a Nature theme with forest greens and wood accents, plus wood-grain EPUB covers and brown paper styling for PDFs.
- 2026-10-05 — Tuned the Nature library shelf for phone screens with roomier book covers, smaller spine borders, and readable title spacing.
- 2026-10-05 — Reworked Nature book covers for mobile with a direct wood-grain background and explicit narrow-screen text wrapping.
- 2026-10-05 — Switched the library to List automatically on phones and restored the saved Shelf/List preference when returning to desktop width.
- 2026-10-05 — Simplified the phone List view to compact title, author, and progress rows with visible Books/Documents labels.
