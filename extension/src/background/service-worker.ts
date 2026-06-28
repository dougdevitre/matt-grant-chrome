// MV3 service worker. Opens the side panel on the toolbar icon and sets a
// sensible default API base on install. Holds no secrets.

chrome.runtime.onInstalled.addListener(async () => {
  const { apiBase } = await chrome.storage.local.get("apiBase");
  if (!apiBase) {
    await chrome.storage.local.set({ apiBase: "http://localhost:8787" });
  }
});

// Clicking the toolbar icon opens the side panel for the current tab.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("sidePanel error", err));
