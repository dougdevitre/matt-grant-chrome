import { useEffect, useState } from "react";

// Returns the hostname of the active tab, or null. Only hosts the extension has
// host_permissions for expose their URL, so non-allow-listed tabs read as null —
// the panel is structurally blind to everything else. Never reads page content.
export function useActiveHost(enabled: boolean): string | null {
  const [host, setHost] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof chrome === "undefined" || !chrome.tabs?.query) {
      setHost(null);
      return;
    }

    let cancelled = false;
    const hostOf = (url?: string): string | null => {
      if (!url) return null;
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    };

    const refresh = () => {
      chrome.tabs
        .query({ active: true, lastFocusedWindow: true })
        .then((tabs) => {
          if (!cancelled) setHost(hostOf(tabs[0]?.url));
        })
        .catch(() => {
          if (!cancelled) setHost(null);
        });
    };

    refresh();
    // Re-check when the user switches tabs or the active tab navigates.
    const onActivated = () => refresh();
    const onUpdated = () => refresh();
    chrome.tabs.onActivated?.addListener(onActivated);
    chrome.tabs.onUpdated?.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated?.removeListener(onActivated);
      chrome.tabs.onUpdated?.removeListener(onUpdated);
    };
  }, [enabled]);

  return host;
}
