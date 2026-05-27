const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectVideo: () => ipcRenderer.invoke('select-video'),
    selectVideoFolder: (folderPath) => ipcRenderer.invoke('select-video-folder', folderPath),
    getVideoInfo: (inputPath) => ipcRenderer.invoke('get-video-info', inputPath),
    trimVideo: (data) => ipcRenderer.invoke('trim-video', data),
    deleteVideo: (filePath) => ipcRenderer.invoke('delete-video', filePath),
    saveDialog: (options) => ipcRenderer.invoke('save-dialog', options),
    updateMenuSettings: (settings) => ipcRenderer.send('settings-state', settings),
    onMenuSettingChanged: (callback) => {
        ipcRenderer.on('menu-setting-changed', (event, setting) => callback(setting));
    }
});