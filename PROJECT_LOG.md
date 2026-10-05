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
