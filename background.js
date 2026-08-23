/**
 * background.js
 *
 * MV3 service worker. Responsibilities:
 *   - Receive console-issue / performance-data messages relayed from
 *     content.js (which itself relays them from injected.js running in
 *     the page's main world).
 *   - Observe network requests for the active tab via chrome.webRequest
 *     and record failures (4xx/5xx status codes and hard network errors).
 *   - Reset a tab's captured diagnostics whenever that tab starts a new
 *     top-level navigation, so each report reflects the current page.
 *   - Serve the popup's requests for a tab's data, a "clear" action, and
 *     the compiled export report.
 *
 * Per-tab diagnostics are kept in chrome.storage.session, which survives
 * service-worker restarts within a browser session but never touches
 * disk, so no page data outlives the browser session.
 *
 * All data *processing* (classification, summarization, report shaping)
 * is delegated to the pure functions in lib/, loaded below via
 * importScripts so they run identically to how they run under the Node
 * test runner.
 */

importScripts('lib/performance.js', 'lib/requests.js', 'lib/report.js');

const { compileReport, computeBadgeCounts } = self.BDC;

const MAX_ITEMS_PER_TAB = 500;

function storageKey(tabId) {
  return `bdc-tab-${tabId}`;
}

function emptyTabData() {
  return {
    consoleIssues: [],
    requests: [],
    navigationEntries: [],
    resourceEntries: [],
    tab: { url: '', title: '' },
  };
}

async function getTabData(tabId) {
  const key = storageKey(tabId);
  const result = await chrome.storage.session.get(key);
  return result[key] || emptyTabData();
}

async function setTabData(tabId, data) {
  const key = storageKey(tabId);
  await chrome.storage.session.set({ [key]: data });
}

async function clearTabData(tabId) {
  const key = storageKey(tabId);
  await chrome.storage.session.set({ [key]: emptyTabData() });
}

function capList(list) {
  if (list.length > MAX_ITEMS_PER_TAB) {
    return list.slice(list.length - MAX_ITEMS_PER_TAB);
  }
  return list;
}

async function appendConsoleIssue(tabId, issue) {
  const data = await getTabData(tabId);
  data.consoleIssues = capList([...data.consoleIssues, issue]);
  await setTabData(tabId, data);
}

async function appendRequestRecord(tabId, record) {
  const data = await getTabData(tabId);
  data.requests = capList([...data.requests, record]);
  await setTabData(tabId, data);
}

async function storePerformanceData(tabId, navigationEntries, resourceEntries) {
  const data = await getTabData(tabId);
  data.navigationEntries = navigationEntries || [];
  data.resourceEntries = resourceEntries || [];
  await setTabData(tabId, data);
}

async function updateTabInfo(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const data = await getTabData(tabId);
    data.tab = { url: tab.url || '', title: tab.title || '' };
    await setTabData(tabId, data);
  } catch (err) {
    // Tab may no longer exist; nothing to update.
  }
}

// --- Messages from content scripts (injected.js -> content.js -> here) and popup.js ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;

  // Messages relayed from a page's content script carry sender.tab.
  if (sender && sender.tab && typeof sender.tab.id === 'number') {
    const tabId = sender.tab.id;

    if (message.type === 'console-issue') {
      appendConsoleIssue(tabId, {
        level: message.level,
        message: message.message,
        source: message.source,
        timeStamp: message.timeStamp,
      });
      return undefined;
    }

    if (message.type === 'performance-data') {
      storePerformanceData(tabId, message.navigationEntries, message.resourceEntries);
      return undefined;
    }
  }

  // Messages from popup.js target an explicit tabId.
  if (message.type === 'get-diagnostics' && typeof message.tabId === 'number') {
    getTabData(message.tabId).then((data) => {
      const badges = computeBadgeCounts(data);
      sendResponse({ ok: true, data, badges });
    });
    return true; // keep the message channel open for the async response
  }

  if (message.type === 'clear-diagnostics' && typeof message.tabId === 'number') {
    clearTabData(message.tabId).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'export-report' && typeof message.tabId === 'number') {
    getTabData(message.tabId).then((data) => {
      const report = compileReport({
        tab: data.tab,
        consoleIssues: data.consoleIssues,
        requests: data.requests,
        navigationEntries: data.navigationEntries,
        resourceEntries: data.resourceEntries,
      });
      sendResponse({ ok: true, report });
    });
    return true;
  }

  return undefined;
});

// --- Network failure capture ---

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    appendRequestRecord(details.tabId, {
      url: details.url,
      method: details.method,
      statusCode: details.statusCode,
      error: null,
      timeStamp: details.timeStamp,
    });
  },
  { urls: ['http://*/*', 'https://*/*'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId < 0) return;
    appendRequestRecord(details.tabId, {
      url: details.url,
      method: details.method,
      statusCode: null,
      error: details.error,
      timeStamp: details.timeStamp,
    });
  },
  { urls: ['http://*/*', 'https://*/*'] }
);

// --- Reset per-tab data on new top-level navigations ---

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  clearTabData(details.tabId);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  updateTabInfo(details.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(storageKey(tabId));
});
