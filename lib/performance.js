/**
 * lib/performance.js
 *
 * Pure, framework-independent functions for extracting and summarizing
 * page performance data. These functions accept plain objects shaped like
 * the entries returned by performance.getEntriesByType('navigation') and
 * performance.getEntriesByType('resource') -- they never call any chrome.*
 * or browser API directly, which makes them unit-testable under plain
 * Node.js (see tests/performance.test.js).
 */

'use strict';

/**
 * Extract the key timing figures from a single Navigation Timing Level 2
 * entry (the shape returned by performance.getEntriesByType('navigation')[0]).
 *
 * @param {object} navEntry - a PerformanceNavigationTiming-shaped object
 * @returns {{pageLoadTime: number|null, domContentLoadedTime: number|null, ttfb: number|null}}
 */
function extractNavigationTiming(navEntry) {
  if (!navEntry || typeof navEntry !== 'object') {
    return { pageLoadTime: null, domContentLoadedTime: null, ttfb: null };
  }

  const pageLoadTime = numberOrNull(navEntry.loadEventEnd);
  const domContentLoadedTime = numberOrNull(navEntry.domContentLoadedEventEnd);
  const responseStart = numberOrNull(navEntry.responseStart);
  const requestStart = numberOrNull(navEntry.requestStart);

  const ttfb =
    responseStart !== null && requestStart !== null
      ? round(responseStart - requestStart)
      : null;

  return {
    pageLoadTime: pageLoadTime !== null ? round(pageLoadTime) : null,
    domContentLoadedTime:
      domContentLoadedTime !== null ? round(domContentLoadedTime) : null,
    ttfb,
  };
}

/**
 * Rank resource timing entries by duration and return the slowest N.
 *
 * @param {Array<object>} resourceEntries - PerformanceResourceTiming-shaped objects
 * @param {number} [limit=5] - how many of the slowest resources to return
 * @returns {Array<{name: string, duration: number, initiatorType: string, transferSize: number}>}
 */
function getSlowestResources(resourceEntries, limit = 5) {
  if (!Array.isArray(resourceEntries)) return [];

  return resourceEntries
    .filter((entry) => entry && typeof entry.duration === 'number')
    .map((entry) => ({
      name: entry.name || 'unknown',
      duration: round(entry.duration),
      initiatorType: entry.initiatorType || 'other',
      transferSize:
        typeof entry.transferSize === 'number' ? entry.transferSize : 0,
    }))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, Math.max(0, limit));
}

/**
 * Compute simple aggregate stats over a list of resource entries.
 *
 * @param {Array<object>} resourceEntries
 * @returns {{count: number, totalTransferSize: number, averageDuration: number}}
 */
function summarizeResourceStats(resourceEntries) {
  if (!Array.isArray(resourceEntries) || resourceEntries.length === 0) {
    return { count: 0, totalTransferSize: 0, averageDuration: 0 };
  }

  let totalTransferSize = 0;
  let totalDuration = 0;
  let counted = 0;

  for (const entry of resourceEntries) {
    if (!entry) continue;
    if (typeof entry.transferSize === 'number') {
      totalTransferSize += entry.transferSize;
    }
    if (typeof entry.duration === 'number') {
      totalDuration += entry.duration;
      counted += 1;
    }
  }

  return {
    count: resourceEntries.length,
    totalTransferSize: round(totalTransferSize),
    averageDuration: counted > 0 ? round(totalDuration / counted) : 0,
  };
}

/**
 * Build a full performance summary combining navigation timing, the
 * slowest resources, and aggregate resource stats. This is the single
 * function the popup/report layer calls.
 *
 * @param {Array<object>} navigationEntries
 * @param {Array<object>} resourceEntries
 * @param {number} [slowestLimit=5]
 * @returns {object}
 */
function buildPerformanceSummary(
  navigationEntries,
  resourceEntries,
  slowestLimit = 5
) {
  const navEntry =
    Array.isArray(navigationEntries) && navigationEntries.length > 0
      ? navigationEntries[0]
      : null;

  const timing = extractNavigationTiming(navEntry);
  const slowestResources = getSlowestResources(resourceEntries, slowestLimit);
  const resourceStats = summarizeResourceStats(resourceEntries);

  return {
    pageLoadTime: timing.pageLoadTime,
    domContentLoadedTime: timing.domContentLoadedTime,
    ttfb: timing.ttfb,
    slowestResources,
    resourceStats,
  };
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

const api = {
  extractNavigationTiming,
  getSlowestResources,
  summarizeResourceStats,
  buildPerformanceSummary,
};

// Dual export: CommonJS for the Node test runner, and a global namespace
// (self.BDC) for use as a plain classic script inside the extension
// (service worker via importScripts, or a <script> tag in popup.html).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof self !== 'undefined') {
  self.BDC = self.BDC || {};
  Object.assign(self.BDC, api);
}
