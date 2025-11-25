// Grafana Panel Screenshot - Popup Script

document.addEventListener('DOMContentLoaded', init);

let panels = [];
let selectedPanels = new Set();
let currentTabId = null;

async function init() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

  // Setup event listeners
  document.getElementById('refreshBtn').addEventListener('click', loadPanels);
  document.getElementById('selectAllBtn').addEventListener('click', selectAll);
  document.getElementById('clearAllBtn').addEventListener('click', clearAll);
  document.getElementById('visualModeBtn').addEventListener('click', enterVisualMode);
  document.getElementById('captureBtn').addEventListener('click', captureSelected);

  // Load panels
  await loadPanels();
}

async function loadPanels() {
  showLoading();

  try {
    // Inject content script if needed and get panels
    const response = await chrome.tabs.sendMessage(currentTabId, { action: 'getPanels' });

    if (response && response.panels && response.panels.length > 0) {
      panels = response.panels;
      renderPanelList(response.dashboard);
    } else {
      showNoPanels();
    }
  } catch (error) {
    console.error('Error loading panels:', error);
    // Content script might not be loaded - try to check if it's a grafana page
    showNotGrafana();
  }
}

function showLoading() {
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('content').style.display = 'none';
  document.getElementById('notGrafana').style.display = 'none';
  document.getElementById('noPanels').style.display = 'none';
  document.getElementById('capturing').style.display = 'none';
}

function showContent() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'flex';
  document.getElementById('content').style.flexDirection = 'column';
  document.getElementById('notGrafana').style.display = 'none';
  document.getElementById('noPanels').style.display = 'none';
  document.getElementById('capturing').style.display = 'none';
}

function showNotGrafana() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'none';
  document.getElementById('notGrafana').style.display = 'flex';
  document.getElementById('noPanels').style.display = 'none';
  document.getElementById('capturing').style.display = 'none';
}

function showNoPanels() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'none';
  document.getElementById('notGrafana').style.display = 'none';
  document.getElementById('noPanels').style.display = 'flex';
  document.getElementById('capturing').style.display = 'none';
}

function showCapturing() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'none';
  document.getElementById('notGrafana').style.display = 'none';
  document.getElementById('noPanels').style.display = 'none';
  document.getElementById('capturing').style.display = 'flex';
}

function renderPanelList(dashboard) {
  showContent();

  // Update dashboard info
  document.getElementById('dashboardTitle').textContent = dashboard?.title || 'Dashboard';
  document.getElementById('panelCount').textContent = `${panels.length} panels`;

  // Render panel list
  const listEl = document.getElementById('panelList');
  listEl.innerHTML = '';

  panels.forEach(panel => {
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.dataset.panelId = panel.id;

    item.innerHTML = `
      <div class="panel-checkbox">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <span class="panel-title">${escapeHtml(panel.title)}</span>
      <span class="panel-id">#${panel.id}</span>
    `;

    item.addEventListener('click', () => togglePanel(panel.id, item));
    listEl.appendChild(item);
  });

  updateCaptureButton();
}

function togglePanel(panelId, itemEl) {
  if (selectedPanels.has(panelId)) {
    selectedPanels.delete(panelId);
    itemEl.classList.remove('selected');
  } else {
    selectedPanels.add(panelId);
    itemEl.classList.add('selected');
  }

  updateCaptureButton();
  syncSelectionWithContent();
}

function selectAll() {
  const items = document.querySelectorAll('.panel-item');
  items.forEach(item => {
    const panelId = item.dataset.panelId;
    selectedPanels.add(panelId);
    item.classList.add('selected');
  });

  updateCaptureButton();
  syncSelectionWithContent();
}

function clearAll() {
  selectedPanels.clear();
  document.querySelectorAll('.panel-item').forEach(item => {
    item.classList.remove('selected');
  });

  updateCaptureButton();
  syncSelectionWithContent();
}

function updateCaptureButton() {
  const btn = document.getElementById('captureBtn');
  const count = selectedPanels.size;

  btn.disabled = count === 0;
  btn.querySelector('span').textContent = count > 0
    ? `Capture Selected (${count})`
    : 'Capture Selected';
}

async function syncSelectionWithContent() {
  try {
    await chrome.tabs.sendMessage(currentTabId, {
      action: 'setSelectedPanels',
      panelIds: Array.from(selectedPanels)
    });
  } catch (error) {
    // Content script might not be ready
  }
}

async function enterVisualMode() {
  try {
    await chrome.tabs.sendMessage(currentTabId, { action: 'enterSelectionMode' });
    window.close();
  } catch (error) {
    console.error('Error entering visual mode:', error);
  }
}

async function captureSelected() {
  if (selectedPanels.size === 0) return;

  showCapturing();

  const panelIds = Array.from(selectedPanels);
  const progressEl = document.getElementById('captureProgress');

  try {
    progressEl.textContent = `Capturing ${panelIds.length} panels...`;

    // Request capture from content script
    const response = await chrome.tabs.sendMessage(currentTabId, {
      action: 'capturePanels',
      panelIds: panelIds
    });

    if (response && response.results) {
      progressEl.textContent = 'Saving screenshots...';

      // Download each screenshot
      for (let i = 0; i < response.results.length; i++) {
        const result = response.results[i];
        progressEl.textContent = `Saving ${i + 1}/${response.results.length}...`;

        if (result.dataUrl) {
          await downloadScreenshot(result.dataUrl, result.title);
        }
      }

      progressEl.textContent = 'Done!';
      setTimeout(() => {
        showContent();
      }, 1000);
    } else {
      throw new Error('No results returned');
    }
  } catch (error) {
    console.error('Error capturing panels:', error);
    progressEl.textContent = 'Error capturing panels';
    setTimeout(() => {
      showContent();
    }, 2000);
  }
}

async function downloadScreenshot(dataUrl, title) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = sanitizeFilename(`${title}_${timestamp}.png`);

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'download',
      dataUrl: dataUrl,
      filename: filename
    }, (response) => {
      if (response && response.error) {
        console.error('Download failed:', response.error);
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
