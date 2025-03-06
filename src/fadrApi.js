// src/fadrApi.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { setTimeout } = require('timers/promises');

class FadrApi {
  constructor(apiKey, apiUrl = 'https://api.fadr.com') {
    this.apiUrl = apiUrl;
    this.client = axios.create({
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      timeout: 30000 // 30-second timeout for regular requests
    });
  }

  // Validate input file exists and is a supported format
  validateInputFile(filePath) {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`Input file does not exist: ${filePath}`);
    }

    // Check file extension
    const ext = path.extname(filePath).toLowerCase();
    if (!['.mp3', '.wav'].includes(ext)) {
      throw new Error(`Unsupported file format: ${ext}. Only .mp3 and .wav files are supported.`);
    }

    // Check file size
    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > 100) {
      throw new Error(`File too large: ${sizeMB.toFixed(2)}MB. Maximum allowed is 100MB.`);
    }

    return true;
  }

  // Validate output directory exists or can be created
  validateOutputDirectory(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      // Test write permissions by creating a temporary file
      const testFile = path.join(dirPath, '.test-write-access');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      
      return true;
    } catch (error) {
      throw new Error(`Cannot write to output directory: ${error.message}`);
    }
  }

  // Save metadata to a JSON file
  async saveMetadataToFile(metadata, outputDir, fileName = 'metadata.json') {
    try {
      const filePath = path.join(outputDir, fileName);
      
      // Format the JSON with indentation for readability
      const jsonContent = JSON.stringify(metadata, null, 2);
      
      // Write to file
      fs.writeFileSync(filePath, jsonContent);
      
      return filePath;
    } catch (error) {
      console.error(`Error saving metadata: ${error.message}`);
      throw new Error(`Failed to save metadata: ${error.message}`);
    }
  }


  // Get upload URL for file
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

  // Upload file to provided URL
  async uploadFile(url, filePath, fileType) {
    try {
      const fileContent = fs.readFileSync(filePath);
      
      // Use a separate axios instance without auth headers
      const uploadClient = axios.create({
        headers: {
          'Content-Type': fileType
        },
        // Longer timeout for uploads
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

  // Create asset in Fadr
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

  // Create stem task
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

  // Create drum stem task
  async createDrumStemTask(assetId) {
    try {
      const response = await this.client.post(`${this.apiUrl}/assets/analyze/stem`, {
        _id: assetId,
        stemType: "drum-stem"
      });
      
      return response.data.task;
    } catch (error) {
      this._handleApiError(error, 'Failed to create drum stem task');
    }
  }

  // Poll for task completion with timeout
  async pollTaskStatus(taskId, onProgress, maxAttempts = 60) {
    try {
      let attempts = 0;
      
      while (attempts < maxAttempts) {
        attempts++;
        
        const response = await this.client.post(`${this.apiUrl}/tasks/query`, {
          _ids: [taskId]
        });
        
        if (!response.data.tasks || response.data.tasks.length === 0) {
          throw new Error('Task not found');
        }
        
        const task = response.data.tasks[0];
        
        // Check if task has failed
        if (task.status === 'error' || task.status === 'failed') {
          throw new Error(`Task failed with status: ${task.status}`);
        }
        
        // Check if stems are ready
        if (task.asset.stems?.length) {
          return task;
        }
        
        // If just waiting for MIDI, and it's now available
        if (task.asset.midi?.length && attempts > 12) {
          return task;
        }
        
        // Call progress callback
        if (onProgress) {
          onProgress(attempts, maxAttempts);
        }
        
        // Wait 5 seconds before next check
        await setTimeout(5000);
      }
      
      throw new Error(`Task processing timed out after ${maxAttempts} attempts (${maxAttempts * 5 / 60} minutes)`);
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('API request timed out while checking task status');
      }
      throw error;
    }
  }

  // Get asset details
  async getAsset(assetId) {
    try {
      const response = await this.client.get(`${this.apiUrl}/assets/${assetId}`);
      return response.data.asset;
    } catch (error) {
      this._handleApiError(error, 'Failed to get asset');
    }
  }

  // Get download URL for an asset
  async getDownloadUrl(assetId, quality = 'hq') {
    try {
      const response = await this.client.get(`${this.apiUrl}/assets/download/${assetId}/${quality}`);
      return response.data.url;
    } catch (error) {
      this._handleApiError(error, 'Failed to get download URL');
    }
  }

  // Download a file
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

  // Process file from start to finish
  async processFile(inputPath, outputDir, progressCallback) {
    try {
      // Initial progress
      progressCallback('Validating input and output...', 0);
      
      // Validate input and output
      this.validateInputFile(inputPath);
      this.validateOutputDirectory(outputDir);
      
      // Get file details
      const fileName = path.basename(inputPath);
      const fileExt = path.extname(inputPath).substring(1);
      const nameWithPrefix = `[Processed] - ${path.parse(fileName).name}`;
      const stemOutputDir = path.join(outputDir, nameWithPrefix);
      
      // Create output directory
      if (!fs.existsSync(stemOutputDir)) {
        fs.mkdirSync(stemOutputDir, { recursive: true });
      }
      
      // Step 1: Get upload URL
      progressCallback('Getting upload URL...', 5);
      const { url: uploadUrl, s3Path } = await this.getUploadUrl(fileName, fileExt);
      
      // Step 2: Upload file
      progressCallback('Uploading file...', 10);
      await this.uploadFile(
        uploadUrl, 
        inputPath, 
        `audio/${fileExt}`
      );
      
      // Step 3: Create asset
      progressCallback('Creating asset...', 20);
      const asset = await this.createAsset(
        fileName,
        fileExt,
        s3Path,
        `${fileName}-stems`
      );
      
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
      
      // Step 6: Get all stems
      progressCallback('Retrieving stem information...', 70);
      
      const stemResults = [];
      const midiResults = [];
      
      // Process each stem
      for (const stemId of completedTask.asset.stems) {
        const stemAsset = await this.getAsset(stemId);
        const stemType = stemAsset.metaData.stemType;
        
        progressCallback(`Downloading ${stemType} stem...`, 75);
        
        // Get download URL
        const downloadUrl = await this.getDownloadUrl(stemAsset._id);
        
        // Download the stem
        const outputPath = path.join(stemOutputDir, `${stemType}.${fileExt}`);
        await this.downloadFile(downloadUrl, outputPath);
        
        stemResults.push({
          type: stemType,
          path: outputPath,
          metadata: stemAsset.metaData
        });

        // Process drum stems separately
        if (stemType === 'drums') {
          try {
            await this._processDrumStems(stemAsset._id, stemOutputDir, fileExt, progressCallback);
          } catch (error) {
            // Log but continue if drum processing fails
            console.error(`Error processing drum stems: ${error.message}`);
            progressCallback(`Warning: Drum stem processing failed: ${error.message}`, 85);
          }
        }
        
        // MIDI DOWNLOAD FIX: Process MIDI files from the parent asset (not just stems)
        progressCallback('Processing MIDI files...', 85);
            
        // Get the latest asset data to ensure we have all MIDI files
        const updatedAsset = await this.getAsset(asset._id);

        if (updatedAsset.midi && updatedAsset.midi.length > 0) {
          progressCallback(`Found ${updatedAsset.midi.length} MIDI files to download`, 86);
          
          for (const midiId of updatedAsset.midi) {
            try {
              const midiAsset = await this.getAsset(midiId);
              
              // Determine MIDI type - try to get from metadata or use a default
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
      }
      
      // Get final metadata
      progressCallback('Retrieving final metadata...', 95);
      const finalAsset = await this.getAsset(asset._id);
      const metadataFilePath = await this.saveMetadataToFile(
        finalAsset, 
        stemOutputDir
      );
      
      // Complete
      progressCallback('Processing complete!', 100);
      
      return {
        success: true,
        metadata: finalAsset,
        metadataFile: metadataFilePath,
        stems: stemResults,
        midi: midiResults,
        outputDirectory: stemOutputDir
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Process drum stems (internal method)
  async _processDrumStems(drumsAssetId, outputDir, fileExt, progressCallback) {
    // Create drum sub-directory
    const drumStemsDir = path.join(outputDir, 'drum-components');
    if (!fs.existsSync(drumStemsDir)) {
      fs.mkdirSync(drumStemsDir, { recursive: true });
    }
    
    // Start drum stem task
    progressCallback('Starting drum stem separation...', 85);
    const task = await this.createDrumStemTask(drumsAssetId);
    
    // Poll for completion
    const completedTask = await this.pollTaskStatus(
      task._id,
      (attempt, maxAttempts) => {
        progressCallback(`Waiting for drum stems (attempt ${attempt}/${maxAttempts})...`, 85);
      },
      30 // Fewer attempts for drum stems
    );
    
    // Process each drum stem
    const drumResults = [];
    
    for (const stemId of completedTask.asset.stems) {
      const stemAsset = await this.getAsset(stemId);
      const stemType = stemAsset.metaData.stemType;
      
      progressCallback(`Downloading ${stemType} drum component...`, 90);
      
      // Get download URL
      const downloadUrl = await this.getDownloadUrl(stemAsset._id);
      
      // Download the stem
      const outputPath = path.join(drumStemsDir, `${stemType}.${fileExt}`);
      await this.downloadFile(downloadUrl, outputPath);
      
      drumResults.push({
        type: `drum/${stemType}`,
        path: outputPath,
        metadata: stemAsset.metaData
      });
    }
    
    return drumResults;
  }

  // Helper to handle API errors consistently
  _handleApiError(error, defaultMessage) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      const data = error.response.data;
      const message = data.message || data.error || JSON.stringify(data);
      throw new Error(`${defaultMessage}: ${message} (Status ${error.response.status})`);
    } else if (error.request) {
      // The request was made but no response was received
      throw new Error(`${defaultMessage}: No response received`);
    } else {
      // Something happened in setting up the request that triggered an Error
      throw new Error(`${defaultMessage}: ${error.message}`);
    }
  }

  // Download recovery files from an asset ID
  // Get asset ID from metadata.json returned from processFile
  async downloadFilesFromAssetId(assetId, outputDir, progressCallback) {
    try {
      progressCallback('Starting recovery process...', 0);
      
      // Create output directory if it doesn't exist
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Get asset details
      progressCallback('Retrieving asset information...', 10);
      const asset = await this.getAsset(assetId);
      
      // Save metadata
      progressCallback('Saving metadata...', 20);
      const metadataFilePath = await this.saveMetadataToFile(asset, outputDir);
      
      const results = {
        metadata: asset,
        metadataFile: metadataFilePath,
        stems: [],
        midi: [],
        outputDirectory: outputDir
      };
      
      // Check for stems
      if (asset.stems && asset.stems.length > 0) {
        progressCallback(`Found ${asset.stems.length} stems to download`, 30);
        
        // Get file extension from asset (default to mp3 if not found)
        const fileExt = 'mp3';
        
        // Process each stem
        let stemCount = 0;
        for (const stemId of asset.stems) {
          try {
            stemCount++;
            const progress = 30 + (stemCount / asset.stems.length) * 30;
            
            const stemAsset = await this.getAsset(stemId);
            const stemType = stemAsset.metaData?.stemType || `stem${stemCount}`;
            
            progressCallback(`Downloading ${stemType} stem...`, progress);
            
            // Get download URL
            const downloadUrl = await this.getDownloadUrl(stemId);
            
            // Download the stem
            const outputPath = path.join(outputDir, `${stemType}.${fileExt}`);
            await this.downloadFile(downloadUrl, outputPath);
            
            results.stems.push({
              type: stemType,
              path: outputPath,
              metadata: stemAsset.metaData
            });
          } catch (error) {
            console.error(`Error downloading stem ${stemId}: ${error.message}`);
            progressCallback(`Warning: Failed to download a stem: ${error.message}`, 60);
          }
        }
      }
      
      // Download MIDIs
      if (asset.midi && asset.midi.length > 0) {
        progressCallback(`Found ${asset.midi.length} MIDI files to download`, 70);
        
        // Process each MIDI
        let midiCount = 0;
        for (const midiId of asset.midi) {
          try {
            midiCount++;
            const progress = 70 + (midiCount / asset.midi.length) * 25;
            
            const midiAsset = await this.getAsset(midiId);
            
            // Determine MIDI type
            let midiType = 'unknown';
            if (midiAsset.metaData && midiAsset.metaData.midiType) {
              midiType = midiAsset.metaData.midiType;
            } else if (midiAsset.metaData && midiAsset.metaData.stemType) {
              midiType = midiAsset.metaData.stemType;
            }
            
            progressCallback(`Downloading ${midiType} MIDI...`, progress);
            
            // Get download URL
            const midiUrl = await this.getDownloadUrl(midiId);
            
            // Download the MIDI
            const midiPath = path.join(outputDir, `${midiType}.mid`);
            await this.downloadFile(midiUrl, midiPath);
            
            results.midi.push({
              type: midiType,
              path: midiPath,
              metadata: midiAsset.metaData
            });
          } catch (error) {
            console.error(`Error downloading MIDI ${midiId}: ${error.message}`);
            progressCallback(`Warning: Failed to download a MIDI file: ${error.message}`, 95);
          }
        }
      } else {
        progressCallback('No MIDI files found in asset', 85);
      }
      
      progressCallback('Recovery process complete!', 100);
      
      return {
        success: true,
        ...results
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
