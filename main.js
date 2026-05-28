const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow;
let saveWindowStateTimeout = null;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const DEFAULT_WINDOW_BOUNDS = {
    width: 1440,
    height: 800
};

function getWindowStatePath() {
    return path.join(app.getPath('userData'), 'window-state.json');
}

function isBoundsOnScreen(bounds) {
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
        return false;
    }

    return screen.getAllDisplays().some((display) => {
        const area = display.workArea ?? display.bounds;
        const right = bounds.x + bounds.width;
        const bottom = bounds.y + bounds.height;

        return (
            bounds.x < area.x + area.width
            && right > area.x
            && bounds.y < area.y + area.height
            && bottom > area.y
        );
    });
}

function loadWindowState() {
    try {
        const savedState = JSON.parse(fs.readFileSync(getWindowStatePath(), 'utf8'));
        const width = Number(savedState.width);
        const height = Number(savedState.height);
        const x = Number(savedState.x);
        const y = Number(savedState.y);
        const bounds = {
            width: Number.isFinite(width) && width >= 960 ? width : DEFAULT_WINDOW_BOUNDS.width,
            height: Number.isFinite(height) && height >= 600 ? height : DEFAULT_WINDOW_BOUNDS.height
        };

        if (Number.isFinite(x) && Number.isFinite(y)) {
            bounds.x = x;
            bounds.y = y;
        }

        const validatedBounds = isBoundsOnScreen(bounds)
            ? bounds
            : {
                width: bounds.width,
                height: bounds.height
            };

        return {
            bounds: validatedBounds,
            isMaximized: Boolean(savedState.isMaximized)
        };
    } catch (error) {
        return {
            bounds: { ...DEFAULT_WINDOW_BOUNDS },
            isMaximized: false
        };
    }
}

function saveWindowState() {
    if (!mainWindow) {
        return;
    }

    try {
        const isMaximized = mainWindow.isMaximized();
        const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();

        fs.writeFileSync(getWindowStatePath(), JSON.stringify({
            ...bounds,
            isMaximized
        }));
    } catch (error) {
        console.error('Could not save window state:', error);
    }
}

function scheduleWindowStateSave() {
    clearTimeout(saveWindowStateTimeout);
    saveWindowStateTimeout = setTimeout(saveWindowState, 400);
}
let menuSettings = {
    appendCutTimes: true,
    rememberLastFolder: false,
    showDeleteOption: true,
    autoAdvance: false,
    darkMode: false,
    autoSaveEnabled: false,
    autoSaveFolder: '',
    promptDeleteSourceAfterTrim: false,
    showNotifications: false
};

async function chooseAutoSaveFolder() {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose Auto-Save Folder',
        defaultPath: menuSettings.autoSaveFolder || undefined
    });

    if (result.canceled || !result.filePaths.length) {
        return null;
    }

    const folderPath = result.filePaths[0];
    menuSettings.autoSaveFolder = folderPath;
    mainWindow?.webContents.send('menu-setting-changed', {
        key: 'autoSaveFolder',
        value: folderPath
    });
    buildApplicationMenu();
    return folderPath;
}

function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
                return;
            }

            resolve({ stdout, stderr });
        });
    });
}

async function getVideoInfo(inputPath) {
    const { stdout } = await runCommand('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-skip_frame', 'nokey',
        '-show_entries', 'frame=best_effort_timestamp_time,pkt_pts_time,pts_time:format=duration',
        '-of', 'json',
        inputPath
    ]);

    const result = JSON.parse(stdout);
    const keyframes = (result.frames || [])
        .map((frame) => Number(
            frame.best_effort_timestamp_time ??
            frame.pkt_pts_time ??
            frame.pts_time
        ))
        .filter((time) => Number.isFinite(time) && time >= 0)
        .sort((a, b) => a - b);

    if (!keyframes.includes(0)) {
        keyframes.unshift(0);
    }

    return {
        duration: Number(result.format?.duration),
        keyframes: [...new Set(keyframes)]
    };
}

