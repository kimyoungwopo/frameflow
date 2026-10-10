# Background project work verification

Date: 2026-10-09

## Behavior

Project workspaces retain their own React state and execution controllers when switching projects. Only the active workspace is attached to the page; background workspaces continue execution and persist their own project metadata and images. Inactive saves do not overwrite the active project pointer. Keyboard shortcuts act only on the visible workspace.

New independent flows can be added during an existing execution. Execution uses the captured graph, while result updates preserve newly added nodes. Running nodes retain their editing lock. A running project cannot be deleted from another workspace.

## Real browser scenario

Used the production build at localhost:4450 with the isolated Bridge fixture in tests/serve-background-qa.cjs. The fixture uses test images and explicit completion of pending jobs; no real account credentials or AI provider requests were used.

1. Created project A and a three-node generation flow, then started execution with the job held pending.
2. Created a second independent flow through the natural-language creation UI in the same project. A had six nodes, the original job stayed pending, and exactly one image request had been sent.
3. Created project B while A was running. Added a separate flow in B. The top bar showed the background project and allowed returning to it.
4. Switched back to A and observed its original progress and both flows. Switched to B and completed the held job.
5. B retained zero results and zero preview images. A showed one result and one preview image, preserving all six nodes.
6. Restarted the isolated web fixture and reloaded A. Its six nodes and one result were restored from persistent storage.
7. Rechecked the final build with a second held job. At 390px, document scroll width was 390px, the background project button was 44px high, and only one request field was attached to the DOM. At 768px, document scroll width was 768px.

Screenshots: desktop.jpg, mobile.jpg, tablet.jpg, completed-original.jpg.

## Automated checks and deployment

Regression tests cover project creation during execution, origin-only result persistence, preserving an independent added flow, navigation during planning without aborting its controller, and blocking deletion of a running background project. Final npm test: 175 passed, 0 failed. Production build and TypeScript checks passed.

The public tunnel remains active. The live web server serves the new workspace bundle and the public URL returns HTTP 200. Deployment required restarting the existing combined web/Bridge launcher, so visitors must reconnect their GPT account once. Stored projects and results remain available.
