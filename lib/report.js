/**
 * lib/report.js
 *
 * Pure, framework-independent functions for summarizing console issues
 * and compiling the final JSON diagnostics report. Depends only on the
 * other pure lib modules (requests.js, performance.js) -- never touches
 * chrome.* APIs -- so it is unit-testable under plain Node.js
 * (see tests/report.test.js).
 */

'use strict';

// Dual-environment dependency resolution: under Node (unit tests) pull the
// sibling modules in via require(); as a classic script inside the
// extension (service worker importScripts / popup <script> tag) fall back
// to the shared self.BDC namespace that those files attach themselves to.
let classifyRequests;
let buildPerformanceSummary;
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  ({ classifyRequests } = require('./requests'));
  ({ buildPerformanceSummary } = require('./performance'));
} else if (typeof self !== 'undefined' && self.BDC) {
  ({ classifyRequests, buildPerformanceSummary } = self.BDC);
}

/**
 * Summarize a list of captured console issues by level.
 *
 * @param {Array<{level: string, message: string, source: string, timeStamp: number}>} consoleIssues
 * @returns {{total: number, errors: number, warnings: number, items: Array<object>}}
 */
function summarizeConsoleIssues(consoleIssues) {
  const list = Array.isArray(consoleIssues) ? consoleIssues : [];

  const items = list.map((issue) => {
    const safe = issue && typeof issue === 'object' ? issue : {};
    return {
      level: safe.level === 'warn' ? 'warn' : 'error',
      message: typeof safe.message === 'string' ? safe.message : String(safe.message || ''),
      source: typeof safe.source === 'string' ? safe.source : 'unknown',
      timeStamp: typeof safe.timeStamp === 'number' ? safe.timeStamp : null,
    };
  });

  let errors = 0;
  let warnings = 0;
  for (const item of items) {
    if (item.level === 'warn') warnings += 1;
    else errors += 1;
  }

  return { total: items.length, errors, warnings, items };
}

/**
 * Compile a complete diagnostics report for a single tab from raw
 * captured data. This is the single entry point the popup's "Export
 * Report" button calls into (via a thin wrapper that supplies the live
 * chrome.* data), so its output shape is the contract for the exported
 * JSON file.
 *
 * @param {object} input
 * @param {{url: string, title: string}} input.tab
 * @param {Array<object>} input.consoleIssues
 * @param {Array<object>} input.requests - raw webRequest-shaped records
 * @param {Array<object>} input.navigationEntries
 * @param {Array<object>} input.resourceEntries
 * @param {string} [input.generatedAt] - ISO timestamp; defaults to now
 * @returns {object} a fully structured, JSON-serializable report
 */
function compileReport(input) {
  const safeInput = input && typeof input === 'object' ? input : {};
  const tab = safeInput.tab && typeof safeInput.tab === 'object' ? safeInput.tab : {};

  const consoleSummary = summarizeConsoleIssues(safeInput.consoleIssues);
  const requestSummary = classifyRequests(safeInput.requests);
  const performanceSummary = buildPerformanceSummary(
    safeInput.navigationEntries,
    safeInput.resourceEntries
  );

  return {
    reportVersion: '1.0',
    generatedAt: safeInput.generatedAt || new Date().toISOString(),
    tab: {
      url: typeof tab.url === 'string' ? tab.url : 'unknown',
      title: typeof tab.title === 'string' ? tab.title : 'unknown',
    },
    summary: {
      consoleIssueCount: consoleSummary.total,
      failedRequestCount: requestSummary.counts.failed,
      pageLoadTime: performanceSummary.pageLoadTime,
    },
    consoleIssues: consoleSummary,
    networkRequests: requestSummary,
    performance: performanceSummary,
  };
}

/**
 * Compute the three badge counts shown in the popup's tab headers.
 *
 * @param {object} data
 * @param {Array<object>} data.consoleIssues
 * @param {Array<object>} data.requests
 * @returns {{consoleCount: number, failedRequestCount: number}}
 */
function computeBadgeCounts(data) {
  const safe = data && typeof data === 'object' ? data : {};
  const consoleSummary = summarizeConsoleIssues(safe.consoleIssues);
  const requestSummary = classifyRequests(safe.requests);

  return {
    consoleCount: consoleSummary.total,
    failedRequestCount: requestSummary.counts.failed,
  };
}

const api = {
  summarizeConsoleIssues,
  compileReport,
  computeBadgeCounts,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof self !== 'undefined') {
  self.BDC = self.BDC || {};
  Object.assign(self.BDC, api);
}
