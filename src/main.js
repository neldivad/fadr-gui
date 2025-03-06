// src/main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Keep a global reference of the window object
let mainWindow;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the index.html file
  mainWindow.loadFile(path.join(__dirname, '../static/index.html'));

  // Open DevTools for debugging
  // mainWindow.webContents.openDevTools();

  // Emitted when the window is closed
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// Register IPC handlers - ONLY ONCE
function registerIpcHandlers() {
  // File selection
  ipcMain.handle('select-file', async () => {
    console.log('Handler: select-file called');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav'] }]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Output directory selection
  ipcMain.handle('select-output-dir', async () => {
    console.log('Handler: select-output-dir called');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // API key and URL
  ipcMain.handle('get-api-key', () => {
    console.log('Handler: get-api-key called');
    return process.env.FADR_API_KEY;
  });
  
  ipcMain.handle('get-api-url', () => {
    console.log('Handler: get-api-url called');
    return process.env.API_URL || 'https://api.fadr.com';
  });

  // Path helpers
  ipcMain.handle('get-basename', (event, filepath) => {
    return path.basename(filepath);
  });
  
  ipcMain.handle('get-extname', (event, filepath) => {
    return path.extname(filepath).substring(1);
  });

  // Shell handlers 
  const { shell } = require('electron');

  ipcMain.handle('open-path', async (event, path) => {
    return shell.openPath(path);
  });

  ipcMain.handle('show-item-in-folder', async (event, path) => {
    return shell.showItemInFolder(path);
  });


  // processAudioFile
  ipcMain.handle('process-file', async (event, inputPath, outputDir) => {
    try {
      console.log(`Processing file: ${inputPath} to ${outputDir}`);
      
      // Load API key from environment
      const apiKey = process.env.FADR_API_KEY;
      const apiUrl = process.env.API_URL || 'https://api.fadr.com';
      
      if (!apiKey) {
        throw new Error('API key not found in environment variables');
      }
      
      // Create API client
      const FadrApi = require('./fadrApi');
      const api = new FadrApi(apiKey, apiUrl);
      
      // Process the file with progress updates
      return await api.processFile(
        inputPath, 
        outputDir,
        (message, progress) => {
          // Send progress updates to renderer
          if (mainWindow) {
            mainWindow.webContents.send('process-progress', { message, progress });
          }
        }
      );
    } catch (error) {
      console.error('Error in process-file handler:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });


  // Recovery download handler
  ipcMain.handle('recover-from-asset-id', async (event, assetId, outputDir) => {
    try {
      console.log(`Recovering files from asset ID: ${assetId}`);
      
      // Load API key from environment
      const apiKey = process.env.FADR_API_KEY;
      const apiUrl = process.env.API_URL || 'https://api.fadr.com';
      
      if (!apiKey) {
        throw new Error('API key not found in environment variables');
      }
      
      // Create API client
      const FadrApi = require('./fadrApi');
      const api = new FadrApi(apiKey, apiUrl);
      
      // Process the file with progress updates
      return await api.downloadFilesFromAssetId(
        assetId, 
        outputDir,
        (message, progress) => {
          // Send progress updates to renderer
          if (mainWindow) {
            mainWindow.webContents.send('recover-progress', { message, progress });
          }
        }
      );
    } catch (error) {
      console.error('Error in recover-from-asset-id handler:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Register all IPC handlers ONCE before creating any windows
  registerIpcHandlers();
  
  // Then create the window
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Log any unhandled exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
