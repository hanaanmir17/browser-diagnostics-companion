/**
 * injected.js
 *
 * Runs in the PAGE's own JavaScript context (the "main world"), not the
 * isolated content-script world. This is required because overriding
 * console.error/console.warn from an isolated-world content script does
 * NOT intercept calls made by the page's own scripts -- isolated worlds
 * get their own copy of the console object. Injecting this file into the
 * main world lets it patch the real window.console that the page uses.
 *
 * Communication back to the extension happens via window.postMessage,
 * which content.js (running in the isolated world, but sharing the same
 * DOM/window event target) listens for and relays to the background
 * service worker via chrome.runtime.sendMessage.
 *
 * See README.md "Known Limitations" for what this approach can and
 * cannot catch.
 */

(function () {
  if (window.__bdcInjected) return;
  window.__bdcInjected = true;

  const CHANNEL = '__browser_diagnostics_companion__';

  function post(payload) {
    try {
      window.postMessage({ channel: CHANNEL, ...payload }, '*');
    } catch (err) {
      // Swallow -- postMessage should never throw for same-window targets,
      // but be defensive since this runs inside arbitrary host pages.
    }
  }

  function safeStringifyArg(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) {
      return arg.stack || `${arg.name}: ${arg.message}`;
    }
    try {
      return JSON.stringify(arg);
    } catch (err) {
      return String(arg);
    }
  }

  function formatArgs(args) {
    return Array.from(args).map(safeStringifyArg).join(' ');
  }

  const originalError = window.console.error.bind(window.console);
  const originalWarn = window.console.warn.bind(window.console);

  window.console.error = function (...args) {
    post({
      type: 'console-issue',
      level: 'error',
      message: formatArgs(args),
      source: window.location.href,
      timeStamp: Date.now(),
    });
    return originalError(...args);
  };

  window.console.warn = function (...args) {
    post({
      type: 'console-issue',
      level: 'warn',
      message: formatArgs(args),
      source: window.location.href,
      timeStamp: Date.now(),
    });
    return originalWarn(...args);
  };

  // Uncaught runtime exceptions also surface in DevTools as console
  // errors even though they never call console.error directly.
  window.addEventListener('error', (event) => {
    post({
      type: 'console-issue',
      level: 'error',
      message: event.message
        ? `Uncaught: ${event.message} (${event.filename}:${event.lineno}:${event.colno})`
        : 'Uncaught error',
      source: window.location.href,
      timeStamp: Date.now(),
    });
  });

  // Unhandled promise rejections likewise show as console errors.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.stack || reason.message
        : safeStringifyArg(reason);
    post({
      type: 'console-issue',
      level: 'error',
      message: `Unhandled promise rejection: ${message}`,
      source: window.location.href,
      timeStamp: Date.now(),
    });
  });

  function collectPerformanceData() {
    try {
      const navigationEntries = performance
        .getEntriesByType('navigation')
        .map(toPlainEntry);
      const resourceEntries = performance
        .getEntriesByType('resource')
        .map(toPlainEntry);

      post({
        type: 'performance-data',
        navigationEntries,
        resourceEntries,
      });
    } catch (err) {
      // performance API may be unavailable in some contexts; ignore.
    }
  }

  function toPlainEntry(entry) {
    return {
      name: entry.name,
      entryType: entry.entryType,
      startTime: entry.startTime,
      duration: entry.duration,
      initiatorType: entry.initiatorType,
      transferSize: entry.transferSize,
      loadEventEnd: entry.loadEventEnd,
      domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
      responseStart: entry.responseStart,
      requestStart: entry.requestStart,
    };
  }

  if (document.readyState === 'complete') {
    collectPerformanceData();
  } else {
    window.addEventListener('load', () => {
      // Small delay so loadEventEnd is populated.
      setTimeout(collectPerformanceData, 50);
    });
  }
})();
