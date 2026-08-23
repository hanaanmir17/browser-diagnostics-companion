'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getStatusClass,
  isFailedRequest,
  classifyRequest,
  classifyRequests,
} = require('../lib/requests');

test('getStatusClass classifies 2xx as success', () => {
  assert.equal(getStatusClass(200), 'success');
  assert.equal(getStatusClass(204), 'success');
  assert.equal(getStatusClass(299), 'success');
});

test('getStatusClass classifies 3xx as redirect', () => {
  assert.equal(getStatusClass(301), 'redirect');
  assert.equal(getStatusClass(304), 'redirect');
});

test('getStatusClass classifies 4xx as clientError', () => {
  assert.equal(getStatusClass(404), 'clientError');
  assert.equal(getStatusClass(401), 'clientError');
});

test('getStatusClass classifies 5xx as serverError', () => {
  assert.equal(getStatusClass(500), 'serverError');
  assert.equal(getStatusClass(503), 'serverError');
});

test('getStatusClass classifies missing/invalid status codes as networkError', () => {
  assert.equal(getStatusClass(null), 'networkError');
  assert.equal(getStatusClass(undefined), 'networkError');
  assert.equal(getStatusClass(0), 'networkError');
  assert.equal(getStatusClass(-1), 'networkError');
  assert.equal(getStatusClass(NaN), 'networkError');
});

test('isFailedRequest returns true for a hard network error record', () => {
  assert.equal(isFailedRequest({ url: 'https://x.test', error: 'net::ERR_CONNECTION_REFUSED' }), true);
});

test('isFailedRequest returns true for 4xx and 5xx status codes', () => {
  assert.equal(isFailedRequest({ url: 'https://x.test', statusCode: 404 }), true);
  assert.equal(isFailedRequest({ url: 'https://x.test', statusCode: 500 }), true);
});

test('isFailedRequest returns false for 2xx/3xx status codes', () => {
  assert.equal(isFailedRequest({ url: 'https://x.test', statusCode: 200 }), false);
  assert.equal(isFailedRequest({ url: 'https://x.test', statusCode: 301 }), false);
});

test('isFailedRequest returns false for a null/undefined record', () => {
  assert.equal(isFailedRequest(null), false);
  assert.equal(isFailedRequest(undefined), false);
});

test('classifyRequest normalizes method casing and fills defaults', () => {
  const result = classifyRequest({ url: 'https://x.test/api', method: 'post', statusCode: 201 });
  assert.equal(result.method, 'POST');
  assert.equal(result.statusClass, 'success');
  assert.equal(result.failed, false);
});

test('classifyRequest marks a 404 as failed with clientError statusClass', () => {
  const result = classifyRequest({ url: 'https://x.test/missing', method: 'GET', statusCode: 404 });
  assert.equal(result.failed, true);
  assert.equal(result.statusClass, 'clientError');
  assert.equal(result.statusCode, 404);
});

test('classifyRequest marks a network error as failed with networkError statusClass', () => {
  const result = classifyRequest({
    url: 'https://x.test/down',
    method: 'GET',
    statusCode: null,
    error: 'net::ERR_NAME_NOT_RESOLVED',
  });
  assert.equal(result.failed, true);
  assert.equal(result.statusClass, 'networkError');
  assert.equal(result.error, 'net::ERR_NAME_NOT_RESOLVED');
});

test('classifyRequest defaults method to GET and url to "unknown" when missing', () => {
  const result = classifyRequest({});
  assert.equal(result.method, 'GET');
  assert.equal(result.url, 'unknown');
  assert.equal(result.statusCode, null);
});

test('classifyRequests buckets a mixed list of records correctly', () => {
  const records = [
    { url: 'a', method: 'GET', statusCode: 200 },
    { url: 'b', method: 'GET', statusCode: 404 },
    { url: 'c', method: 'POST', statusCode: 500 },
    { url: 'd', method: 'GET', statusCode: null, error: 'net::ERR_FAILED' },
    { url: 'e', method: 'GET', statusCode: 301 },
  ];

  const result = classifyRequests(records);

  assert.equal(result.counts.total, 5);
  assert.equal(result.counts.failed, 3);
  assert.equal(result.counts.succeeded, 2);
  assert.equal(result.buckets.success, 1);
  assert.equal(result.buckets.redirect, 1);
  assert.equal(result.buckets.clientError, 1);
  assert.equal(result.buckets.serverError, 1);
  assert.equal(result.buckets.networkError, 1);
  assert.equal(result.failures.length, 3);
  assert.equal(result.successes.length, 2);
});

test('classifyRequests returns a well-formed empty result for an empty list', () => {
  const result = classifyRequests([]);
  assert.equal(result.counts.total, 0);
  assert.equal(result.counts.failed, 0);
  assert.equal(result.failures.length, 0);
  assert.equal(result.successes.length, 0);
});

test('classifyRequests handles non-array input without throwing', () => {
  const result = classifyRequests(undefined);
  assert.equal(result.counts.total, 0);
  assert.deepEqual(result.all, []);
});
