# Shared multi-image workflow

Historical record: the default single-sheet output described here was corrected to separate PNG outputs grouped in Results folders after the user's clarification. See `RESULT-FOLDERS.md` for the current behavior and verification.

Verified 2026-10-07 against http://127.0.0.1:4320 with the existing authenticated real provider. No native app or new dependency was added.

## Changes

- Multiple photos occupy one IMAGE INPUT collection and use one visible graph. Default cutout graph stays at four nodes and three edges for 1–12 photos.
- Output mode defaults to one transparent PNG contact sheet, preserving input order and aspect ratio. Separate image output is selectable. Sheet composition uses browser canvas with no additional provider request; it arranges completed cutouts in a grid rather than creating a new AI scene.
- Per-photo tasks still run independently with two-worker concurrency. Failed-photo retry reuses successful cached outputs, then creates the complete sheet. A SHA-256 fingerprint of processing instructions, topology and source images prevents mixing stale results after input/prompt changes. Layout and output-mode changes do not invalidate results.
- Append/remove photos within an existing input; nodes do not multiply. PREVIEW stores per-photo results and exposes individual thumbnails/fullscreen viewing in addition to the final combined image.
- Compatible one-input-to-one-input GPT replanning retains uploaded photos and output mode. Other plan structures are not automatically mapped.
- Existing matching basic cutout groups can be converted without new image requests, retaining completed cutouts and prior history. Modified/nonmatching graphs are rejected instead of silently discarding custom work.
- Input arrays, per-photo results and signatures persist in project image storage. Large image strings are stripped from localStorage metadata and stored in scoped IndexedDB records. Portable backup validation accepts the new arrays and rejects external URLs, duplicate photo IDs and unknown modes.
- Canvas fit computes zoom/pan from node bounds. Wide sheet thumbnails use contain instead of cropping off subjects.

## Real surface evidence

1. Backed up the existing legacy project before converting its two matching cutout chains from 8 nodes to 4. Conversion reused its two completed images, produced a sheet, and retained previous individual history. Pre-conversion download: `/path/to/downloads/studio-project.json`.
2. Created `공통 누끼 · 결과 한 장`. Uploaded synthetic bottle and mug PNGs together through the real multiple file chooser. One input held two photos; graph had 4 nodes/3 edges.
3. Clicked Group Run. Both photo rows showed processing at once. The real provider completed both, one PREVIEW displayed the combined sheet, and Results initially contained exactly one result.
4. Actual output `shared-flow-sheet.png`: 2048 × 1024 PNG, alpha channel present, 1,543,231 fully transparent pixels, inspected corners alpha zero. Both subjects visible. The AI-generated mug cutout retains minor edge/speck artifacts; pixel-perfect source preservation is not guaranteed.
5. Saved/reloaded: restored both source images, both cached cutouts, shared graph and final sheet. Added a third input and confirmed node count remained four; removed it and returned to the original two inputs.
6. Switched to separate output and saved the two cached cutouts without calling image execution. Switched back to sheet and recomposed without image execution. History now contains the sheet plus those two explicitly saved individual results; a run in sheet mode still produces one final output.
7. Opened the mug's cached thumbnail in the real fullscreen viewer. Canvas Fit displayed all four nodes. At 320/390/768 widths, document scrollWidth equals viewport width; fields/buttons were visually inspected. Console warning/error log empty.

## Validation

- Automated suite covers 12-photo/four-node topology; source isolation; signature invalidation; unique task IDs across imported collections; scoped image record round-trip; portable array validation; transparent canvas layout; one-result page integration; partial failure + cached retry; stale-cache refusal before any provider call; and compatible GPT input preservation.
- `npm test`: 63 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run build`: passed after final production changes.
- New-array backup parser and image storage round-trips were tested programmatically. A new collection export was clicked in the in-app browser, but a resulting native download file was not observed, so that native export/download path is not claimed verified for the new arrays.

## Artifacts

- `shared-flow-studio.png`: final four-node graph and batch controls.
- `shared-flow-sheet.png`: actual combined transparent output.
- `shared-flow-running.png`: two tasks processing on the common graph.
- `shared-flow-320.png`, `shared-flow-390.png`, `shared-flow-768.png`: final responsive captures.

The final web server remains on port 4320, and the browser is left on the saved common-flow project in sheet mode. Twelve-photo execution and failure/retry paths use deterministic tests; the live run used two actual photos. Creative AI scene composition continues to use BLEND; this sheet option performs deterministic arrangement.
