const processTab = (() => {
  let inputFileEl, outputDirEl, processButton, statusLog, progressBar, percentageEl, resultsContainer;

  function init() {
    inputFileEl = document.getElementById("inputFile");
    outputDirEl = document.getElementById("outputDir");
    processButton = document.getElementById("processButton");
    statusLog = document.getElementById("statusLog");
    progressBar = document.getElementById("progressBar");
    percentageEl = document.getElementById("percentage");
    resultsContainer = document.getElementById("resultsContainer");

    document.getElementById("browseButton").addEventListener("click", selectFile);
    document.getElementById("selectOutputButton").addEventListener("click", selectOutputDir);
    processButton.addEventListener("click", processFile);

    updateProcessButton();
  }

  // File selection
  async function selectFile() {
    try {
      const filePath = await window.electronAPI.selectFile();
      if (filePath) {
        inputFileEl.value = filePath;
        updateProcessButton();
      }
    } catch (error) {
      showError(error.message);
    }
  }

  // Output directory selection
  async function selectOutputDir() {
    try {
      const outputDir = await window.electronAPI.selectOutputDir();
      if (outputDir) {
        outputDirEl.value = outputDir;
        updateProcessButton();
      }
    } catch (error) {
      showError(error.message);
    }
  }

  // Update process button state
  function updateProcessButton() {
    processButton.disabled = !(inputFileEl.value && outputDirEl.value);
  }

  // Process file with web api
  async function processFile() {
    if (!inputFileEl.value || !outputDirEl.value) {
      showError("Please select both input file and output directory");
      return;
    }

    document.getElementById("statusContainer").style.display = "block"; 
    resetUI();
    logStatus("Processing started...", "info");

    processButton.disabled = true
    processButton.textContent = "Processing...";

    try {
      const result = await window.electronAPI.processFile(inputFileEl.value, outputDirEl.value);

      if (result.success) {
        logStatus("Processing completed successfully!", "success");
        displayResults(result);
      } else {
        logStatus(`Processing failed: ${result.error}`, "error");
      }
    } catch (error) {
      logStatus(`Error: ${error.message}`, "error");
    } finally {
      // Re-enable button after process ends
      processButton.disabled = false;
      processButton.textContent = "Process File";
    }
  }

  // Helper functions
  function resetUI() {
    statusLog.innerHTML = "";
    progressBar.style.width = "0%";
    percentageEl.textContent = "0%";
    resultsContainer.style.display = "none";
  }

  function logStatus(message, type = "info") {
    console.log(`[${type}] ${message}`);
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    entry.textContent = message;
    statusLog.appendChild(entry);
    statusLog.scrollTop = statusLog.scrollHeight;
  }

  function displayResults(result) {
    resultsContainer.style.display = "block";
    document.getElementById("metadataContent").textContent = JSON.stringify(result.metadata, null, 2);
  }

  function showError(message) {
    alert(message);
  }

  // Listen for progress updates
  window.electronAPI.onProcessProgress((data) => {
    logStatus(data.message, "info");  // Update logs in UI
    progressBar.style.width = `${data.progress}%`;  // Update progress bar
    percentageEl.textContent = `${data.progress}%`; // Update percentage text
  });

  return { init };
})();
