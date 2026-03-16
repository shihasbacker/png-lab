# PNG Lab

PNG Lab is a browser-only image converter with a dark, studio-style interface.

Drop in a raster image or SVG, preview it locally, and export it as a PNG without sending anything to a server.

## Features

- Convert images and SVGs to PNG
- Local-first processing in the browser
- Drag-and-drop upload and file picker support
- Source preview and metadata readout
- Dark editorial-style UI

## Supported input formats

- PNG
- JPG / JPEG
- WebP
- GIF
- BMP
- AVIF
- SVG

## Tech stack

- React
- Vite
- TypeScript
- `npm` workspaces

## Project structure

```text
apps/
  web/
packages/
  image-core/
  ui/
```

## Getting started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Security model

- Files stay in the browser and are not uploaded
- Unsafe SVG patterns are blocked
- File-size and image-dimension limits are enforced

## Notes

- No backend is required for the current feature set
- The app is designed for static hosting
