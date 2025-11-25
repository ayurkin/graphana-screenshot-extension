// Grafana Panel Screenshot - Popup Script

document.addEventListener('DOMContentLoaded', init);

const DEFAULT_COLLAGE_SIZE = 1;
const DEFAULT_OUTPUT_MODE = 'disk';
const DEFAULT_SINGLE_COLLAGE = false;
const DEFAULT_PROCESSING = {
  resizeEnabled: false,
  maxWidth: 1600,
  resizeMode: 'maxWidth', // 'maxWidth' | 'percent'
  percent: 100,
  compressEnabled: false,
  quality: 0.75
};
const DEFAULT_IGNORE = {
  enabled: false,
  patterns: ''
};
const ZIP_FILENAME = 'grafana_collages.zip';

let panels = [];
let selectedPanels = new Set();
let currentTabId = null;
let searchTerm = '';
let lastDashboard = null;
let collageSize = DEFAULT_COLLAGE_SIZE;
let outputMode = DEFAULT_OUTPUT_MODE;
let forceSingleCollage = DEFAULT_SINGLE_COLLAGE;
let processingConfig = { ...DEFAULT_PROCESSING };
let currentTab = 'select';
let ignoreConfig = { ...DEFAULT_IGNORE };

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action !== 'panelsUpdated') return;
  if (!currentTabId || !sender?.tab || sender.tab.id !== currentTabId) return;

  panels = message.panels || [];
  pruneSelection();
  lastDashboard = message.dashboard || lastDashboard;

  if (!panels.length) {
    showNoPanels();
    return;
  }

  renderPanelList();
});

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
  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderPanelList();
  });
  document.getElementById('collageInput').addEventListener('change', async (e) => {
    await saveCollageSize(e.target.value);
  });
  document.querySelectorAll('input[name="outputMode"]').forEach(input => {
    input.addEventListener('change', async (e) => {
      if (e.target.checked) {
        await saveOutputMode(e.target.value);
      }
    });
  });
  document.getElementById('singleCollage').addEventListener('change', async (e) => {
    await saveSingleCollage(e.target.checked);
  });
  document.getElementById('resizeEnabled').addEventListener('change', async (e) => {
    await saveProcessing({ resizeEnabled: e.target.checked });
  });
  document.getElementById('processingMaxWidth').addEventListener('change', async (e) => {
    await saveProcessing({ maxWidth: e.target.value });
  });
  document.getElementById('processingPercent').addEventListener('change', async (e) => {
    await saveProcessing({ percent: e.target.value, resizeMode: 'percent' });
  });
  document.querySelectorAll('input[name="resizeMode"]').forEach(input => {
    input.addEventListener('change', async (e) => {
      if (e.target.checked) {
        await saveProcessing({ resizeMode: e.target.value });
      }
    });
  });
  document.getElementById('compressEnabled').addEventListener('change', async (e) => {
    await saveProcessing({ compressEnabled: e.target.checked });
  });
  document.getElementById('processingQuality').addEventListener('change', async (e) => {
    await saveProcessing({ quality: e.target.value });
  });
  document.getElementById('ignoreEnabled').addEventListener('change', async (e) => {
    await saveIgnore({ enabled: e.target.checked });
    renderPanelList();
  });
  document.getElementById('ignorePatterns').addEventListener('input', async (e) => {
    await saveIgnore({ patterns: e.target.value });
    renderPanelList();
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  collageSize = await loadCollageSize();
  document.getElementById('collageInput').value = collageSize;
  outputMode = await loadOutputMode();
  const current = document.querySelector(`input[name="outputMode"][value="${outputMode}"]`);
  if (current) current.checked = true;
  forceSingleCollage = await loadSingleCollage();
  document.getElementById('singleCollage').checked = forceSingleCollage;
  processingConfig = await loadProcessing();
  applyProcessingToInputs(processingConfig);
  ignoreConfig = await loadIgnore();
  applyIgnoreToInputs(ignoreConfig);
  setTab('select');

  // Load panels
  await loadPanels();
}

function setTab(tab) {
  currentTab = tab === 'settings' ? 'settings' : 'select';
  const selectionPane = document.getElementById('selectionPane');
  const settingsPane = document.getElementById('settingsPane');
  if (selectionPane) selectionPane.style.display = currentTab === 'select' ? 'block' : 'none';
  if (settingsPane) settingsPane.style.display = currentTab === 'settings' ? 'block' : 'none';
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === currentTab);
  });
}

