# Jev-guided motion pipeline decision

## Evidence

- Provider responses previously included multiple poses, labels, and frame numbers.
- Local pixel edits of eyes, ears, and paws changed the source raster into vector-like geometric shapes.
- Transparent moving frames require GIF disposal mode 2 to prevent previous-frame accumulation.

## Jev judgment

- Model: `jev-1.13.0`
- `provider_per_frame`: probability 1.0, confidence 1.0
- Reject local redraw: 0.98
- Gate every frame before GIF encoding: 0.93

## Decision

Use the original image as a provider reference and request one full-canvas pose per provider call. Do not redraw anatomy locally. Gate every returned frame for one character, no labels/sheets/bleed, fixed canvas/anchor, and source-raster style preservation before encoding. Use GIF disposal mode 2.

## Current implementation changes

- Motion prompt no longer exposes `frame N of M` labels and explicitly forbids vector/geometric repainting.
- Browser GIF encoder uses `dispose: 2`.

A provider end-to-end result is not claimed until the running workspace is restarted safely, authenticated, and the returned GIF is decoded and visually checked.