function findLosslessBounds(keyframes, start, end, sourceDuration) {
    let losslessStart = 0;
    let losslessEnd = Number.isFinite(sourceDuration) && sourceDuration >= end
        ? sourceDuration
        : end;

    for (const keyframe of keyframes) {
        if (keyframe <= start) {
            losslessStart = keyframe;
        }

        if (keyframe >= end) {
            losslessEnd = keyframe;
            break;
        }
    }

    return { losslessStart, losslessEnd };
}

function getVideoFileInfo(filePath) {
    const stats = fs.statSync(filePath);

    return {
        path: filePath,
        name: path.basename(filePath),
        size: stats.size
    };
}

function getInputCacheKey(inputPath) {
    const stats = fs.statSync(inputPath);

    return crypto
        .createHash('sha1')
        .update(`${inputPath}:${stats.size}:${stats.mtimeMs}`)
        .digest('hex');
}

function getPlaybackCachePath(inputPath) {
    const cacheDir = path.join(app.getPath('userData'), 'playback-cache');

    return path.join(cacheDir, `${getInputCacheKey(inputPath)}.mp4`);
}

async function getAudioTracks(inputPath) {
    try {
        const { stdout } = await runCommand('ffprobe', [
            '-v', 'error',
            '-show_entries', 'stream=index,codec_name,codec_type,channels:stream_tags=language,title',
            '-select_streams', 'a',
            '-of', 'json',
            inputPath
        ]);
        const result = JSON.parse(stdout);

        return (result.streams || [])
            .filter((stream) => stream.codec_type === 'audio')
            .map((stream, trackNumber) => ({
                index: Number(stream.index),
                trackNumber: trackNumber + 1,
                codec: stream.codec_name || 'unknown',
                channels: Number(stream.channels) || null,
                language: stream.tags?.language || '',
                title: stream.tags?.title || stream.tags?.handler_name || ''
            }))
            .filter((stream) => Number.isFinite(stream.index));
    } catch (error) {
        console.error('Could not read audio tracks:', error);
        return [];
    }
}

async function getVideoStreamIndex(inputPath) {
    try {
        const { stdout } = await runCommand('ffprobe', [
            '-v', 'error',
            '-show_entries', 'stream=index,codec_type',
            '-select_streams', 'v',
            '-of', 'json',
            inputPath
        ]);
        const result = JSON.parse(stdout);
        const videoStream = (result.streams || []).find((stream) => stream.codec_type === 'video');

        return Number.isFinite(Number(videoStream?.index)) ? Number(videoStream.index) : 0;
    } catch (error) {
        console.error('Could not read video stream index:', error);
        return 0;
    }
}

async function ensurePlaybackVideo(inputPath, audioTracks, videoStreamIndex) {
    if (audioTracks.length <= 1) {
        return inputPath;
    }

    const cacheDir = path.join(app.getPath('userData'), 'playback-cache');
    const playbackPath = getPlaybackCachePath(inputPath);
    const firstAudioIndex = audioTracks[0].index;

    fs.mkdirSync(cacheDir, { recursive: true });

    if (fs.existsSync(playbackPath)) {
        return playbackPath;
    }

    await runCommand('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-map', `0:${videoStreamIndex}`,
        '-map', `0:${firstAudioIndex}`,
        '-c', 'copy',
        playbackPath
    ]);

    return fs.existsSync(playbackPath) ? playbackPath : inputPath;
}

async function getPlaybackSource(inputPath) {
    const audioTracks = await getAudioTracks(inputPath);
    const videoStreamIndex = await getVideoStreamIndex(inputPath);
    const playbackPath = await ensurePlaybackVideo(inputPath, audioTracks, videoStreamIndex);

    return {
        playbackPath,
        audioTracks,
        videoStreamIndex
    };
}

