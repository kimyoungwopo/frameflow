# Multiple-image cutout and groups

Verified on 2026-10-07 against the real web server at http://127.0.0.1:4320.

## Delivered behavior

- Multi-file PNG/JPEG/WebP chooser and drop area, up to 12 files per batch and 32MB per file. Inputs optimized to at most 2048px.
- Each file receives its own IMAGE INPUT → COMMAND(/REMOVEBG with preservation instructions) → EDIT → PREVIEW chain. Appends a named group without replacing existing work.
- Bounded concurrency of two independent chains. Dependencies inside a chain remain sequential. Each photo has waiting/running/done/error feedback.
- Ordinary per-photo errors keep successful previews/history and continue queued photos. Authentication or rate-limit failures abort peers and stop queued requests. Cancellation waits for in-flight operations to settle before releasing the execution lock. Failed/cancelled photos can be explicitly retried without rerunning successful chains.
- Manual checkbox selection groups complete connected chains. Group name editing, selection, execution, ungrouping and header drag movement. Cross-group edges require ungrouping first. Groups and coordinates persist in project storage and image-inclusive JSON backups. Invalid/dangling/partial group membership is rejected on backup import.
- History retains 60 results; node previews also persist. Transparent images display over a checkerboard.

## Actual browser and provider evidence

1. Created the separate project `여러 이미지 누끼`. Uploaded synthetic bottle `group-test-source.png` and mug `batch-test-mug.png` together through the actual multiple file chooser.
2. Eight nodes and six edges were created in one group. Renamed it `제품 2장 누끼`, then clicked Group Run. Both task rows displayed processing simultaneously; both completed and Results contained two images. No mock provider was used.
3. Extracted complete PNGs from the displayed PREVIEW images and inspected them visually. Both preserve the recognizable original object and remove the background. AI output includes slight edge/color differences and the mug has minor fringe/speck artifacts; pixel-perfect segmentation is not guaranteed.
4. Both outputs are 1254 × 1254 with actual alpha. Bottle: 1,067,220 fully transparent pixels. Mug: 1,037,527 fully transparent pixels. All four corner alpha values are zero for each output.
5. Dragged the group header 40px right and 20px down at 70% zoom. All eight nodes moved by 57.143/28.571 canvas units with relative offsets unchanged. Reload restored the group name, all positions and both input/preview images.
6. Exported JSON to `/path/to/downloads/studio-project.json`; inspected its group metadata, eight nodes and two results, then imported it through the real backup chooser. The restored project retained all nodes, edges, groups and results. Saved it separately as `누끼 그룹 백업 검증` after verifying ungrouping preserves the graph and manually selecting two image nodes regroups all eight connected nodes.
7. Final build checked at 320/390/768px: document scrollWidth equals viewport width. Desktop Studio and Results inspected. Console warning/error log empty. Final UI left on the original cutout project.

## Verification

- `npm test`: 53 passed, 0 failed. Includes bounded concurrency, queue/cancel behavior, fatal auth abort, partial failure preservation, per-source transparency, group backup validation, group execution scope, and retry scope.
- `npm run typecheck`: passed.
- `npm run build`: passed after final production changes.
- Self-review: no new dependencies, no native build, no silent automatic retries, original input retained for each independent cutout, and prior projects preserved.

## Evidence files

- `batch-cutout-running.png`: two photo task rows processing.
- `batch-cutout-studio.png`: final grouped graph with both transparent previews.
- `batch-cutout-results.png`: two final results with checkerboard backgrounds.
- `batch-cutout-320.png`, `batch-cutout-390.png`, `batch-cutout-768.png`: final responsive captures.
- `batch-cutout-1.png`, `batch-cutout-2.png`: actual provider outputs, bottle and mug respectively.

Live verification covered two distinct images. Twelve-image queue limits, errors, cancellation and retry were verified through meaningful deterministic tests rather than twelve additional provider requests. Group collapse/expand and ZIP result export are not implemented.