async function loadPanels() {
  showLoading();

  try {
    // Inject content script if needed and get panels
    const response = await chrome.tabs.sendMessage(currentTabId, { action: 'getPanels' });

    if (response && response.panels && response.panels.length > 0) {
      panels = response.panels;
      pruneSelection();
      lastDashboard = response.dashboard || null;
      renderPanelList();
    } else {
      showNoPanels();
    }
  } catch (error) {
    console.error('Error loading panels:', error);
    const detail = document.getElementById('notGrafanaDetail');
    if (detail) {
      if (String(error).includes('Could not establish connection')) {
        detail.textContent = 'Enable file access or reload the page so the content script can attach.';
      } else {
        detail.textContent = 'Unable to reach the page content. Reload the dashboard and try again.';
      }
    }
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
  setTab(currentTab);
}

function showNotGrafana() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'none';
  document.getElementById('notGrafana').style.display = 'flex';
  document.getElementById('noPanels').style.display = 'none';
  document.getElementById('capturing').style.display = 'none';

  const detail = document.getElementById('notGrafanaDetail');
  if (detail) {
    detail.textContent = 'Enable file access for this extension or open a Grafana dashboard/test page.';
  }
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
  const dash = dashboard || lastDashboard;

  // Update dashboard info
  document.getElementById('dashboardTitle').textContent = dash?.title || 'Dashboard';
  document.getElementById('panelCount').textContent = `${panels.length} panels`;

  const filtered = getFilteredPanels();
  // Render panel list
  const listEl = document.getElementById('panelList');
  listEl.innerHTML = '';

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'message';
    empty.style.padding = '16px';
    empty.innerHTML = '<p>No matching panels</p><span>Adjust your search to see panels</span>';
    listEl.appendChild(empty);
    updateCaptureButton();
    return;
  }

  filtered.forEach(panel => {
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

    if (selectedPanels.has(panel.id)) {
      item.classList.add('selected');
    }

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

function pruneSelection() {
  const ids = new Set(panels.map(p => p.id));
  const before = selectedPanels.size;
  selectedPanels = new Set([...selectedPanels].filter(id => ids.has(id)));

  if (selectedPanels.size !== before) {
    syncSelectionWithContent();
  }
}

function getFilteredPanels() {
  return panels.filter(p => {
    const title = (p.title || '').toLowerCase();
    const id = String(p.id || '').toLowerCase();
    const matchesSearch = !searchTerm || title.includes(searchTerm) || id.includes(searchTerm);
    if (!matchesSearch) return false;

    if (ignoreConfig.enabled && ignoreConfig.patterns) {
      const patterns = ignoreConfig.patterns
        .split('|')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
      if (patterns.length > 0 && patterns.some(pat => title.includes(pat) || id.includes(pat))) {
        return false;
      }
    }

    return true;
  });
}

function updateCaptureButton() {
  const btn = document.getElementById('captureBtn');
  const count = selectedPanels.size;

  btn.disabled = count === 0;
  btn.querySelector('span').textContent = count > 0
    ? `Capture Selected (${count})`
    : 'Capture';
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
      const valid = response.results.filter(r => r && r.dataUrl);
      if (!valid.length) throw new Error('No results returned');

      progressEl.textContent = outputMode === 'clipboard' ? 'Preparing clipboard...' : 'Building collages...';
      const processed = await processImages(valid, processingConfig);
      const outputFormat = processingConfig.compressEnabled ? 'image/jpeg' : 'image/png';
      const outputQuality = processingConfig.compressEnabled ? processingConfig.quality : 0.92;
      const collages = await buildCollages(processed, {
        collageSize,
        dashboard: lastDashboard,
        forceSingleCollage,
        format: outputFormat,
        quality: outputQuality
      });

      if (outputMode === 'clipboard') {
        progressEl.textContent = 'Preparing clipboard...';
        const result = await copyCollagesToClipboard(collages);
        if (result.combined) {
          progressEl.textContent = 'Clipboard supports one item; copied combined collage';
        } else {
          progressEl.textContent = 'Copied collage to clipboard';
        }
      } else {
        const needsZip = collages.length > 1;
        if (needsZip) {
          progressEl.textContent = 'Zipping collages...';
          const zipDataUrl = await buildZipDataUrl(collages, lastDashboard);
          await downloadZip(zipDataUrl, lastDashboard);
          progressEl.textContent = 'Saved ZIP to disk';
        } else {
          for (let i = 0; i < collages.length; i++) {
            const collage = collages[i];
            progressEl.textContent = `Saving ${i + 1}/${collages.length}...`;
            await downloadCollage(collage, i, collages.length);
          }
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
    if (outputMode === 'clipboard') {
      progressEl.textContent = `Clipboard error: ${error?.message || error?.name || 'Permission denied'}`;
    } else {
      progressEl.textContent = 'Error capturing panels';
    }
    setTimeout(() => {
      showContent();
    }, 2000);
  }
}

async function downloadCollage(collage, index, total) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseTitle = sanitizeFilename(
    (lastDashboard?.title || 'grafana_collage').replace(/\s+/g, '_')
  );
  const filename = sanitizeFilename(`${baseTitle}_collage_${index + 1}of${total}_${timestamp}.png`);

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'download',
      dataUrl: collage.dataUrl,
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

async function downloadZip(dataUrl, dashboard) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseTitle = sanitizeFilename(
    (dashboard?.title || 'grafana_collage').replace(/\s+/g, '_')
  );
  const filename = sanitizeFilename(`${baseTitle}_collages_${timestamp}.zip`);

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'download',
      dataUrl,
      filename
    }, (response) => {
      if (response && response.error) {
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

async function buildZipDataUrl(collages, dashboard) {
  const files = collages.map((collage, idx) => {
    const baseTitle = sanitizeFilename((dashboard?.title || 'grafana_collage').replace(/\s+/g, '_'));
    const name = `${baseTitle}_${idx + 1}.png`;
    return { name, bytes: dataUrlToBytes(collage.dataUrl) };
  });

  const zipBytes = createZip(files);
  const base64 = bytesToBase64(zipBytes);
  return `data:application/zip;base64,${base64}`;
}

async function loadCollageSize() {
  try {
    const result = await chrome.storage.sync.get({ collageSize: DEFAULT_COLLAGE_SIZE });
    return normalizeCollageSize(result.collageSize);
  } catch (error) {
    return DEFAULT_COLLAGE_SIZE;
  }
}

async function saveCollageSize(value) {
  collageSize = normalizeCollageSize(value);
  document.getElementById('collageInput').value = collageSize;
  try {
    await chrome.storage.sync.set({ collageSize });
  } catch (error) {
    // Ignore storage errors silently
  }
}

function normalizeCollageSize(value) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 1) return DEFAULT_COLLAGE_SIZE;
  return Math.min(num, 10);
}

async function loadSingleCollage() {
  try {
    const result = await chrome.storage.sync.get({ singleCollage: DEFAULT_SINGLE_COLLAGE });
    return Boolean(result.singleCollage);
  } catch (error) {
    return DEFAULT_SINGLE_COLLAGE;
  }
}

async function saveSingleCollage(value) {
  forceSingleCollage = Boolean(value);
  try {
    await chrome.storage.sync.set({ singleCollage: forceSingleCollage });
  } catch (error) {
    // Ignore storage errors silently
  }
}

async function loadIgnore() {
  try {
    const stored = await chrome.storage.sync.get({ ignoreConfig: DEFAULT_IGNORE });
    return normalizeIgnore(stored.ignoreConfig);
  } catch (error) {
    return { ...DEFAULT_IGNORE };
  }
}

async function saveIgnore(partial) {
  ignoreConfig = normalizeIgnore({ ...ignoreConfig, ...partial });
  applyIgnoreToInputs(ignoreConfig);
  try {
    await chrome.storage.sync.set({ ignoreConfig });
  } catch (error) {
    // Ignore storage errors silently
  }
}

function normalizeIgnore(config) {
  const enabled = Boolean(config?.enabled);
  const patterns = (config?.patterns || '').toString();
  return { enabled, patterns };
}

function applyIgnoreToInputs(config) {
  const enabledInput = document.getElementById('ignoreEnabled');
  const patternsInput = document.getElementById('ignorePatterns');
  if (enabledInput) enabledInput.checked = config.enabled;
  if (patternsInput) patternsInput.value = config.patterns || '';
}

async function loadProcessing() {
  try {
    const stored = await chrome.storage.sync.get({ processingConfig: DEFAULT_PROCESSING });
    return normalizeProcessing(stored.processingConfig);
  } catch (error) {
    return { ...DEFAULT_PROCESSING };
  }
}

async function saveProcessing(partial) {
  processingConfig = normalizeProcessing({ ...processingConfig, ...partial });
  applyProcessingToInputs(processingConfig);
  try {
    await chrome.storage.sync.set({ processingConfig });
  } catch (error) {
    // Ignore storage errors silently
  }
}

function normalizeProcessing(config) {
  const resizeEnabled = Boolean(config?.resizeEnabled);
  let maxWidth = parseInt(config?.maxWidth, 10);
  if (!Number.isFinite(maxWidth) || maxWidth < 200) maxWidth = DEFAULT_PROCESSING.maxWidth;
  if (maxWidth > 4000) maxWidth = 4000;
  const resizeMode = ['maxWidth', 'percent'].includes(config?.resizeMode) ? config.resizeMode : DEFAULT_PROCESSING.resizeMode;
  let percent = parseInt(config?.percent, 10);
  if (!Number.isFinite(percent) || percent < 10) percent = DEFAULT_PROCESSING.percent;
  if (percent > 200) percent = 200;
  const compressEnabled = Boolean(config?.compressEnabled);
  let quality = parseFloat(config?.quality);
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1) quality = DEFAULT_PROCESSING.quality;

  return { resizeEnabled, maxWidth, resizeMode, percent, compressEnabled, quality };
}

function applyProcessingToInputs(config) {
  const resizeInput = document.getElementById('resizeEnabled');
  const compressInput = document.getElementById('compressEnabled');
  const maxWidthInput = document.getElementById('processingMaxWidth');
  const percentInput = document.getElementById('processingPercent');
  const qualityInput = document.getElementById('processingQuality');
  const modeRadio = document.querySelector(`input[name="resizeMode"][value="${config.resizeMode}"]`);
  if (resizeInput) resizeInput.checked = config.resizeEnabled;
  if (compressInput) compressInput.checked = config.compressEnabled;
  if (maxWidthInput) {
    maxWidthInput.value = config.maxWidth;
    maxWidthInput.disabled = !config.resizeEnabled || config.resizeMode !== 'maxWidth';
  }
  if (percentInput) {
    percentInput.value = config.percent;
    percentInput.disabled = !config.resizeEnabled || config.resizeMode !== 'percent';
  }
  if (modeRadio) modeRadio.checked = true;
  if (qualityInput) {
    qualityInput.value = config.quality;
    qualityInput.disabled = !config.compressEnabled;
  }
}

async function copyCollagesToClipboard(collages) {
  if (!navigator.clipboard || !navigator.clipboard.write) {
    throw new Error('Clipboard API not available');
  }

  await ensureClipboardPermission();

  let target = collages;
  let combined = false;
  if (collages.length > 1) {
    const merged = await mergeCollagesIntoOne(collages);
    target = [merged];
    combined = true;
  }

  const items = await Promise.all(target.map(async (collage) => {
    const blob = dataUrlToBlob(collage.dataUrl);
    return new ClipboardItem({ 'image/png': blob });
  }));

  // Clipboard.write in many browsers only keeps the last entry; merge above ensures single item.
  await navigator.clipboard.write(items);
  return { combined };
}

async function ensureClipboardPermission() {
  if (!navigator.permissions || !navigator.permissions.query) return;

  try {
    const status = await navigator.permissions.query({ name: 'clipboard-write' });
    if (status.state === 'denied') {
      throw new Error('Clipboard permission denied by browser');
    }
  } catch (error) {
    // Ignore query errors; write() will surface issues
  }
}

function dataUrlToBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}