function buildTrimStreamMaps(videoStreamIndex, audioStreamIndexes) {
    const maps = ['-map', `0:${videoStreamIndex}`];

    for (const streamIndex of audioStreamIndexes) {
        maps.push('-map', `0:${streamIndex}`);
    }

    return maps;
}

async function getVideoDuration(inputPath) {
    try {
        const { stdout } = await runCommand('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'json',
            inputPath
        ]);
        const result = JSON.parse(stdout);

        return Number(result.format?.duration);
    } catch (error) {
        console.error('Could not read video duration:', error);
        return null;
    }
}

async function generateThumbnail(inputPath) {
    const stats = fs.statSync(inputPath);
    const cacheDir = path.join(app.getPath('userData'), 'thumbnail-cache');
    const hash = crypto
        .createHash('sha1')
        .update(`${inputPath}:${stats.size}:${stats.mtimeMs}`)
        .digest('hex');
    const thumbnailPath = path.join(cacheDir, `${hash}.jpg`);

    fs.mkdirSync(cacheDir, { recursive: true });

    if (fs.existsSync(thumbnailPath)) {
        return thumbnailPath;
    }

    try {
        await runCommand('ffmpeg', [
            '-y',
            '-ss', '1',
            '-i', inputPath,
            '-frames:v', '1',
            '-vf', 'scale=360:-1',
            '-q:v', '5',
            thumbnailPath
        ]);
    } catch (error) {
        try {
            await runCommand('ffmpeg', [
                '-y',
                '-i', inputPath,
                '-frames:v', '1',
                '-vf', 'scale=360:-1',
                '-q:v', '5',
                thumbnailPath
            ]);
        } catch (fallbackError) {
            console.error('Could not generate thumbnail:', fallbackError);
            return null;
        }
    }

    return fs.existsSync(thumbnailPath) ? thumbnailPath : null;
}

async function buildVideoEntry(videoPath) {
    const fileInfo = getVideoFileInfo(videoPath);

    return {
        ...fileInfo,
        duration: await getVideoDuration(videoPath),
        thumbnailPath: await generateThumbnail(videoPath)
    };
}

async function getFolderVideos(folderPath) {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const videoPaths = entries
        .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => path.join(folderPath, entry.name))
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    const videos = [];

    for (const videoPath of videoPaths) {
        videos.push(await buildVideoEntry(videoPath));
    }

    return {
        folderPath,
        videos
    };
}

async function getVideosFromDroppedPaths(paths) {
    const directories = [];
    const files = [];

    for (const droppedPath of paths) {
        if (!droppedPath || !fs.existsSync(droppedPath)) {
            continue;
        }

        const stats = fs.statSync(droppedPath);

        if (stats.isDirectory()) {
            directories.push(droppedPath);
        } else if (VIDEO_EXTENSIONS.has(path.extname(droppedPath).toLowerCase())) {
            files.push(droppedPath);
        }
    }

    if (directories.length === 1 && files.length === 0) {
        return getFolderVideos(directories[0]);
    }

    const videos = [];
    const seenPaths = new Set();

    for (const directoryPath of directories) {
        const folderResult = await getFolderVideos(directoryPath);

        for (const video of folderResult.videos) {
            if (!seenPaths.has(video.path)) {
                seenPaths.add(video.path);
                videos.push(video);
            }
        }
    }

    for (const filePath of files) {
        if (seenPaths.has(filePath)) {
            continue;
        }

        seenPaths.add(filePath);
        videos.push(await buildVideoEntry(filePath));
    }

    videos.sort((a, b) => a.name.localeCompare(b.name));

    let folderPath = null;

    if (directories.length === 1 && files.length === 0) {
        folderPath = directories[0];
    } else if (directories.length === 1) {
        folderPath = directories[0];
    } else if (files.length === 1 && directories.length === 0) {
        folderPath = null;
    } else if (files.length > 0) {
        const parentDirs = new Set(files.map((filePath) => path.dirname(filePath)));

        folderPath = parentDirs.size === 1 ? [...parentDirs][0] : null;
    }

    return {
        folderPath,
        videos
    };
}

