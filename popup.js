/**
 * popup.js
 *
 * Drives the popup UI. Fetches the active tab's captured diagnostics
 * from the background service worker, renders the three panels
 * (Console Issues, Failed Requests, Performance), and wires up the
 * Clear and Export Report buttons.
 *
 * Rendering/formatting here is presentation-only glue; the actual data
 * classification (status buckets, slowest resources, report shape)
 * comes from the pure lib/ functions loaded as classic scripts above
 * this one, exposed on window.BDC.
 */

(function () {
  const { getStatusClass } = window.BDC;

  let currentTab = null;

  const els = {
    tabUrl: document.getElementById('tabUrl'),
    badgeConsole: document.getElementById('badgeConsole'),
    badgeRequests: document.getElementById('badgeRequests'),
    consoleList: document.getElementById('consoleList'),
    consoleEmpty: document.getElementById('consoleEmpty'),
    requestsList: document.getElementById('requestsList'),
    requestsEmpty: document.getElementById('requestsEmpty'),
    perfLoad: document.getElementById('perfLoad'),
    perfDcl: document.getElementById('perfDcl'),
    perfTtfb: document.getElementById('perfTtfb'),
    perfList: document.getElementById('perfList'),
    perfEmpty: document.getElementById('perfEmpty'),
    statusMsg: document.getElementById('statusMsg'),
    clearBtn: document.getElementById('clearBtn'),
    exportBtn: document.getElementById('exportBtn'),
  };

  function setStatus(msg, timeout) {
    els.statusMsg.textContent = msg;
    if (timeout) {
      setTimeout(() => {
        if (els.statusMsg.textContent === msg) els.statusMsg.textContent = '';
      }, timeout);
    }
  }

  function formatMs(value) {
    if (value === null || value === undefined) return '–';
    return `${Math.round(value)} ms`;
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderConsoleIssues(consoleIssues) {
    const items = (consoleIssues && consoleIssues.items) || [];
    els.consoleList.innerHTML = '';
    els.consoleEmpty.style.display = items.length ? 'none' : 'block';

    // Newest first.
    [...items].reverse().forEach((issue) => {
      const li = document.createElement('li');
      li.className = `item level-${issue.level}`;
      li.innerHTML = `
        <div class="item-top">
          <span class="item-tag level-${issue.level}">${issue.level}</span>
          <span class="item-time">${formatTime(issue.timeStamp)}</span>
        </div>
        <div class="item-message">${escapeHtml(issue.message)}</div>
      `;
      els.consoleList.appendChild(li);
    });
  }

  function pillClassForStatusClass(statusClass) {
    if (statusClass === 'clientError') return 'client';
    if (statusClass === 'serverError') return 'server';
    return 'network';
  }

  function renderFailedRequests(networkRequests) {
    const failures = (networkRequests && networkRequests.failures) || [];
    els.requestsList.innerHTML = '';
    els.requestsEmpty.style.display = failures.length ? 'none' : 'block';

    [...failures].reverse().forEach((req) => {
      const li = document.createElement('li');
      li.className = 'item level-error';
      const statusLabel = req.error
        ? req.error
        : `${req.statusCode} ${getStatusClass(req.statusCode)}`;
      li.innerHTML = `
        <div class="item-top">
          <span class="status-pill ${pillClassForStatusClass(req.statusClass)}">${escapeHtml(statusLabel)}</span>
          <span class="item-time">${formatTime(req.timeStamp)}</span>
        </div>
        <div class="item-message">${escapeHtml(req.method)}</div>
        <div class="item-meta">${escapeHtml(req.url)}</div>
      `;
      els.requestsList.appendChild(li);
    });
  }

  function renderPerformance(performance) {
    const perf = performance || {};
    els.perfLoad.textContent = formatMs(perf.pageLoadTime);
    els.perfDcl.textContent = formatMs(perf.domContentLoadedTime);
    els.perfTtfb.textContent = formatMs(perf.ttfb);

    const slowest = perf.slowestResources || [];
    els.perfList.innerHTML = '';
    els.perfEmpty.style.display = slowest.length ? 'none' : 'block';

    slowest.forEach((res) => {
      const li = document.createElement('li');
      li.className = 'item';
      const shortName = res.name.length > 70 ? `${res.name.slice(0, 67)}…` : res.name;
      li.innerHTML = `
        <div class="item-top">
          <span class="item-tag">${escapeHtml(res.initiatorType)}</span>
          <span class="item-time">${formatMs(res.duration)}</span>
        </div>
        <div class="item-meta">${escapeHtml(shortName)}</div>
      `;
      els.perfList.appendChild(li);
    });
  }

  function updateBadge(el, count) {
    el.textContent = String(count);
    el.classList.toggle('nonzero', count > 0);
  }

  function render(payload) {
    const { data, badges } = payload;
    const consoleSummary = window.BDC.summarizeConsoleIssues(data.consoleIssues);
    const requestSummary = window.BDC.classifyRequests(data.requests);
    const perfSummary = window.BDC.buildPerformanceSummary(
      data.navigationEntries,
      data.resourceEntries
    );

    updateBadge(els.badgeConsole, badges.consoleCount);
    updateBadge(els.badgeRequests, badges.failedRequestCount);

    renderConsoleIssues(consoleSummary);
    renderFailedRequests(requestSummary);
    renderPerformance(perfSummary);
  }

  function loadDiagnostics() {
    if (!currentTab) return;
    chrome.runtime.sendMessage(
      { type: 'get-diagnostics', tabId: currentTab.id },
      (response) => {
        if (chrome.runtime.lastError) {
          setStatus('Could not reach background service worker.');
          return;
        }
        if (response && response.ok) {
          render(response);
        }
      }
    );
  }

  function initTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
      });
    });
  }

  function downloadReport(report) {
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeHost = (() => {
      try {
        return new URL(report.tab.url).hostname.replace(/[^a-z0-9.-]/gi, '_');
      } catch (err) {
        return 'report';
      }
    })();
    const filename = `browser-diagnostics-${safeHost}-${Date.now()}.json`;

    chrome.downloads.download(
      { url, filename, saveAs: false },
      () => {
        if (chrome.runtime.lastError) {
          setStatus('Export failed: ' + chrome.runtime.lastError.message, 4000);
        } else {
          setStatus('Report exported.', 3000);
        }
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    );
  }

  function initButtons() {
    els.clearBtn.addEventListener('click', () => {
      if (!currentTab) return;
      chrome.runtime.sendMessage({ type: 'clear-diagnostics', tabId: currentTab.id }, () => {
        setStatus('Cleared.', 2000);
        loadDiagnostics();
      });
    });

    els.exportBtn.addEventListener('click', () => {
      if (!currentTab) return;
      setStatus('Compiling report…');
      chrome.runtime.sendMessage({ type: 'export-report', tabId: currentTab.id }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          setStatus('Export failed.', 4000);
          return;
        }
        downloadReport(response.report);
      });
    });
  }

  function init() {
    initTabs();
    initButtons();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      currentTab = tabs && tabs[0];
      if (!currentTab) {
        els.tabUrl.textContent = 'No active tab.';
        return;
      }
      els.tabUrl.textContent = currentTab.url || '';
      loadDiagnostics();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
