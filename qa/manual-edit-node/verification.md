# Manual image edit node verification

Date: 2026-10-09

- Added a manual image edit node through the real node palette at localhost:4310. Adding it opens the configuration tab and exposes the image edit instruction field.
- Entered edit instructions, a custom node name, and a display description. The canvas updated immediately.
- Saved and reloaded the project, then selected the node: all three values were preserved. Reopening the saved project also preserved the values.
- Desktop screenshot: desktop.jpg. Mobile screenshot: mobile.jpg.
- At a 390px viewport, document width and scroll width were both 390px. All three inputs used 16px text, with control heights of 150px, 49.6px, and 88px.
- Engine regression tests reproduced three failures before the fix: local edit instructions were rejected or ignored, and local cutout commands could not request transparent output.
- Tests now cover direct instructions with no project request, combining upstream instructions, consuming instructions only at their stage, transparent output, separating display metadata from instructions, and the page execution request payload.
- npm test: 163 passed, 0 failed. Production build, including TypeScript checks, passed.
- No live AI image generation was triggered in this verification. Request payload behavior was tested through the existing workflow runner harness.
- Public Cloudflare URL returned HTTP 200. Bridge process and account sessions were preserved.