function sendShortcut(action) {
    mainWindow?.webContents.send('shortcut', action);
}

function buildApplicationMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open File',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => sendShortcut('open-file')
                },
                {
                    label: 'Open Folder',
                    accelerator: 'CmdOrCtrl+Shift+O',
                    click: () => sendShortcut('open-folder')
                },
                { type: 'separator' },
                {
                    label: 'Trim and Save',
                    accelerator: 'CmdOrCtrl+Enter',
                    click: () => sendShortcut('trim')
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Playback',
            submenu: [
                {
                    label: 'Play / Pause (Space)',
                    click: () => sendShortcut('play-pause')
                },
                { type: 'separator' },
                {
                    label: 'Set Start (I)',
                    click: () => sendShortcut('set-start')
                },
                {
                    label: 'Set End (O)',
                    click: () => sendShortcut('set-end')
                },
                {
                    label: 'Reset Trim (R)',
                    click: () => sendShortcut('reset')
                },
                { type: 'separator' },
                {
                    label: 'Previous Keyframe (,)',
                    click: () => sendShortcut('prev-keyframe')
                },
                {
                    label: 'Next Keyframe (.)',
                    click: () => sendShortcut('next-keyframe')
                },
                { type: 'separator' },
                {
                    label: 'Seek Back 1 Second (Shift+Left)',
                    click: () => sendShortcut('seek-back')
                },
                {
                    label: 'Seek Forward 1 Second (Shift+Right)',
                    click: () => sendShortcut('seek-forward')
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Settings',
            submenu: [
                {
                    label: 'Remember Last Opened Folder',
                    type: 'checkbox',
                    checked: menuSettings.rememberLastFolder,
                    click: (menuItem) => {
                        menuSettings.rememberLastFolder = menuItem.checked;
                        mainWindow?.webContents.send('menu-setting-changed', {
                            key: 'rememberLastFolder',
                            value: menuItem.checked
                        });
                    }
                },
                {
                    label: 'Add Cut Times to Saved Filename',
                    type: 'checkbox',
                    checked: menuSettings.appendCutTimes,
                    click: (menuItem) => {
                        menuSettings.appendCutTimes = menuItem.checked;
                        mainWindow?.webContents.send('menu-setting-changed', {
                            key: 'appendCutTimes',
                            value: menuItem.checked
                        });
                    }
                },
                {
                    label: 'Show Delete Video Option',
                    type: 'checkbox',
                    checked: menuSettings.showDeleteOption,
                    click: (menuItem) => {
                        menuSettings.showDeleteOption = menuItem.checked;
                        mainWindow?.webContents.send('menu-setting-changed', {
                            key: 'showDeleteOption',
                            value: menuItem.checked
                        });
                    }
                },
                {
                    label: 'Auto-Advance After Trim',
                    type: 'checkbox',
                    checked: menuSettings.autoAdvance,
                    click: (menuItem) => {
                        menuSettings.autoAdvance = menuItem.checked;
                        mainWindow?.webContents.send('menu-setting-changed', {
                            key: 'autoAdvance',
                            value: menuItem.checked
                        });
                    }
                },
                {
                    label: 'Auto-Save Trims to Folder',
                    type: 'checkbox',
                    checked: menuSettings.autoSaveEnabled,
                    click: async (menuItem) => {
                        if (menuItem.checked && !menuSettings.autoSaveFolder) {
                            const folderPath = await chooseAutoSaveFolder();

                            if (!folderPath) {
                                menuItem.checked = false;
                                return;
                            }
                        }

                        menuSettings.autoSaveEnabled = menuItem.checked;
                        mainWindow?.webContents.send('menu-setting-changed', {
                            key: 'autoSaveEnabled',
                            value: menuItem.checked
                        });
                        buildApplicationMenu();
                    }
                },
                {
                    label: 'Choose Auto-Save Folder...',
                    enabled: menuSettings.autoSaveEnabled,
                    click: () => chooseAutoSaveFolder()
                },
                {
                    label: 'Ask to Delete Original After Trim',
                    type: 'checkbox',
                    checked: menuSettings.promptDeleteSourceAfterTrim,
                    click: (menuItem) => {
                        menuSettings.promptDeleteSourceAfterTrim = menuItem.checked;
                        mainWindow?.webContents.send('menu-setting-changed', {
                            key: 'promptDeleteSourceAfterTrim',
                            value: menuItem.checked
                        });
                    }
                },
                {
                    label: 'Show Notifications',
                    type: 'checkbox',
                    checked: menuSettings.showNotifications,
                    click: (menuItem) => {
                        menuSettings.showNotifications = menuItem.checked;
                        mainWindow?.webContents.send('menu-setting-changed', {
                            key: 'showNotifications',
                            value: menuItem.checked
                        });
                    }
                },
                { type: 'separator' },
                {
                    label: 'Dark Mode',
                    type: 'checkbox',
                    checked: menuSettings.darkMode,
                    click: (menuItem) => {
                        menuSettings.darkMode = menuItem.checked;
                        mainWindow?.webContents.send('menu-setting-changed', {
                            key: 'darkMode',
                            value: menuItem.checked
                        });
                    }
                }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'close' }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
    const { bounds, isMaximized } = loadWindowState();

    mainWindow = new BrowserWindow({
        ...bounds,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'assets', 'icon.png'),
        title: 'Video Trimmer Pro'
    });

    if (isMaximized) {
        mainWindow.maximize();
    }

    mainWindow.on('resize', scheduleWindowStateSave);
    mainWindow.on('move', scheduleWindowStateSave);
    mainWindow.on('close', saveWindowState);

    mainWindow.loadFile('index.html');

    // Open DevTools for debugging (optional)
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    buildApplicationMenu();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle file selection
ipcMain.handle('select-video', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }
        ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return getVideoFileInfo(result.filePaths[0]);
    }
    return null;
});

