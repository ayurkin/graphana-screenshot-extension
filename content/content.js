// Grafana Panel Screenshot - Content Script

(function() {
  'use strict';

  // Panel selectors for different Grafana versions
  const PANEL_SELECTORS = {
    // Modern Grafana (React-based)
    modern: '[data-panelid]',
    panelTitle: '[data-testid*="panel-title"], .panel-title-text, h6',
    panelHeader: '[data-testid*="Panel header"]',
    // Legacy Grafana (Angular-based)
    legacy: '.panel-container',
    legacyTitle: '.panel-title-text'
  };

  // State
  let selectionMode = false;
  let selectedPanels = new Set();
  let overlayContainer = null;
  let highlightLayer = null;
  let cachedPanelElements = new Map(); // panelId -> element
  let positionUpdateScheduled = false;
  let panelRefreshTimeout = null;
  let mutationObserver = null;
  let monitoringStarted = false;
  let lastPanelSignature = '';
  let html2canvasReadyPromise = null;
  let positionTrackerId = null;

  // Detect all panels on the page
  function detectPanels() {
    const panels = [];

    // Try modern Grafana first
    const modernPanels = document.querySelectorAll(PANEL_SELECTORS.modern);

    if (modernPanels.length > 0) {
      modernPanels.forEach(panel => {
        const id = panel.getAttribute('data-panelid');
        const titleEl = panel.querySelector('h6') ||
                       panel.querySelector('[data-testid*="panel-title"]') ||
                       panel.querySelector('.panel-title-text');
        const title = titleEl?.textContent?.trim() || `Panel ${id}`;

        // Skip row panels (collapsible sections)
        if (panel.querySelector('[data-testid*="dashboard-row"]')) {
          return;
        }

        panels.push({
          id: id,
          title: title,
          element: panel,
          rect: panel.getBoundingClientRect()
        });
      });
    }

    // Fallback to legacy Grafana
    if (panels.length === 0) {
      const legacyPanels = document.querySelectorAll(PANEL_SELECTORS.legacy);
      legacyPanels.forEach((panel, index) => {
        const titleEl = panel.querySelector(PANEL_SELECTORS.legacyTitle);
        const title = titleEl?.textContent?.trim() || `Panel ${index + 1}`;

        panels.push({
          id: `legacy-${index}`,
          title: title,
          element: panel,
          rect: panel.getBoundingClientRect()
        });
      });
    }

    return panels;
  }

  // Get dashboard info
  function getDashboardInfo() {
    // Try to get dashboard title
    const titleEl = document.querySelector('[aria-label="Dashboard title"]') ||
                   document.querySelector('.dashboard-title') ||
                   document.querySelector('h1');

    // Try to get time range
    const timeRangeEl = document.querySelector('[data-testid*="time-range"]') ||
                       document.querySelector('.navbar-page-btn--narrow');

    return {
      title: titleEl?.textContent?.trim() || document.title,
      timeRange: timeRangeEl?.textContent?.trim() || '',
      url: window.location.href
    };
  }

  function ensureMonitoringStarted() {
    if (monitoringStarted || !isGrafanaPage()) return;

    monitoringStarted = true;

    const handleViewportChange = () => {
      schedulePositionUpdate();
      schedulePanelRefresh();
    };

    window.addEventListener('scroll', handleViewportChange, { passive: true, capture: true });
    window.addEventListener('resize', handleViewportChange, true);

    mutationObserver = new MutationObserver(() => schedulePanelRefresh());
    if (document.body) {
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    schedulePanelRefresh(true);
  }

  function schedulePanelRefresh(force = false) {
    if (!monitoringStarted) return;

    if (force) {
      refreshPanelsAndHighlights({ force: true });
      return;
    }

    if (panelRefreshTimeout) {
      clearTimeout(panelRefreshTimeout);
    }

    panelRefreshTimeout = setTimeout(() => {
      panelRefreshTimeout = null;
      refreshPanelsAndHighlights({});
    }, 150);
  }

  function refreshPanelsAndHighlights({ force = false, emitUpdate = true } = {}) {
    const panels = detectPanels();
    const signature = panels.map(p => `${p.id}:${p.title}`).join('|');
    const unchanged = signature === lastPanelSignature && !force;

    lastPanelSignature = signature;
    cachedPanelElements.clear();
    panels.forEach(panel => cachedPanelElements.set(panel.id, panel.element));

    // Drop selections that no longer exist
    const currentIds = new Set(panels.map(p => p.id));
    selectedPanels = new Set(Array.from(selectedPanels).filter(id => currentIds.has(id)));

    if (overlayContainer) {
      if (unchanged) {
        schedulePositionUpdate();
      } else {
        renderHighlights(panels);
      }
    }

    if (emitUpdate && !unchanged) {
      notifyPanelList(panels);
    }

    return panels;
  }

  function notifyPanelList(panels) {
    const dashboard = getDashboardInfo();

    try {
      chrome.runtime.sendMessage({
        action: 'panelsUpdated',
        panels: panels.map(p => ({ id: p.id, title: p.title })),
        dashboard
      });
    } catch (error) {
      // No listeners available
    }
  }

  // Create selection overlay
  function createOverlay() {
    if (overlayContainer) return;

    overlayContainer = document.createElement('div');
    overlayContainer.id = 'grafana-screenshot-overlay';
    overlayContainer.innerHTML = `
      <div class="gss-toolbar">
        <span class="gss-title">Select Panels</span>
        <span class="gss-count">0 selected</span>
        <button class="gss-btn gss-capture-btn" disabled>Capture</button>
        <button class="gss-btn gss-cancel-btn">Cancel</button>
      </div>
      <div class="gss-highlight-layer"></div>
    `;
    document.body.appendChild(overlayContainer);

    highlightLayer = overlayContainer.querySelector('.gss-highlight-layer');

    // Add event listeners
    overlayContainer.querySelector('.gss-capture-btn').addEventListener('click', captureSelected);
    overlayContainer.querySelector('.gss-cancel-btn').addEventListener('click', exitSelectionMode);

    // Highlight all panels
    refreshPanelsAndHighlights({ emitUpdate: false, force: true });
    startPositionTracker();
  }

  function renderHighlights(panels) {
    if (!highlightLayer) return;

    highlightLayer.innerHTML = '';

    panels.forEach(panel => {
      const highlight = createHighlightElement(panel);
      highlightLayer.appendChild(highlight);
    });

    updateSelectionCount();
    schedulePositionUpdate();
  }

  function createHighlightElement(panel) {
    const highlight = document.createElement('div');
    highlight.className = 'gss-panel-highlight';
    highlight.dataset.panelId = panel.id;

    const rect = panel.element.getBoundingClientRect();
    highlight.style.top = `${rect.top}px`;
    highlight.style.left = `${rect.left}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;

    if (selectedPanels.has(panel.id)) {
      highlight.classList.add('selected');
    }

    // Add panel title tooltip
    highlight.title = panel.title;

    // Click handler
    highlight.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanelSelection(panel.id, highlight);
    });

    return highlight;
  }

  function schedulePositionUpdate() {
    if (!overlayContainer || positionUpdateScheduled) return;

    positionUpdateScheduled = true;
    requestAnimationFrame(() => {
      positionUpdateScheduled = false;
      updateHighlightPositions();
    });
  }

  function updateHighlightPositions() {
    if (!overlayContainer) return;

    const highlights = overlayContainer.querySelectorAll('.gss-panel-highlight');

    highlights.forEach(highlight => {
      const panelId = highlight.dataset.panelId;
      const element = cachedPanelElements.get(panelId);

      if (element) {
        const rect = element.getBoundingClientRect();
        highlight.style.top = `${rect.top}px`;
        highlight.style.left = `${rect.left}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
      }
    });
  }

  // Toggle panel selection
  function togglePanelSelection(panelId, highlightEl) {
    if (selectedPanels.has(panelId)) {
      selectedPanels.delete(panelId);
      highlightEl.classList.remove('selected');
    } else {
      selectedPanels.add(panelId);
      highlightEl.classList.add('selected');
    }

    updateSelectionCount();
  }

  // Update selection count in toolbar
  function updateSelectionCount() {
    if (!overlayContainer) return;

    const countEl = overlayContainer.querySelector('.gss-count');
    const captureBtn = overlayContainer.querySelector('.gss-capture-btn');
    const count = selectedPanels.size;

    countEl.textContent = `${count} selected`;
    captureBtn.disabled = count === 0;
    captureBtn.textContent = count > 0 ? `Capture (${count})` : 'Capture';
  }

  // Enter selection mode
  function enterSelectionMode() {
    ensureMonitoringStarted();
    schedulePanelRefresh(true);

    selectionMode = true;
    selectedPanels.clear();
    createOverlay();
    document.body.classList.add('gss-selection-mode');
  }

  // Exit selection mode
  function exitSelectionMode() {
    selectionMode = false;
    selectedPanels.clear();
    cachedPanelElements.clear();
    stopPositionTracker();

    if (overlayContainer) {
      overlayContainer.remove();
      overlayContainer = null;
    }

    highlightLayer = null;
    positionUpdateScheduled = false;

    document.body.classList.remove('gss-selection-mode');
  }

  // Capture selected panels
  async function captureSelected() {
    if (selectedPanels.size === 0) return;

    const panels = refreshPanelsAndHighlights({ emitUpdate: false, force: true })
      .filter(p => selectedPanels.has(p.id));

    // Hide overlay temporarily for clean screenshots
    if (overlayContainer) {
      overlayContainer.style.display = 'none';
    }

    // Send message to background script to start capture
    chrome.runtime.sendMessage({
      action: 'captureSelectedPanels',
      panels: panels.map(p => ({
        id: p.id,
        title: p.title,
        rect: {
          top: p.rect.top,
          left: p.rect.left,
          width: p.rect.width,
          height: p.rect.height
        }
      })),
      dashboard: getDashboardInfo()
    });

    // Show overlay again
    setTimeout(() => {
      if (overlayContainer) {
        overlayContainer.style.display = '';
      }
    }, 500);
  }

  function startPositionTracker() {
    if (positionTrackerId) return;

    const step = () => {
      if (!overlayContainer) {
        positionTrackerId = null;
        return;
      }
      updateHighlightPositions();
      positionTrackerId = requestAnimationFrame(step);
    };

    positionTrackerId = requestAnimationFrame(step);
  }

  function stopPositionTracker() {
    if (positionTrackerId) {
      cancelAnimationFrame(positionTrackerId);
      positionTrackerId = null;
    }
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'getPanels':
        ensureMonitoringStarted();
        const panels = refreshPanelsAndHighlights({ emitUpdate: false, force: true });
        const dashboard = getDashboardInfo();
        sendResponse({
          panels: panels.map(p => ({ id: p.id, title: p.title })),
          dashboard: dashboard
        });
        break;

      case 'enterSelectionMode':
        enterSelectionMode();
        sendResponse({ success: true });
        break;

      case 'exitSelectionMode':
        exitSelectionMode();
        sendResponse({ success: true });
        break;

      case 'capturePanel': {
        ensureMonitoringStarted();
        const panel = refreshPanelsAndHighlights({ emitUpdate: false }).find(p => p.id === message.panelId);
        if (!panel) {
          sendResponse({ error: 'Panel not found' });
          break;
        }

        (async () => {
          try {
            const dataUrl = await capturePanelElement(panel);
            if (!dataUrl) throw new Error('Capture failed');
            sendResponse({ dataUrl, title: panel.title });
          } catch (error) {
            console.error('Error capturing panel:', error);
            sendResponse({ error: error.message });
          }
        })();
        return true; // Keep channel open for async response
      }

      case 'capturePanels': {
        const panelIds = message.panelIds || [];
        ensureMonitoringStarted();
        const allPanels = refreshPanelsAndHighlights({ emitUpdate: false });
        const toCapture = allPanels.filter(p => panelIds.includes(p.id));

        (async () => {
          try {
            await ensureHtml2Canvas();
            const results = await Promise.all(
              toCapture.map(async p => ({
                dataUrl: await capturePanelElement(p),
                title: p.title,
                id: p.id
              }))
            );
            sendResponse({ results });
          } catch (error) {
            console.error('Error capturing panels:', error);
            sendResponse({ error: error.message, results: [] });
          }
        })();
        return true; // Keep channel open for async response
      }

      case 'setSelectedPanels':
        selectedPanels = new Set(message.panelIds);
        // Update highlights if in selection mode
        if (overlayContainer) {
          overlayContainer.querySelectorAll('.gss-panel-highlight').forEach(el => {
            if (selectedPanels.has(el.dataset.panelId)) {
              el.classList.add('selected');
            } else {
              el.classList.remove('selected');
            }
          });
          updateSelectionCount();
        }
        sendResponse({ success: true });
        break;
    }

    return false;
  });

  // Capture a panel element using html2canvas
  async function capturePanelElement(panel) {
    await ensureHtml2Canvas();

    try {
      const canvas = await html2canvas(panel.element, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#181b1f',
        scale: 2, // Higher quality
        logging: false,
        onclone: (clonedDoc) => {
          // Remove any selection overlays from the clone
          const overlays = clonedDoc.querySelectorAll('#grafana-screenshot-overlay, .gss-panel-highlight');
          overlays.forEach(el => el.remove());
        }
      });

      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('Error capturing panel:', error);
      throw error;
    }
  }

  // Load html2canvas library with single-flight semantics
  function ensureHtml2Canvas() {
    if (typeof html2canvas !== 'undefined') return Promise.resolve(html2canvas);
    if (html2canvasReadyPromise) return html2canvasReadyPromise;

    // html2canvas is shipped as a declared content script (manifest). If it's missing,
    // surface an explicit error so the user can reload the extension.
    html2canvasReadyPromise = Promise.reject(new Error('html2canvas is not available in this page. Reload the extension and retry.'));
    return html2canvasReadyPromise;
  }

  // Check if we're on a Grafana page
  function isGrafanaPage() {
    return document.querySelector('[data-panelid]') !== null ||
           document.querySelector('.panel-container') !== null ||
           window.location.href.includes('grafana');
  }

  // Initialize
  console.log('Grafana Panel Screenshot: Content script loaded');
  ensureMonitoringStarted();

})();
