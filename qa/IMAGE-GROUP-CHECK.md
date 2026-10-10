# Image execution and grouping verification

Verified 2026-10-07 on http://127.0.0.1:4320 using the existing authenticated image provider.

## Actual browser workflow

- Created a synthetic 768 × 768 product illustration (`group-test-source.svg`, rasterized to PNG).
- Found an actual upload interaction bug: node pointer capture intercepted clicks on the upload label. Excluded labels from the node drag handler. Before the fix, file chooser waits timed out; after rebuild/restart, the same label immediately opened the chooser and the image appeared in IMAGE INPUT.
- Uploaded the image through the browser file chooser into the existing GPT-created warm/cool workflow, then clicked selected workflow execution.
- The seven-node, six-edge graph completed. Both PREVIEW nodes produced results, and Results showed two images. Visually inspected the cool and warm variants: bottle silhouette, label, cap, background boundary and composition remained recognizable; color temperature changed.
- Evidence: `image-group-web-results.png`. Browser left on Results with both images saved in the current GPT flow project.

## Execution and grouping boundaries

- Separate direct engine/API verification made two real edit requests, both HTTP 200. Each branch received the original PNG, not the preceding branch result. Outputs: `group-result-warm.png`, `group-result-cool.png`; evidence metadata: `IMAGE-GROUP-CHECK.json`.
- `workflowGroups` assertions verified two disconnected chains produce two execution groups, selecting a node scopes execution to one chain, and selecting a node in a shared-input branch includes both branches in the same seven-node group.
- Independent chains can represent multiple input images, but this run used one actual image with two variants. It did not run multiple distinct uploaded photos or BLEND.
- No user-defined group boxes, group names, collapse/expand, multi-selection, or group movement exist. Natural language planning only emits the supported graph node types; GROUP is not a supported node type.

## Checks

- `npm test`: 44 passed, 0 failed.
- Added and ran `node --test tests/upload-pointer.test.cjs`: 1 passed, verifying upload label bypasses pointer capture and node body remains draggable.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- No native application was built. Updated web server is running on port 4320.

`node qa/run-image-group-check.cjs` performs real image requests using the local server and existing account; rerunning consumes provider usage.
