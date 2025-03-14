// src/fadrApi.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { setTimeout } = require('timers/promises');

class FadrApi {
  constructor(apiKey, apiUrl = 'https://api.fadr.com') {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.client = axios.create({
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      timeout: 30000 // 30-second timeout for regular requests
    });
  }

  // File and Directory Utility Methods
  validateInputFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Input file does not exist: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!['.mp3', '.wav'].includes(ext)) {
      throw new Error(`Unsupported file format: ${ext}. Only .mp3 and .wav files are supported.`);
    }

    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > 100) {
      throw new Error(`File too large: ${sizeMB.toFixed(2)}MB. Maximum allowed is 100MB.`);
    }

    return true;
  }

  ensureDirectory(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      return true;
    } catch (error) {
      throw new Error(`Cannot create directory: ${error.message}`);
    }
  }

  validateOutputDirectory(dirPath) {
    this.ensureDirectory(dirPath);
    
    try {
      // Test write permissions
      const testFile = path.join(dirPath, '.test-write-access');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return true;
    } catch (error) {
      throw new Error(`Cannot write to output directory: ${error.message}`);
    }
  }

  // Save metadata to file
  async saveMetadataToFile(metadata, outputDir, fileName = 'metadata.json') {
    try {
      const filePath = path.join(outputDir, fileName);
      const jsonContent = JSON.stringify(metadata, null, 2);
      fs.writeFileSync(filePath, jsonContent);
      return filePath;
    } catch (error) {
      console.error(`Error saving metadata: ${error.message}`);
      throw new Error(`Failed to save metadata: ${error.message}`);
    }
  }

  // API Request Methods
  _handleApiError(error, defaultMessage) {
    if (error.response) {
      const data = error.response.data;
      const message = data.message || data.error || JSON.stringify(data);
      throw new Error(`${defaultMessage}: ${message} (Status ${error.response.status})`);
    } else if (error.request) {
      throw new Error(`${defaultMessage}: No response received`);
    } else {
      throw new Error(`${defaultMessage}: ${error.message}`);
    }
  }

  async getUploadUrl(fileName, extension) {
    try {
      const response = await this.client.post(`${this.apiUrl}/assets/upload2`, {
        name: fileName,
        extension: extension,
      });
      return response.data;
    } catch (error) {
      this._handleApiError(error, 'Failed to get upload URL');
    }
  }

  async uploadFile(url, filePath, fileType) {
    try {
      const fileContent = fs.readFileSync(filePath);
      
      const uploadClient = axios.create({
        headers: {
          'Content-Type': fileType
        },
        timeout: 120000 // 2 minutes
      });
      
      await uploadClient.put(url, fileContent);
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Upload timed out. File may be too large or your connection is slow.');
      }
      throw new Error(`Upload failed: ${error.message}`);
    }
  }

  async createAsset(name, extension, s3Path, group) {
    try {
      const response = await this.client.post(`${this.apiUrl}/assets`, {
        name,
        extension,
        group: group || `${name}-group`,
        s3Path
      });
      return response.data.asset;
    } catch (error) {
      this._handleApiError(error, 'Failed to create asset');
    }
  }

  async createStemTask(assetId) {
    try {
      const response = await this.client.post(`${this.apiUrl}/assets/analyze/stem`, {
        _id: assetId
      });
      return response.data.task;
    } catch (error) {
      this._handleApiError(error, 'Failed to create stem task');
    }
  }

  async createDrumStemTask(drumAssetId) {
    try {
      const response = await this.client.post(`${this.apiUrl}/assets/analyze/stem`, {
        _id: drumAssetId,
        stemType: "drum-stem"
      });
      return response.data.task;
    } catch (error) {
      this._handleApiError(error, 'Failed to create drum stem task');
    }
  }

  async createOtherStemTask(otherAssetId) {
    try {
      const response = await this.client.post(`${this.apiUrl}/assets/analyze/stem`, {
        _id: otherAssetId,
        stemType: "other-stem" // or "melody-stem"
      });
      return response.data.task;
    } catch (error) {
      this._handleApiError(error, 'Failed to create other stem task');
    }
  }

  // async createTask(assetId, taskType = "stem", stemType = null) {
  //   try {
  //     const payload = { _id: assetId };
  //     if (stemType) {
  //       payload.stemType = stemType;
  //     }
      
  //     const response = await this.client.post(
  //       `${this.apiUrl}/assets/analyze/${taskType}`, 
  //       payload
  //     );
      
  //     return response.data.task;
  //   } catch (error) {
  //     this._handleApiError(error, `Failed to create ${taskType} task`);
  //   }
  // }

  async pollTaskStatus(taskId, onProcessProgress, maxAttempts = 60) {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const response = await this.client.post(`${this.apiUrl}/tasks/query`, {
          _ids: [taskId]
        });
        if (!response.data.tasks || response.data.tasks.length === 0) {
          throw new Error('Task not found');
        }
        
        const task = response.data.tasks[0];
        if (task.status === 'error' || task.status === 'failed') {
          throw new Error(`Task failed with status: ${task.status}`);
        }
        
        if (task.asset.stems?.length) {
          return task;
        }
        
        if (task.asset.midi?.length && attempts > 12) {
          return task;
        }
        
        if (onProcessProgress) {
          onProcessProgress(attempts, maxAttempts);
        }
      } catch (error) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('API request timed out while checking task status');
        }
        throw error;
      }
      
      await setTimeout(5000);
    }
    
    throw new Error(`Task processing timed out after ${maxAttempts * 5 / 60} minutes`);
  }

  async getAsset(assetId) {
    try {
      const response = await this.client.get(`${this.apiUrl}/assets/${assetId}`);
      return response.data.asset;
    } catch (error) {
      this._handleApiError(error, 'Failed to get asset');
    }
  }

  async getDownloadUrl(assetId, quality = 'hq') {
    try {
      const response = await this.client.get(`${this.apiUrl}/assets/download/${assetId}/${quality}`);
      return response.data.url;
    } catch (error) {
      this._handleApiError(error, 'Failed to get download URL');
    }
  }

  async downloadFile(url, outputPath) {
    try {
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 60000 // 1 minute timeout
      });
      
      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);
      
      return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Download timed out');
      }
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  // Process drum stems exactly according to official docs
  async processDrumStems(drumAssetId, outputDir, fileExt, baseName, progressCallback) {

    // Create drum sub-directory
    const drumStemsDir = path.join(outputDir, 'drum-components');
    this.ensureDirectory(drumStemsDir);
    progressCallback('Starting drum stem separation...', 85);
    
    try {
      // Create drum-specific stem task
      const task = await this.createDrumStemTask(drumAssetId);
      
      // Poll for completion
      const completedTask = await this.pollTaskStatus(
        task._id,
        (attempt, maxAttempts) => {
          progressCallback(`Waiting for drum stems (attempt ${attempt}/${maxAttempts})...`, 85);
        },
        30 // Fewer attempts for drum stems
      );
      
      // Process each drum component
      const drumResults = [];
      for (const stemId of completedTask.asset.stems) {
        const stemAsset = await this.getAsset(stemId);
        const stemType = stemAsset.metaData.stemType;
        progressCallback(`Downloading ${stemType} drum component...`, 90);
        
        // Get download URL
        const downloadUrl = await this.getDownloadUrl(stemAsset._id);
        
        // Download the stem
        const outputPath = path.join(drumStemsDir, `${baseName}_${stemType}.${fileExt}`);
        await this.downloadFile(downloadUrl, outputPath);
        drumResults.push({
          type: `drum/${stemType}`,
          path: outputPath,
          metadata: stemAsset.metaData
        });
      }
      
      return drumResults;
    } catch (error) {
      progressCallback(`Warning: Drum stem processing failed: ${error.message}`, 85);
      throw error; // Re-throw to be handled by caller
    }
  }


  // Process instrumental / other stems
  async processOtherStems(otherAssetId, outputDir, fileExt, baseName, progressCallback) {

    // Create other sub-directory
    const otherStemsDir = path.join(outputDir, 'other-components');
    this.ensureDirectory(otherStemsDir);
    progressCallback('Starting other stem separation...', 85);
    
    try {
      // Create drum-specific stem task
      const task = await this.createOtherStemTask(otherAssetId);
      
      // Poll for completion
      const completedTask = await this.pollTaskStatus(
        task._id,
        (attempt, maxAttempts) => {
          progressCallback(`Waiting for other stems (attempt ${attempt}/${maxAttempts})...`, 85);
        },
        30 
      );
      
      // Process each Other component
      const otherResults = [];
      for (const stemId of completedTask.asset.stems) {
        const stemAsset = await this.getAsset(stemId);
        const stemType = stemAsset.metaData.stemType;
        progressCallback(`Downloading ${stemType} other component...`, 90);
        
        // Get download URL
        const downloadUrl = await this.getDownloadUrl(stemAsset._id);
        
        // Download the stem
        const outputPath = path.join(otherStemsDir, `${baseName}_${stemType}.${fileExt}`);
        await this.downloadFile(downloadUrl, outputPath);
        otherResults.push({
          type: `other/${stemType}`,
          path: outputPath,
          metadata: stemAsset.metaData
        });
      }
      
      return drumResults;
    } catch (error) {
      progressCallback(`Warning: Other stem processing failed: ${error.message}`, 85);
      throw error; // Re-throw to be handled by caller
    }
  }

  // Main processing method
  async processFile(inputPath, outputDir, progressCallback) {
    try {
      progressCallback('Validating input and output...', 0);
      
      this.validateInputFile(inputPath);
      this.validateOutputDirectory(outputDir);
      
      // Get file details
      const fileName = path.basename(inputPath);
      const fileExt = path.extname(inputPath).substring(1);
      const baseName = path.parse(fileName).name;
      const nameWithPrefix = `[Processed] - ${baseName}`;
      const stemOutputDir = path.join(outputDir, nameWithPrefix);
      
      this.ensureDirectory(stemOutputDir);
      
      // Step 1: Get upload URL
      progressCallback('Getting upload URL...', 5);
      const { url: uploadUrl, s3Path } = await this.getUploadUrl(fileName, fileExt);
      
      // Step 2: Upload file
      progressCallback('Uploading file...', 10);
      await this.uploadFile(uploadUrl, inputPath, `audio/${fileExt}`);
      
      // Step 3: Create asset
      progressCallback('Creating asset...', 20);
      const asset = await this.createAsset(fileName, fileExt, s3Path, `${fileName}-stems`);
      
      // Save initial metadata
      progressCallback('Saving initial metadata...', 22);
      const metadataFilePath = await this.saveMetadataToFile(
        asset, 
        stemOutputDir,
        'initial_metadata.json'
      );
      
      progressCallback(`Metadata saved to: ${metadataFilePath}`, 24);
      progressCallback(`Use asset ID: ${asset._id} for recovery if needed`, 25);
      
      // Step 4: Start stem task
      progressCallback('Starting stem extraction...', 25);
      const task = await this.createStemTask(asset._id);
      
      // Step 5: Poll for completion
      progressCallback('Processing stems...', 30);
      const completedTask = await this.pollTaskStatus(
        task._id,
        (attempt, maxAttempts) => {
          const progress = 30 + Math.min(40, (attempt / maxAttempts) * 40);
          progressCallback(`Waiting for stems (attempt ${attempt}/${maxAttempts})...`, progress);
        }
      );
      
      // Step 6: Get updated asset info
      progressCallback('Retrieving stem information...', 70);
      const finalAsset = await this.getAsset(asset._id);
      
      // Process stems
      const stemResults = [];
      let drumAssetId = null;
      let otherAssetId = null;
      
      // Download all main stems first
      for (const stemId of completedTask.asset.stems) {
        const stemAsset = await this.getAsset(stemId);
        const stemType = stemAsset.metaData.stemType;
        
        progressCallback(`Downloading ${stemType} stem...`, 75);
        
        // Get download URL
        const downloadUrl = await this.getDownloadUrl(stemAsset._id);
        
        // Download the stem
        const outputPath = path.join(stemOutputDir, `${baseName}_${stemType}.${fileExt}`);
        await this.downloadFile(downloadUrl, outputPath);
        
        stemResults.push({
          type: stemType,
          path: outputPath,
          metadata: stemAsset.metaData
        });
        
        // Remember the drum asset ID if found
        if (stemType === 'drums') {
          drumAssetId = stemAsset._id;
        }
        if (["other", "others"].includes(stemType.toLowerCase())) {
          otherAssetId = stemAsset._id;
        }
      }
      
      // Process drum stems if available
      if (drumAssetId) {
        try {
          const drumResults = await this.processDrumStems(
            drumAssetId,
            stemOutputDir,
            fileExt,
            baseName,
            progressCallback
          );
          
          // Add drum results to our list
          stemResults.push(...drumResults);
        } catch (error) {
          console.error(`Error processing drum stems: ${error.message}`);
        }
      }

      // Process other stems if available
      if (otherAssetId) {
        try {
          const otherResults = await this.processOtherStems(
            otherAssetId,
            stemOutputDir,
            fileExt,
            baseName,
            progressCallback
          );
          
          // Add other results to our list
          stemResults.push(...otherResults);
        } catch (error) {
          console.error(`Error processing other stems: ${error.message}`);
        }
      }
      
      // Process MIDI files
      progressCallback('Processing MIDI files...', 85);
      
      const midiResults = [];
      if (finalAsset.midi && finalAsset.midi.length > 0) {
        progressCallback(`Found ${finalAsset.midi.length} MIDI files to download`, 86);
        
        for (const midiId of finalAsset.midi) {
          try {
            const midiAsset = await this.getAsset(midiId);
            
            // Determine MIDI type
            let midiType = 'unknown';
            if (midiAsset.metaData && midiAsset.metaData.midiType) {
              midiType = midiAsset.metaData.midiType;
            } else if (midiAsset.metaData && midiAsset.metaData.stemType) {
              midiType = midiAsset.metaData.stemType;
            }
            
            progressCallback(`Downloading ${midiType} MIDI...`, 87);
            
            // Get download URL
            const midiUrl = await this.getDownloadUrl(midiAsset._id);
            
            // Download the MIDI
            const midiPath = path.join(stemOutputDir, `${midiType}.mid`);
            await this.downloadFile(midiUrl, midiPath);
            
            midiResults.push({
              type: midiType,
              path: midiPath,
              metadata: midiAsset.metaData
            });
            
            progressCallback(`MIDI ${midiType} downloaded successfully`, 88);
          } catch (error) {
            console.error(`Error downloading MIDI ${midiId}: ${error.message}`);
            progressCallback(`Warning: MIDI download failed: ${error.message}`, 88);
          }
        }
      } else {
        progressCallback('No MIDI files found in asset', 87);
      }
      
      // Update metadata at the end
      progressCallback('Updating metadata file...', 98);
      const finalMetadataFilePath = await this.saveMetadataToFile(
        finalAsset, 
        stemOutputDir,
        'metadata.json'
      );
      
      // Complete
      progressCallback('Processing complete!', 100);
      
      return {
        success: true,
        metadata: finalAsset,
        metadataFile: finalMetadataFilePath,
        initialMetadataFile: metadataFilePath,
        stems: stemResults,
        midi: midiResults,
        outputDirectory: stemOutputDir
      };
    } catch (error) {
      console.error('Processing failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Recovery method
  // Cannot retrieve stems derived from drum / other. Totally unusable.  

  async downloadFilesFromAssetId(assetId, outputDir, progressCallback) {
    try {
      progressCallback('Starting recovery process...', 0);
      
      this.ensureDirectory(outputDir);
      
      // Get asset details
      progressCallback('Retrieving asset information...', 10);
      const asset = await this.getAsset(assetId);
      
      // Save metadata
      progressCallback('Saving metadata...', 20);
      const metadataFilePath = await this.saveMetadataToFile(asset, outputDir);
      
      const baseName = asset.metaData?.name 
        ? path.parse(asset.metaData.name).name 
        : `${assetId}`;
      
      // Default file extension if not found
      const fileExt = 'mp3';
      
      // Download stems
      const stemResults = [];
      if (asset.stems && asset.stems.length > 0) {
        progressCallback(`Found ${asset.stems.length} stems to download`, 30);
        
        stemResults.push(...await this.downloadFile(
          asset.stems,
          outputDir,
          fileExt,
          baseName,
          'stem',
          (message) => progressCallback(message, 50)
        ));
      }
      
      // Download MIDIs
      const midiResults = [];
      if (asset.midi && asset.midi.length > 0) {
        progressCallback(`Found ${asset.midi.length} MIDI files to download`, 70);
        
        midiResults.push(...await this.downloadFile(
          asset.midi,
          outputDir,
          'mid',
          baseName,
          'midi',
          (message) => progressCallback(message, 85)
        ));
      } else {
        progressCallback('No MIDI files found in asset', 85);
      }
      
      progressCallback('Recovery process complete!', 100);
      
      return {
        success: true,
        metadata: asset,
        metadataFile: metadataFilePath,
        stems: stemResults,
        midi: midiResults,
        outputDirectory: outputDir
      };
    } catch (error) {
      console.error('Recovery failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = FadrApi;
