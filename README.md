# NovelType

NovelType is a browser-based reading and typing-practice app for EPUB books and PDF documents. It keeps the library and reading progress in the current browser, offers several reading themes, and lets readers practise by copying text from an EPUB.

## What it can do

### Library and files

- Import EPUB and PDF files by selecting them or dropping them on the home page.
- Open EPUBs in **Read** mode or **Type** mode. PDFs are always read-only.
- Keep EPUB books and PDF documents in separate sections of the library.
- Switch the library between **Shelf** and **List** layouts. The Shelf shows up to three items at once and scrolls sideways for more.
- Detect likely duplicate books, including copies uploaded in another file format.
- Start with a sample EPUB guide and a sample PDF guide. Remove them like other library items; use **Re-add demo files** to restore whichever sample is missing.

### Reading

- Choose a chapter from the chapter menu; the reader loads the selected chapter.
- Use the Contents dialog to browse chapters and bookmarks.
- Add bookmarks and search the open book.
- Adjust the font, text size, line height, letter spacing, and reading-column width.
- Use Focus mode to expand the reading area and enter fullscreen where the browser allows it.
- Read PDFs on desktop and mobile. Scanned PDFs without selectable text need OCR before NovelType can read them; NovelType does not perform OCR.

### Typing practice

- Practise with EPUB text and track speed, accuracy, errors, time, and progress.
- Choose **Normal**, **Strict**, or **Zen** mistake handling.
- Turn on Blind typing to hide upcoming text after a short delay.
- Choose soft, mechanical, or typewriter key sounds, or turn sounds off.
- Set a time, word-count, or chapter-completion goal.
- Select a chapter to restart practice at that chapter's beginning.
- Use **Continue** after leaving a session or **Retry** to start it again.

Typing is disabled on phones and other touch-first mobile devices. The app switches to reading and displays a notice if someone tries to select Type mode there.

### Themes and appearance

NovelType includes **Dark**, **Light**, **Vintage book**, and **Nature** themes. The Nature theme uses a forest-inspired green palette. A floating control in Light returns to the previously active theme. The home page uses the split Radiance layout, and the library has its own Shelf/List switch.

### History and backups

History records typing sessions and shows progress statistics, including personal bests and achievements. From History, export a JSON backup or import one to restore the library data, settings, and history on another browser or device. The backup contains extracted book text and metadata; it does not contain the original EPUB or PDF file.

## Getting started

1. Open `index.html` through a web server or the deployed site.
2. Select **Upload EPUB or PDF**, or drop a file into the upload area.
3. Choose a book from the library to open it.
4. For an EPUB, use the **Read/Type** control or change the mode in Settings. PDFs remain read-only.
5. Use Settings to select a theme and adjust reading or typing preferences.

The app is a static website; it has no account or application server. In a local development environment, serve the project directory over HTTP rather than opening the HTML files directly with `file://`.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Tab` | Restart the current typing session |
| `Escape` | Exit Focus mode, or leave the session and view results |
| `Ctrl+Enter` / `⌘+Enter` | Pause or resume typing |
| `Ctrl+K` / `⌘+K` | Search the current book |
| `Alt+↑` / `Alt+↓` | Move to the previous or next chapter |
| `Ctrl+Shift+F` | Toggle Focus mode |
| `Ctrl+Shift+L` | Cycle themes |
| `Ctrl+Backspace` | Delete the previous word during typing |
| Reading: `←` / `→` | Previous or next chapter |
| Reading: `↑` / `↓` | Scroll by a line |
| Reading: `Page Up` / `Page Down` or `Space` | Scroll by a page |
| Reading: `Home` / `End` | Go to the beginning or end of the selected chapter |
| Results: arrow keys, then `Enter` | Move between and choose Continue, Retry, and Library |

Keyboard shortcuts are ignored while a dialog is open or while a form control is being edited.

## Data and privacy

NovelType processes imported books in the browser and does not upload them to an app server. Book metadata, extracted text, bookmarks, and reading progress are stored in IndexedDB. Settings, history, and theme preferences use browser local storage. This data belongs to the current browser profile and does not automatically sync to another browser or device; use the JSON backup for a transfer.

The browser must allow IndexedDB and local storage for the library and progress to persist. Clearing site data or using a browser mode that removes local data can remove saved books and settings.

## Project files

| File or folder | Purpose |
| --- | --- |
| `index.html` | Home page, library, dialogs, settings, and app shell |
| `reader.html` | Reader page opened for a selected library item |
| `app.js` | EPUB/PDF import, reading, typing, library, settings, history, backups, and keyboard controls |
| `style.css` | Layout, responsive behavior, reading surfaces, library designs, and themes |
| `forest.svg` | Forest background artwork used by the Nature theme |
| `vendor/pdfjs/` | Bundled PDF.js runtime and supporting assets for PDF text extraction |
| `PROJECT_LOG.md` | Dated notes about project-file changes |

## Deployment

This project does not require a build step or package installation. Deploy the project directory as a static site, with `index.html` at the site root. Keep `reader.html`, `app.js`, `style.css`, `forest.svg`, and the complete `vendor/pdfjs/` directory in the deployment. The PDF reader tries the bundled PDF.js files first and has a CDN fallback; keeping the bundled folder supports more reliable and offline-friendly PDF reading.

EPUB import loads JSZip from `vendor/jszip.min.js` if present, then tries public CDNs. The current project does not include the local JSZip file, so EPUB import needs the browser to be able to reach one of those CDNs. Web fonts are also loaded from Google Fonts; system fallback fonts are used if they are unavailable.

After deploying, open the site and check that the home page loads, a sample book opens, a PDF with selectable text opens in read-only mode, and reading progress survives a reload in the same browser profile.

## Known limitations

- EPUB files protected with DRM cannot be imported.
- PDFs must contain selectable text; image-only scans are unsupported without prior OCR.
- Files larger than 250 MiB are rejected.
- PDFs are read-only on every platform.
- Typing practice is available only on desktop-class devices.
- Browser storage is local to the current browser profile. A Vercel deployment serves the app files but does not sync a user's library between devices.
