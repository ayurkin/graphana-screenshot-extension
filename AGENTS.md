# Repository Guidelines

## Project Structure & Module Organization
- `manifest.json` defines permissions, entry points, and the popup. Keep version and permission changes intentional.
- `background/service-worker.js` manages context menu wiring and downloads.
- `content/content.js` + `content/content.css` inject overlay logic for detecting and capturing Grafana panels; `lib/html2canvas.min.js` is the only third-party script and is loaded on demand.
- `popup/popup.html|css|js` renders the panel picker UI and coordinates capture requests.
- `icons/` holds browser action icons. Add new sizes here if needed.

## Build, Test, and Development Commands
- No build step or package manager is used; edit the files directly.
- Load locally in Chromium-based browsers via `chrome://extensions` → Developer Mode → “Load unpacked” and select the repository root.
- To ship a packaged build, run `zip -r grafana-panel-screenshot.zip background content icons lib popup manifest.json` from the repo root and upload the archive.
- Use the extension’s reload button in `chrome://extensions` after code changes.

## Coding Style & Naming Conventions
- Use 2-space indentation, semicolons, `const`/`let`, and arrow functions where practical; keep `'use strict'` for content scripts.
- Keep filenames lowercase with hyphens (e.g., `service-worker.js`, `content.css`); prefer descriptive variable names tied to Grafana concepts (`panelId`, `dashboard`).
- Avoid introducing new global state; keep state local to modules and guard DOM queries with null checks.

## Testing Guidelines
- There are no automated tests; rely on manual verification in a Grafana dashboard.
- Verify: panels are detected in both modern (`data-panelid`) and legacy (`.panel-container`) layouts; selection overlays track scroll/resize; screenshots download with sanitized filenames; overlay hides during capture.
- Confirm behavior on at least one recent Chrome/Edge build and that permissions prompts are expected.

## Commit & Pull Request Guidelines
- Current history uses short, imperative subjects (e.g., `init`); follow that style and keep scope focused.
- In PRs include: brief summary, list of browsers tested, Grafana version(s) exercised, and screenshots/GIFs of the popup and selection overlay.
- Call out any permission changes or dependency updates (e.g., replacing `html2canvas`) and why they are needed.

## Security & Configuration Tips
- The extension declares `<all_urls>` host access; avoid adding new permissions or remote calls unless essential, and document why.
- Sanitize any user-facing text used in filenames or UI; continue to keep downloads local-only with `chrome.downloads`.
- If adding libraries, prefer pinned vendored files in `lib/` and avoid dynamic `eval` or remote imports.
