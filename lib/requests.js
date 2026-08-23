/**
 * lib/requests.js
 *
 * Pure, framework-independent functions for classifying network request
 * records captured via chrome.webRequest. Records are plain objects of the
 * shape:
 *   { url: string, method: string, statusCode: number|null, error: string|null, timeStamp: number }
 *
 * No chrome.* API calls happen here, so this module is fully unit-testable
 * under plain Node.js (see tests/requests.test.js).
 */

'use strict';

const STATUS_CLASS_LABELS = {
  1: 'informational',
  2: 'success',
  3: 'redirect',
  4: 'clientError',
  5: 'serverError',
};

/**
 * Determine the "status class" bucket name for a given HTTP status code.
 * Returns 'networkError' when there is no status code at all (e.g. DNS
 * failure, connection refused, blocked by client), which webRequest
 * reports via onErrorOccurred rather than a status code.
 *
 * @param {number|null|undefined} statusCode
 * @returns {string}
 */
function getStatusClass(statusCode) {
  if (typeof statusCode !== 'number' || Number.isNaN(statusCode) || statusCode <= 0) {
    return 'networkError';
  }
  const firstDigit = Math.floor(statusCode / 100);
  return STATUS_CLASS_LABELS[firstDigit] || 'unknown';
}

/**
 * Decide whether a single request record represents a failure.
 * A request is a failure if:
 *   - it has a network-level error (no HTTP response at all), or
 *   - its status code is 4xx or 5xx.
 *
 * @param {object} record
 * @returns {boolean}
 */
function isFailedRequest(record) {
  if (!record || typeof record !== 'object') return false;

  if (record.error) return true;

  const statusClass = getStatusClass(record.statusCode);
  return statusClass === 'clientError' || statusClass === 'serverError';
}

/**
 * Classify a single request record into a normalized shape used
 * throughout the extension's UI and report output.
 *
 * @param {object} record
 * @returns {{url: string, method: string, statusCode: number|null, statusClass: string, failed: boolean, error: string|null, timeStamp: number|null}}
 */
function classifyRequest(record) {
  const safeRecord = record && typeof record === 'object' ? record : {};
  const statusCode =
    typeof safeRecord.statusCode === 'number' ? safeRecord.statusCode : null;

  return {
    url: typeof safeRecord.url === 'string' ? safeRecord.url : 'unknown',
    method:
      typeof safeRecord.method === 'string'
        ? safeRecord.method.toUpperCase()
        : 'GET',
    statusCode,
    statusClass: getStatusClass(statusCode),
    failed: isFailedRequest(safeRecord),
    error: safeRecord.error || null,
    timeStamp:
      typeof safeRecord.timeStamp === 'number' ? safeRecord.timeStamp : null,
  };
}

/**
 * Classify a whole list of request records, bucket them by status class,
 * and separate failures from successes.
 *
 * @param {Array<object>} records
 * @returns {{
 *   all: Array<object>,
 *   failures: Array<object>,
 *   successes: Array<object>,
 *   buckets: {informational: number, success: number, redirect: number, clientError: number, serverError: number, networkError: number, unknown: number},
 *   counts: {total: number, failed: number, succeeded: number}
 * }}
 */
function classifyRequests(records) {
  const list = Array.isArray(records) ? records : [];
  const all = list.map(classifyRequest);

  const buckets = {
    informational: 0,
    success: 0,
    redirect: 0,
    clientError: 0,
    serverError: 0,
    networkError: 0,
    unknown: 0,
  };

  const failures = [];
  const successes = [];

  for (const item of all) {
    buckets[item.statusClass] = (buckets[item.statusClass] || 0) + 1;
    if (item.failed) {
      failures.push(item);
    } else {
      successes.push(item);
    }
  }

  return {
    all,
    failures,
    successes,
    buckets,
    counts: {
      total: all.length,
      failed: failures.length,
      succeeded: successes.length,
    },
  };
}

const api = {
  getStatusClass,
  isFailedRequest,
  classifyRequest,
  classifyRequests,
};

// Dual export: CommonJS for the Node test runner, and a global namespace
// (self.BDC) for use as a plain classic script inside the extension.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof self !== 'undefined') {
  self.BDC = self.BDC || {};
  Object.assign(self.BDC, api);
}
