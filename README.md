# Video Trimmer Pro

Lossless video trimming desktop app built with Electron. Trims at keyframe boundaries using FFmpeg stream copy (no re-encode).

## Requirements

- [Node.js](https://nodejs.org/)
- [FFmpeg](https://ffmpeg.org/) and FFprobe on your PATH

## Development

```bash
npm install
npm start
```

## Build (Windows)

```bash
npm run build-win
```

Installer output is written to `dist/`.

## Features

- Lossless trim (keyframe-aligned, selection never shortened)
- Folder library with thumbnails and sorting
- Visual trim slider with keyframe navigation
- Optional cut times in saved filenames
- Delete videos to Recycle Bin (toggle in Settings)

## License

MIT
