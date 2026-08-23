'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  summarizeConsoleIssues,
  compileReport,
  computeBadgeCounts,
} = require('../lib/report');

test('summarizeConsoleIssues counts errors and warnings separately', () => {
  const issues = [
    { level: 'error', message: 'boom', source: 'a.js', timeStamp: 1 },
    { level: 'warn', message: 'careful', source: 'a.js', timeStamp: 2 },
    { level: 'error', message: 'boom again', source: 'b.js', timeStamp: 3 },
  ];
  const summary = summarizeConsoleIssues(issues);
  assert.equal(summary.total, 3);
  assert.equal(summary.errors, 2);
  assert.equal(summary.warnings, 1);
  assert.equal(summary.items.length, 3);
});

test('summarizeConsoleIssues defaults unknown level to error', () => {
  const summary = summarizeConsoleIssues([{ level: 'info', message: 'hi' }]);
  assert.equal(summary.items[0].level, 'error');
  assert.equal(summary.errors, 1);
});

test('summarizeConsoleIssues returns an empty summary for an empty/undefined list', () => {
  assert.deepEqual(summarizeConsoleIssues([]), { total: 0, errors: 0, warnings: 0, items: [] });
  assert.deepEqual(summarizeConsoleIssues(undefined), { total: 0, errors: 0, warnings: 0, items: [] });
});

test('summarizeConsoleIssues coerces non-string messages to strings', () => {
  const summary = summarizeConsoleIssues([{ level: 'error', message: 42 }]);
  assert.equal(summary.items[0].message, '42');
});

test('compileReport produces a fully structured report from sample captured data', () => {
  const input = {
    tab: { url: 'https://example.com/page', title: 'Example Page' },
    consoleIssues: [
      { level: 'error', message: 'TypeError: x is not a function', source: 'app.js', timeStamp: 100 },
      { level: 'warn', message: 'Deprecated API used', source: 'app.js', timeStamp: 200 },
    ],
    requests: [
      { url: 'https://example.com/api/one', method: 'GET', statusCode: 200 },
      { url: 'https://example.com/api/two', method: 'GET', statusCode: 404 },
      { url: 'https://example.com/api/three', method: 'POST', statusCode: null, error: 'net::ERR_FAILED' },
    ],
    navigationEntries: [
      { loadEventEnd: 1800, domContentLoadedEventEnd: 900, responseStart: 150, requestStart: 50 },
    ],
    resourceEntries: [
      { name: 'https://example.com/big.js', duration: 700, initiatorType: 'script', transferSize: 20000 },
      { name: 'https://example.com/small.css', duration: 40, initiatorType: 'link', transferSize: 1000 },
    ],
    generatedAt: '2026-01-01T00:00:00.000Z',
  };

  const report = compileReport(input);

  assert.equal(report.reportVersion, '1.0');
  assert.equal(report.generatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(report.tab.url, 'https://example.com/page');
  assert.equal(report.tab.title, 'Example Page');

  assert.equal(report.summary.consoleIssueCount, 2);
  assert.equal(report.summary.failedRequestCount, 2);
  assert.equal(report.summary.pageLoadTime, 1800);

  assert.equal(report.consoleIssues.errors, 1);
  assert.equal(report.consoleIssues.warnings, 1);

  assert.equal(report.networkRequests.counts.total, 3);
  assert.equal(report.networkRequests.counts.failed, 2);
  assert.equal(report.networkRequests.buckets.clientError, 1);
  assert.equal(report.networkRequests.buckets.networkError, 1);

  assert.equal(report.performance.pageLoadTime, 1800);
  assert.equal(report.performance.domContentLoadedTime, 900);
  assert.equal(report.performance.slowestResources[0].name, 'https://example.com/big.js');
});

test('compileReport fills in safe defaults for missing/malformed input', () => {
  const report = compileReport({});
  assert.equal(report.tab.url, 'unknown');
  assert.equal(report.tab.title, 'unknown');
  assert.equal(report.summary.consoleIssueCount, 0);
  assert.equal(report.summary.failedRequestCount, 0);
  assert.equal(report.summary.pageLoadTime, null);
  assert.equal(typeof report.generatedAt, 'string');
});

test('compileReport defaults generatedAt to an ISO timestamp when not supplied', () => {
  const before = Date.now();
  const report = compileReport({ tab: { url: 'https://x.test', title: 'X' } });
  const parsed = Date.parse(report.generatedAt);
  assert.equal(Number.isNaN(parsed), false);
  assert.ok(parsed >= before - 5000);
});

test('compileReport handles completely undefined input without throwing', () => {
  const report = compileReport(undefined);
  assert.equal(report.reportVersion, '1.0');
  assert.equal(report.tab.url, 'unknown');
});

test('computeBadgeCounts returns console and failed-request counts', () => {
  const badges = computeBadgeCounts({
    consoleIssues: [
      { level: 'error', message: 'a' },
      { level: 'warn', message: 'b' },
    ],
    requests: [
      { url: 'x', statusCode: 200 },
      { url: 'y', statusCode: 500 },
    ],
  });
  assert.equal(badges.consoleCount, 2);
  assert.equal(badges.failedRequestCount, 1);
});

test('computeBadgeCounts returns zeros for empty/undefined data', () => {
  const badges = computeBadgeCounts({});
  assert.equal(badges.consoleCount, 0);
  assert.equal(badges.failedRequestCount, 0);
});
