// Grafana Panel Screenshot - Background Service Worker

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'download':
      downloadFile(message.dataUrl, message.filename)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ error: error.message }));
      return true; // Keep channel open for async response

    case 'captureSelectedPanels':
      // Handle capture request from content script
      handleCaptureRequest(message, sender.tab);
      sendResponse({ received: true });
      break;
  }
});

// Download a file
async function downloadFile(dataUrl, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

// Handle capture request from content script (for visual selection mode)
async function handleCaptureRequest(message, tab) {
  const { panels, dashboard } = message;

  if (!panels || panels.length === 0) return;

  // Capture each panel
  for (const panel of panels) {
    try {
      // Send message to content script to capture this specific panel
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'capturePanel',
        panelId: panel.id
      });

      if (response && response.dataUrl) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = sanitizeFilename(`${panel.title}_${timestamp}.png`);

        await downloadFile(response.dataUrl, filename);
      }
    } catch (error) {
      console.error(`Error capturing panel ${panel.id}:`, error);
    }
  }

  // Notify content script that capture is complete
  chrome.tabs.sendMessage(tab.id, { action: 'captureComplete' });
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200);
}

// Create context menu for quick access
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'grafana-screenshot',
    title: 'Capture Grafana Panels',
    contexts: ['page']
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'grafana-screenshot') {
    chrome.tabs.sendMessage(tab.id, { action: 'enterSelectionMode' });
  }
});