async function loadOutputMode() {
  try {
    const result = await chrome.storage.sync.get({ outputMode: DEFAULT_OUTPUT_MODE });
    return ['disk', 'clipboard'].includes(result.outputMode) ? result.outputMode : DEFAULT_OUTPUT_MODE;
  } catch (error) {
    return DEFAULT_OUTPUT_MODE;
  }
}

async function saveOutputMode(value) {
  outputMode = ['disk', 'clipboard'].includes(value) ? value : DEFAULT_OUTPUT_MODE;
  try {
    await chrome.storage.sync.set({ outputMode });
  } catch (error) {
    // Ignore storage errors silently
  }
}

function dataUrlToBytes(dataUrl) {
  const arr = dataUrl.split(',');
  const bstr = atob(arr[1]);
  const len = bstr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bstr.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for collage'));
    img.src = dataUrl;
  });
}

async function buildCollages(results, { collageSize, dashboard, forceSingleCollage, format = 'image/png', quality = 0.92 }) {
  const size = Math.max(1, collageSize || 1);
  const groups = [];
  const step = forceSingleCollage ? results.length : size;
  for (let i = 0; i < results.length; i += step) {
    groups.push(results.slice(i, i + step));
  }

  const baseTitle = dashboard?.title || 'Grafana';

  return Promise.all(groups.map(async (group, index) => {
    const images = await Promise.all(group.map(item => loadImage(item.dataUrl)));
    const maxWidth = Math.max(...images.map(img => img.width));
    const totalHeight = images.reduce((sum, img) => sum + img.height, 0);
    const padding = 16;
    const canvasWidth = maxWidth + padding * 2;
    const canvasHeight = totalHeight + padding * (images.length + 1);

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#181b1f';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    let y = padding;
    images.forEach((img) => {
      const x = padding + Math.floor((maxWidth - img.width) / 2);
      ctx.drawImage(img, x, y);
      y += img.height + padding;
    });

    const dataUrl = canvas.toDataURL(format, quality);
    return {
      dataUrl,
      index,
      total: groups.length,
      title: baseTitle
    };
  }));
}

