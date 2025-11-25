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
  let animationFrameId = null;
  let cachedPanelElements = new Map(); // panelId -> element

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
    `;
    document.body.appendChild(overlayContainer);

    // Add event listeners
    overlayContainer.querySelector('.gss-capture-btn').addEventListener('click', captureSelected);
    overlayContainer.querySelector('.gss-cancel-btn').addEventListener('click', exitSelectionMode);

    // Highlight all panels
    highlightPanels();

    // Start continuous position updates (no scroll event interception)
    startPositionUpdates();
  }

  // Highlight panels for selection
  function highlightPanels() {
    const panels = detectPanels();
    cachedPanelElements.clear();

    panels.forEach(panel => {
      // Cache the element for position updates
      cachedPanelElements.set(panel.id, panel.element);

      const highlight = document.createElement('div');
      highlight.className = 'gss-panel-highlight';
      highlight.dataset.panelId = panel.id;

      // Position the highlight
      const rect = panel.element.getBoundingClientRect();
      highlight.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        z-index: 10000;
      `;

      // Add panel title tooltip
      highlight.title = panel.title;

      // Click handler
      highlight.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePanelSelection(panel.id, highlight);
      });

      overlayContainer.appendChild(highlight);
    });
  }

  // Start continuous position updates using requestAnimationFrame
  function startPositionUpdates() {
    function update() {
      if (!overlayContainer) {
        animationFrameId = null;
        return;
      }

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

      animationFrameId = requestAnimationFrame(update);
    }

    animationFrameId = requestAnimationFrame(update);
  }

  // Stop position updates
  function stopPositionUpdates() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
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
    const countEl = overlayContainer.querySelector('.gss-count');
    const captureBtn = overlayContainer.querySelector('.gss-capture-btn');
    const count = selectedPanels.size;

    countEl.textContent = `${count} selected`;
    captureBtn.disabled = count === 0;
    captureBtn.textContent = count > 0 ? `Capture (${count})` : 'Capture';
  }

  // Enter selection mode
  function enterSelectionMode() {
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

    // Stop position updates
    stopPositionUpdates();

    if (overlayContainer) {
      overlayContainer.remove();
      overlayContainer = null;
    }

    document.body.classList.remove('gss-selection-mode');
  }

  // Capture selected panels
  async function captureSelected() {
    if (selectedPanels.size === 0) return;

    const panels = detectPanels().filter(p => selectedPanels.has(p.id));

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

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'getPanels':
        const panels = detectPanels();
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

      case 'capturePanel':
        // Capture a specific panel by ID
        const panel = detectPanels().find(p => p.id === message.panelId);
        if (panel) {
          capturePanelElement(panel).then(dataUrl => {
            sendResponse({ dataUrl: dataUrl, title: panel.title });
          });
          return true; // Keep channel open for async response
        }
        sendResponse({ error: 'Panel not found' });
        break;

      case 'capturePanels':
        // Capture multiple panels by IDs
        const panelIds = message.panelIds;
        const allPanels = detectPanels();
        const toCapture = allPanels.filter(p => panelIds.includes(p.id));

        Promise.all(toCapture.map(p => capturePanelElement(p)))
          .then(results => {
            sendResponse({
              results: results.map((dataUrl, i) => ({
                dataUrl: dataUrl,
                title: toCapture[i].title,
                id: toCapture[i].id
              }))
            });
          });
        return true; // Keep channel open for async response
        break;

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
    // Load html2canvas if not already loaded
    if (typeof html2canvas === 'undefined') {
      await loadHtml2Canvas();
    }

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
      return null;
    }
  }

  // Load html2canvas library
  function loadHtml2Canvas() {
    return new Promise((resolve, reject) => {
      if (typeof html2canvas !== 'undefined') {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('lib/html2canvas.min.js');
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Check if we're on a Grafana page
  function isGrafanaPage() {
    return document.querySelector('[data-panelid]') !== null ||
           document.querySelector('.panel-container') !== null ||
           window.location.href.includes('grafana');
  }

  // Initialize
  console.log('Grafana Panel Screenshot: Content script loaded');

})();
