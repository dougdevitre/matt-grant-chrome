import { useEffect, useState } from "react";

// A boolean preference persisted in chrome.storage.local. `def` is used until
// storage loads, and whenever chrome APIs are unavailable (tests / non-extension
// contexts), so the hook is always safe to call.
export function useStoredFlag(
  key: string,
  def: boolean
): [boolean, (v: boolean) => void] {
  const [val, setVal] = useState(def);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(key).then((r) => {
      if (typeof r[key] === "boolean") setVal(r[key]);
    });
  }, [key]);

  function set(v: boolean) {
    setVal(v);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [key]: v });
    }
  }

  return [val, set];
}
