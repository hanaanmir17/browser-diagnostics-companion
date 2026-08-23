'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractNavigationTiming,
  getSlowestResources,
  summarizeResourceStats,
  buildPerformanceSummary,
} = require('../lib/performance');

test('extractNavigationTiming computes pageLoadTime and domContentLoadedTime from a navigation entry', () => {
  const navEntry = {
    loadEventEnd: 1234.5,
    domContentLoadedEventEnd: 800.2,
    responseStart: 200,
    requestStart: 50,
  };
  const result = extractNavigationTiming(navEntry);
  assert.equal(result.pageLoadTime, 1234.5);
  assert.equal(result.domContentLoadedTime, 800.2);
  assert.equal(result.ttfb, 150);
});

test('extractNavigationTiming returns nulls for a null/undefined entry', () => {
  const result = extractNavigationTiming(null);
  assert.equal(result.pageLoadTime, null);
  assert.equal(result.domContentLoadedTime, null);
  assert.equal(result.ttfb, null);
});

test('extractNavigationTiming returns nulls for a non-object entry', () => {
  const result = extractNavigationTiming('not an entry');
  assert.equal(result.pageLoadTime, null);
  assert.equal(result.domContentLoadedTime, null);
});

test('extractNavigationTiming handles missing fields gracefully', () => {
  const result = extractNavigationTiming({ loadEventEnd: 500 });
  assert.equal(result.pageLoadTime, 500);
  assert.equal(result.domContentLoadedTime, null);
  assert.equal(result.ttfb, null);
});

test('getSlowestResources sorts resources by duration descending', () => {
  const resources = [
    { name: 'a.js', duration: 100, initiatorType: 'script', transferSize: 1000 },
    { name: 'b.png', duration: 900, initiatorType: 'img', transferSize: 50000 },
    { name: 'c.css', duration: 300, initiatorType: 'link', transferSize: 2000 },
  ];
  const result = getSlowestResources(resources, 5);
  assert.equal(result.length, 3);
  assert.equal(result[0].name, 'b.png');
  assert.equal(result[1].name, 'c.css');
  assert.equal(result[2].name, 'a.js');
});

test('getSlowestResources respects the limit parameter', () => {
  const resources = [
    { name: 'a', duration: 10 },
    { name: 'b', duration: 20 },
    { name: 'c', duration: 30 },
    { name: 'd', duration: 40 },
  ];
  const result = getSlowestResources(resources, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'd');
  assert.equal(result[1].name, 'c');
});

test('getSlowestResources returns an empty array for non-array input', () => {
  assert.deepEqual(getSlowestResources(null), []);
  assert.deepEqual(getSlowestResources(undefined), []);
  assert.deepEqual(getSlowestResources('nope'), []);
});

test('getSlowestResources filters out entries without a numeric duration', () => {
  const resources = [
    { name: 'valid', duration: 50 },
    { name: 'invalid', duration: 'not-a-number' },
    null,
  ];
  const result = getSlowestResources(resources, 5);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'valid');
});

test('getSlowestResources defaults missing initiatorType and transferSize', () => {
  const result = getSlowestResources([{ name: 'x', duration: 10 }], 1);
  assert.equal(result[0].initiatorType, 'other');
  assert.equal(result[0].transferSize, 0);
});

test('summarizeResourceStats computes count, totalTransferSize and averageDuration', () => {
  const resources = [
    { duration: 100, transferSize: 1000 },
    { duration: 200, transferSize: 3000 },
  ];
  const stats = summarizeResourceStats(resources);
  assert.equal(stats.count, 2);
  assert.equal(stats.totalTransferSize, 4000);
  assert.equal(stats.averageDuration, 150);
});

test('summarizeResourceStats handles an empty list', () => {
  const stats = summarizeResourceStats([]);
  assert.deepEqual(stats, { count: 0, totalTransferSize: 0, averageDuration: 0 });
});

test('summarizeResourceStats handles non-array input', () => {
  const stats = summarizeResourceStats(undefined);
  assert.deepEqual(stats, { count: 0, totalTransferSize: 0, averageDuration: 0 });
});

test('buildPerformanceSummary combines navigation timing and slowest resources', () => {
  const navigationEntries = [
    {
      loadEventEnd: 2000,
      domContentLoadedEventEnd: 1200,
      responseStart: 300,
      requestStart: 100,
    },
  ];
  const resourceEntries = [
    { name: 'slow.js', duration: 1500, initiatorType: 'script', transferSize: 10000 },
    { name: 'fast.css', duration: 50, initiatorType: 'link', transferSize: 500 },
  ];

  const summary = buildPerformanceSummary(navigationEntries, resourceEntries, 1);

  assert.equal(summary.pageLoadTime, 2000);
  assert.equal(summary.domContentLoadedTime, 1200);
  assert.equal(summary.ttfb, 200);
  assert.equal(summary.slowestResources.length, 1);
  assert.equal(summary.slowestResources[0].name, 'slow.js');
  assert.equal(summary.resourceStats.count, 2);
});

test('buildPerformanceSummary handles an empty navigation entries array', () => {
  const summary = buildPerformanceSummary([], [], 5);
  assert.equal(summary.pageLoadTime, null);
  assert.equal(summary.domContentLoadedTime, null);
  assert.deepEqual(summary.slowestResources, []);
});

test('buildPerformanceSummary defaults slowestLimit to 5', () => {
  const resourceEntries = Array.from({ length: 8 }, (_, i) => ({
    name: `resource-${i}.js`,
    duration: i * 10,
  }));
  const summary = buildPerformanceSummary([], resourceEntries);
  assert.equal(summary.slowestResources.length, 5);
  assert.equal(summary.slowestResources[0].name, 'resource-7.js');
});
