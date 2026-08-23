/**
 * content.js
 *
 * Runs in the isolated content-script world for every http(s) page
 * (declared in manifest.json, run_at: document_start). Its only job is
 * to:
 *   1. Inject injected.js into the page's main world as early as possible
 *      so the console.error/console.warn hooks are installed before the
 *      page's own scripts run.
 *   2. Listen for postMessage events coming from injected.js and relay
 *      them to the background service worker, tagging each with the
 *      sender tab's context.
 *
 * This file intentionally contains no data-processing logic -- all
 * summarization/classification lives in lib/ as pure functions.
 */

(function () {
  const CHANNEL = '__browser_diagnostics_companion__';

  function injectMainWorldScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = function () {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (err) {
      // If injection fails (e.g. restricted page), there is nothing more
      // we can do for console capture on this page.
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;

    if (data.type === 'console-issue') {
      chrome.runtime.sendMessage({
        type: 'console-issue',
        level: data.level,
        message: data.message,
        source: data.source,
        timeStamp: data.timeStamp,
      });
    } else if (data.type === 'performance-data') {
      chrome.runtime.sendMessage({
        type: 'performance-data',
        navigationEntries: data.navigationEntries,
        resourceEntries: data.resourceEntries,
      });
    }
  });

  injectMainWorldScript();
})();
