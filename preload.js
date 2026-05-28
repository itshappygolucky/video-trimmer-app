const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectVideo: () => ipcRenderer.invoke('select-video'),
    selectVideoFolder: (folderPath) => ipcRenderer.invoke('select-video-folder', folderPath),
    handleDroppedPaths: (paths) => ipcRenderer.invoke('handle-dropped-paths', paths),
    getVideoInfo: (inputPath) => ipcRenderer.invoke('get-video-info', inputPath),
    getPlaybackSource: (inputPath) => ipcRenderer.invoke('get-playback-source', inputPath),
    trimVideo: (data) => ipcRenderer.invoke('trim-video', data),
    deleteVideo: (filePath) => ipcRenderer.invoke('delete-video', filePath),
    confirmDeleteSource: (filePath) => ipcRenderer.invoke('confirm-delete-source', filePath),
    saveDialog: (options) => ipcRenderer.invoke('save-dialog', options),
    screenshotSaveDialog: (options) => ipcRenderer.invoke('screenshot-save-dialog', options),
    saveScreenshot: (options) => ipcRenderer.invoke('save-screenshot', options),
    selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
    resolveSavePath: (options) => ipcRenderer.invoke('resolve-save-path', options),
    updateMenuSettings: (settings) => ipcRenderer.send('settings-state', settings),
    onMenuSettingChanged: (callback) => {
        ipcRenderer.on('menu-setting-changed', (event, setting) => callback(setting));
    },
    onShortcut: (callback) => {
        ipcRenderer.on('shortcut', (event, action) => callback(action));
    }
});