async function mergeCollagesIntoOne(collages, { format = 'image/png', quality = 0.92 } = {}) {
  const images = await Promise.all(collages.map(c => loadImage(c.dataUrl)));
  const maxWidth = Math.max(...images.map(img => img.width));
  const totalHeight = images.reduce((sum, img) => sum + img.height, 0);
  const padding = 16;
  const canvasWidth = maxWidth + padding * 2;
  const canvasHeight = totalHeight + padding * (images.length + 1);

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#181b1f';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  let y = padding;
  images.forEach(img => {
    const x = padding + Math.floor((maxWidth - img.width) / 2);
    ctx.drawImage(img, x, y);
    y += img.height + padding;
  });

  return {
    dataUrl: canvas.toDataURL(format, quality),
    index: 0,
    total: 1,
    title: collages[0]?.title || 'Grafana'
  };
}

async function processImages(results, config) {
  if (!config.resizeEnabled && !config.compressEnabled) return results;

  return Promise.all(results.map(async (result) => {
    try {
      const img = await loadImage(result.dataUrl);
      let width = img.width;
      let height = img.height;
      if (config.resizeEnabled) {
        let scale = 1;
        if (config.resizeMode === 'percent') {
          scale = Math.min(2, Math.max(0.1, config.percent / 100));
        } else if (config.maxWidth > 0) {
          scale = Math.min(1, config.maxWidth / img.width);
        }
        width = Math.round(img.width * scale);
        height = Math.round(img.height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const format = config.compressEnabled ? 'image/jpeg' : 'image/png';
      const quality = config.compressEnabled ? config.quality : 0.92;
      const dataUrl = canvas.toDataURL(format, quality);
      return { ...result, dataUrl };
    } catch (error) {
      return result;
    }
  }));
}

function createZip(files) {
  const encoder = new TextEncoder();
  const central = [];
  let offset = 0;
  const fileData = [];
  const now = new Date();
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | (now.getSeconds() / 2 | 0);
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1 & 0xf) << 5) | (now.getDate() & 0x1f);

  files.forEach(file => {
    const nameBytes = encoder.encode(file.name);
    const data = file.bytes;
    const crc = crc32(data);
    const size = data.length;
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // local header signature
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0, true); // flags
    view.setUint16(8, 0, true); // compression (store)
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true); // extra length
    header.set(nameBytes, 30);

    fileData.push(header, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cview = new DataView(centralHeader.buffer);
    cview.setUint32(0, 0x02014b50, true); // central signature
    cview.setUint16(4, 0x031E, true); // version made by
    cview.setUint16(6, 20, true); // version needed
    cview.setUint16(8, 0, true); // flags
    cview.setUint16(10, 0, true); // compression
    cview.setUint16(12, dosTime, true);
    cview.setUint16(14, dosDate, true);
    cview.setUint32(16, crc, true);
    cview.setUint32(20, size, true);
    cview.setUint32(24, size, true);
    cview.setUint16(28, nameBytes.length, true);
    cview.setUint16(30, 0, true); // extra len
    cview.setUint16(32, 0, true); // comment len
    cview.setUint16(34, 0, true); // disk start
    cview.setUint16(36, 0, true); // internal attrs
    cview.setUint32(38, 0, true); // external attrs
    cview.setUint32(42, offset, true); // local offset
    centralHeader.set(nameBytes, 46);

    central.push(centralHeader);
    offset += header.length + data.length;
  });

  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const centralOffset = offset;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); // end of central dir signature
  endView.setUint16(4, 0, true); // disk number
  endView.setUint16(6, 0, true); // start disk
  endView.setUint16(8, files.length, true); // entries this disk
  endView.setUint16(10, files.length, true); // entries total
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true); // comment length

  const totalSize = offset + centralSize + end.length;
  const out = new Uint8Array(totalSize);
  let cursor = 0;
  fileData.forEach(chunk => {
    out.set(chunk, cursor);
    cursor += chunk.length;
  });
  central.forEach(chunk => {
    out.set(chunk, cursor);
    cursor += chunk.length;
  });
  out.set(end, cursor);
  return out;
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();
