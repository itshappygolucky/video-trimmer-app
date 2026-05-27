# Changelog

All notable changes to **Video Trimmer Pro** are documented in this file.

## [1.1.0] - 2026-05-27

### Added

- **Keyboard shortcuts** — File menu accelerators (`Ctrl+O`, `Ctrl+Shift+O`, `Ctrl+Enter`) and playback shortcuts (Space, I/O, R, `,` `.`, Shift+arrows)
- **Auto-advance after trim** — Optional setting to load the next clip in the library after a successful export
- **Library search** — Filter folder videos by filename with live match counts
- **Drag and drop** — Drop video files or folders anywhere on the window to load the library

### Changed

- Keyframe shortcuts moved from `[` `]` to `,` `.`

[1.1.0]: https://github.com/itshappygolucky/video-trimmer-app/releases/tag/v1.1.0

## [1.0.0] - 2026-05-27

First public release.

### Added

- **Lossless trimming** — FFmpeg stream copy (`-c copy`) aligned to keyframes; selection is never shortened, only expanded to the nearest valid cut points
- **Visual trim slider** — Draggable start/end handles, playhead, and vertical markers for actual lossless cut points
- **Keyframe navigation** — Previous/next keyframe buttons; Set Start / Set End from the current playhead
- **Folder library** — Open a folder of videos with cached thumbnails for fast multi-clip workflow
- **Open File** — Load a single video (shown in the same library panel)
- **Sorting** — Name (A–Z / Z–A), duration, and file size
- **Playback controls** — External play/pause button; click video to toggle; timeline click seeks; hold-drag scrubs the playhead
- **Timeline tooltip** — Hover shows time in seconds
- **Cut times in filenames** — Default save name includes start/end times (`name HH.MM.SS - HH.MM.SS.ext`); optional toggle in Settings
- **Delete videos** — Remove from library with confirmation; files go to the Recycle Bin (toggle in Settings)
- **Settings menu** — Remember last opened folder, append cut times to filename, show delete option
- **Native menu bar** — File, Edit, View, Settings, and Window menus (replacing in-app settings UI)
- **Apple-inspired UI** — Light neutral theme, rounded panels, centered control toolbar, uniform video cards with larger metadata
- **Duration display** — `hh:mm:ss` format in the library and file info
- **Windows installer** — NSIS setup via `electron-builder` (`npm run build-win`)

### Changed

- Opening a folder no longer replaces the currently loaded video unless none is loaded
- Removed post-trim “load trimmed video?” prompt
- Removed Preview Selection button; Open File and Open Folder are separate actions
- Native video controls hidden in favor of custom playback UI

### Requirements

- [FFmpeg](https://ffmpeg.org/) and FFprobe on your system PATH (not bundled with the app)

### Notes

- Trimming is lossless and keyframe-bound; exact in/out times may differ slightly from the selection
- Windows builds may require Developer Mode or disabled code signing for local `npm run build-win` on some machines

[1.0.0]: https://github.com/itshappygolucky/video-trimmer-app/releases/tag/v1.0.0
