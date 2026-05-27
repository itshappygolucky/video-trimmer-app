const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
let menuSettings = {
    appendCutTimes: true,
    rememberLastFolder: false,
    showDeleteOption: true
};

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

async function getFolderVideos(folderPath) {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const videoPaths = entries
        .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => path.join(folderPath, entry.name))
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    const videos = [];

    for (const videoPath of videoPaths) {
        const fileInfo = getVideoFileInfo(videoPath);

        videos.push({
            ...fileInfo,
            duration: await getVideoDuration(videoPath),
            thumbnailPath: await generateThumbnail(videoPath)
        });
    }

    return {
        folderPath,
        videos
    };
}

function buildApplicationMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                { role: 'quit' }
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
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'assets', 'icon.png'),
        title: 'Video Trimmer Pro'
    });

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

// Handle lossless trimming
ipcMain.handle('trim-video', async (event, data) => {
    const { inputPath, startTime, endTime, outputPath } = data;

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

        const args = [
            '-y',
            '-ss', losslessStart.toFixed(3),
            '-i', inputPath,
            '-t', duration.toFixed(3),
            '-map', '0:v:0',
            '-map', '0:a?',
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