// Handle folder selection and thumbnail-backed video listing
ipcMain.handle('select-video-folder', async (event, folderPath) => {
    if (folderPath) {
        return getFolderVideos(folderPath);
    }

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Video Folder'
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return getFolderVideos(result.filePaths[0]);
    }

    return null;
});

ipcMain.handle('handle-dropped-paths', async (event, paths) => {
    if (!Array.isArray(paths) || paths.length === 0) {
        return null;
    }

    return getVideosFromDroppedPaths(paths);
});

ipcMain.handle('confirm-delete-source', async (event, filePath) => {
    if (typeof filePath !== 'string') {
        throw new Error('Invalid video path');
    }

    const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Keep Original', 'Move to Recycle Bin'],
        defaultId: 0,
        cancelId: 0,
        title: 'Delete Original Video?',
        message: `Delete the original "${path.basename(filePath)}"?`,
        detail: 'Your trimmed clip was saved successfully. The original file is larger and will be moved to the Recycle Bin.'
    });

    return { confirmed: result.response === 1 };
});

ipcMain.handle('delete-video', async (event, filePath) => {
    if (typeof filePath !== 'string') {
        throw new Error('Invalid video path');
    }

    if (!fs.existsSync(filePath)) {
        throw new Error('Video file no longer exists');
    }

    const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Move to Recycle Bin'],
        defaultId: 0,
        cancelId: 0,
        title: 'Delete Video',
        message: `Delete "${path.basename(filePath)}"?`,
        detail: 'This will move the video file to the Recycle Bin.'
    });

    if (result.response !== 1) {
        return { deleted: false };
    }

    await shell.trashItem(filePath);
    return { deleted: true, path: filePath };
});

