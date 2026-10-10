# Individual results in execution folders

User clarification on 2026-10-07: multiple source photos must share one processing graph and one output area, while producing separate result images grouped as a folder in Results.

## Delivered

- Default shared cutout mode is now `each`. The four-node graph has one multi-photo input, common configuration/edit operation and one PREVIEW collection. PREVIEW displays each result as its own thumbnail; it does not create a composite by default.
- Both the multi-photo upload and the multiple-cutout preset use this same shared structure.
- Each full execution creates one result folder per shared input. Every successful photo is saved immediately into its folder. The folder opens to individual PNG cards with separate view/download/reuse controls. Folder names are editable.
- Failed-photo retry keeps the existing folder ID and successful file IDs, then appends/replaces only the corresponding results. Input order is retained even when requests finish out of order. A new full execution creates a new folder even if the image bytes match a previous run.
- Cached individual cutouts can be moved into a folder without another provider request. Existing flat copies are adopted rather than duplicated. Prior composite files remain available as legacy results.
- Folder metadata lives with history entries and PREVIEW metadata, so project storage and portable backup preserve it. Old history folders are retained/evicted as complete groups within the existing image limit.

## Surface verification

- Used the two actual provider-generated bottle/mug PNGs already present in the saved common-flow project; no new image-generation requests were necessary for this correction.
- Selected individual output and saved the cached results to a folder. Confirmed 4 nodes/3 edges, one PREVIEW displaying two distinct images, and Results containing the `제품 누끼 결과` folder with two separate PNG entries.
- Navigated from PREVIEW to its folder and from the folder back to the folder list. Renamed the folder, saved and reloaded; both the name and images survived.
- Checked folder contents at 320/390/768/1280px; document scrollWidth equals viewport width. Individual image cards, folder name input and action buttons remain usable. Console warning/error log empty.
- Extracted each displayed PNG separately as `result-folder-file-1.png` and `result-folder-file-2.png`. Download controls and filename logic are present; native in-app-browser download completion was not part of this verification.

## Checks

- `npm run build`: passed.
- `npm run typecheck`: passed.
- `npm test`: 72 passed, 0 failed after build completion.
- One earlier concurrent build/test run failed the occupied-port startup test because the build temporarily replaced `.next` artifacts. The same suite passed when run after the completed build; no test was skipped or weakened.
- Tests cover default separate output into one folder, same-folder failed-photo retry, preserving successful file IDs, distinct folders for repeated runs, source ordering, complete-folder retention, filename preservation and folder backup metadata.

## Files

- `web/app/result-folders.ts`: grouping, deduplication, retention and names.
- `web/app/results-panel.tsx`: folder list and folder contents.
- `web/app/page.tsx`: execution/cached-result folder association and PREVIEW collection.
- `web/app/shared-flow.ts`, `web/app/studio-groups.ts`, `web/app/image-batch-panel.tsx`, `web/app/group-panel.tsx`: individual default and UI wording.
- `web/app/project-backup.ts`: validated folder metadata.
- `web/app/globals.css`: folder cards and collection preview layout.
- `tests/result-folders.test.cjs`, `tests/workflow.test.cjs`: regression evidence.

Evidence: `result-folders-studio.png`, `result-folders-list.png`, `result-folders-open.png`, `result-folders-320.png`, `result-folders-390.png`, `result-folders-768.png`. The web remains on http://127.0.0.1:4320; no native app or new package dependency was added.
