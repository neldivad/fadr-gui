const recoverTab = (() => {
  let assetIdInput, recoverOutputDirEl, recoverButton, recoverStatusLog, recoverProgressBar, recoverPercentageEl, recoverResultsContainer;

  function init() {
    assetIdInput = document.getElementById("assetId");
    recoverOutputDirEl = document.getElementById("recoverOutputDir");
    recoverButton = document.getElementById("recoverButton");
    recoverStatusLog = document.getElementById("recoverStatusLog");
    recoverProgressBar = document.getElementById("recoverProgressBar");
    recoverPercentageEl = document.getElementById("recoverPercentage");
    recoverResultsContainer = document.getElementById("recoverResultsContainer");

    document.getElementById("recoverSelectOutputButton").addEventListener("click", selectOutputDir);
    recoverButton.addEventListener("click", recoverFiles);

    updateRecoverButton();
  }

  // Output directory selection
  async function selectOutputDir() {
    try {
      const outputDir = await window.electronAPI.selectOutputDir();
      if (outputDir) {
        recoverOutputDirEl.value = outputDir;
        updateRecoverButton();
      }
    } catch (error) {
      showError(error.message);
    }
  }

  // Update recover button state
  function updateRecoverButton() {
    recoverButton.disabled = !(assetIdInput.value && recoverOutputDirEl.value);
  }

  // Recover files with web api
  async function recoverFiles() {
    const assetId = assetIdInput.value.trim();
    if (!assetId || !recoverOutputDirEl.value) {
      showError("Please enter an Asset ID and select an output directory");
      return;
    }

    // Show the status container
    document.getElementById("recoverStatusContainer").style.display = "block"; 
    resetRecoverUI();
    logRecoverStatus("Recovery started...", "info");

    // Disable button to prevent multiple clicks
    recoverButton.disabled = true;
    recoverButton.textContent = "Recovering...";

    try {
      const result = await window.electronAPI.recoverFromAssetId(assetId, recoverOutputDirEl.value);

      if (result.success) {
        logRecoverStatus("Recovery completed!", "success");
        successRecoverUI();
      } else {
        logRecoverStatus(`Recovery failed: ${result.error}`, "error");
      }
    } catch (error) {
      logRecoverStatus(`Error: ${error.message}`, "error");
    } finally {
      // Re-enable button after process ends
      recoverButton.disabled = false;
      recoverButton.textContent = "Recover Files";
    }
  }

  function resetRecoverUI() {
    recoverStatusLog.innerHTML = "";
    recoverProgressBar.style.width = "0%";
    recoverPercentageEl.textContent = "0%";
  }

  function successRecoverUI() {
    recoverStatusLog.innerHTML = "";
    recoverProgressBar.style.width = "100%";
    recoverPercentageEl.textContent = "100%";
  }

  function logRecoverStatus(message, type = "info") {
    console.log(`[Recovery ${type}] ${message}`);
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    entry.textContent = message;
    recoverStatusLog.appendChild(entry);
    recoverStatusLog.scrollTop = recoverStatusLog.scrollHeight;
  }

  function showError(message) {
    alert(message);
  }

  // Listen for progress updates
  window.electronAPI.onRecoverProgress((data) => {
    logRecoverStatus(data.message, "info");  // Update logs in UI
    recoverProgressBar.style.width = `${data.progress}%`;  // Update progress bar
    recoverPercentageEl.textContent = `${data.progress}%`; // Update percentage text
  });

  return { init };
})();