ipcMain.on('settings-state', (event, settings) => {
    menuSettings = {
        ...menuSettings,
        ...settings
    };
    buildApplicationMenu();
});

// Provide source duration and keyframes for the visual lossless trim slider
ipcMain.handle('get-video-info', async (event, inputPath) => {
    return getVideoInfo(inputPath);
});

ipcMain.handle('get-playback-source', async (event, inputPath) => {
    return getPlaybackSource(inputPath);
});

// Handle lossless trimming
ipcMain.handle('trim-video', async (event, data) => {
    const { inputPath, startTime, endTime, outputPath, audioStreamIndexes, videoStreamIndex } = data;

    const start = Number(startTime);
    const end = Number(endTime);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error('Invalid trim times');
    }

    try {
        const { duration: sourceDuration, keyframes } = await getVideoInfo(inputPath);
        const { losslessStart, losslessEnd } = findLosslessBounds(keyframes, start, end, sourceDuration);
        const duration = losslessEnd - losslessStart;

        if (duration <= 0) {
            throw new Error('Could not find valid lossless trim points');
        }

        const resolvedVideoStreamIndex = Number.isFinite(Number(videoStreamIndex))
            ? Number(videoStreamIndex)
            : await getVideoStreamIndex(inputPath);
        const resolvedAudioStreamIndexes = Array.isArray(audioStreamIndexes)
            ? audioStreamIndexes.map((index) => Number(index)).filter((index) => Number.isFinite(index))
            : (await getAudioTracks(inputPath)).map((track) => track.index);
        const args = [
            '-y',
            '-ss', losslessStart.toFixed(3),
            '-i', inputPath,
            '-t', duration.toFixed(3),
            ...buildTrimStreamMaps(resolvedVideoStreamIndex, resolvedAudioStreamIndexes),
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero',
            outputPath
        ];

        console.log('Requested trim:', { start, end });
        console.log('Lossless trim:', { start: losslessStart, end: losslessEnd });
        console.log('Running command:', ['ffmpeg', ...args].join(' '));

        await runCommand('ffmpeg', args);

        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            return {
                success: true,
                outputPath: outputPath,
                size: stats.size,
                actualStartTime: losslessStart,
                actualEndTime: losslessEnd
            };
        }

        throw new Error('Output file not created');
    } catch (error) {
        console.error('FFmpeg error:', error);
        throw new Error(error.message || 'Unknown error');
    }
});

ipcMain.handle('select-output-folder', async () => chooseAutoSaveFolder());

ipcMain.handle('resolve-save-path', async (event, { directory, fileName }) => {
    if (typeof directory !== 'string' || typeof fileName !== 'string') {
        throw new Error('Invalid save path options');
    }

    if (!fs.existsSync(directory)) {
        throw new Error('Auto-save folder does not exist');
    }

    return path.join(directory, path.basename(fileName));
});

ipcMain.handle('screenshot-save-dialog', async (event, options = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Screenshot',
        defaultPath: options.defaultPath || 'screenshot.png',
        filters: [
            { name: 'PNG Image', extensions: ['png'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (!result.canceled) {
        return result.filePath;
    }

    return null;
});

ipcMain.handle('save-screenshot', async (event, { filePath, imageData }) => {
    if (typeof filePath !== 'string' || typeof imageData !== 'string') {
        throw new Error('Invalid screenshot save options');
    }

    const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

    if (!fs.existsSync(filePath)) {
        throw new Error('Screenshot could not be saved');
    }

    const stats = fs.statSync(filePath);

    return {
        success: true,
        filePath,
        size: stats.size
    };
});

// Save dialog for trimmed video
ipcMain.handle('save-dialog', async (event, options = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Trimmed Video',
        defaultPath: options.defaultPath || 'trimmed_video.mp4',
        filters: [
            { name: 'MP4 Video', extensions: ['mp4'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    
    if (!result.canceled) {
        return result.filePath;
    }
    return null;
});