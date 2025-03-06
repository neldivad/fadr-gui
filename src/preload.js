// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script executing');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  
  // API operations
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  getApiUrl: () => ipcRenderer.invoke('get-api-url'),
  
  // Process file
  processFile: (inputPath, outputDir) => 
    ipcRenderer.invoke('process-file', inputPath, outputDir),
  
  // Events
  onProcessProgress: (callback) => {
    ipcRenderer.on('process-progress', (event, data) => callback(event, data));
  },
  onRecoverProgress: (callback) => {
    ipcRenderer.on("recover-progress", (event, data) => callback(data));
  },
  
  // Shell operations (for opening files)
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),
  
  // Recovery method
  recoverFromAssetId: (assetId, outputDir) => 
    ipcRenderer.invoke('recover-from-asset-id', assetId, outputDir),
  
  // Progress event for recovery
  onRecoverProgress: (callback) => {
    ipcRenderer.on('recover-progress', (event, data) => callback(event, data));
  }
  
});
