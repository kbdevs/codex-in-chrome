// Localhost-only Chrome API shim used by the dev server so the side panel can
// boot without the extension runtime being injected.
(function installLocalChromeShim() {
  const createNoopEvent = () => ({
    addListener() {},
    removeListener() {},
    hasListener() {
      return false;
    },
  });

  const readLocalStorageValue = (key) => {
    const value = window.localStorage.getItem(key);
    if (value === null) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };

  const writeLocalStorageValue = (key, value) => {
    window.localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };

  const createStorageArea = () => ({
    async get(keys) {
      const result = {};
      if (typeof keys === "string") {
        const value = readLocalStorageValue(keys);
        if (value !== undefined) result[keys] = value;
        return result;
      }
      if (Array.isArray(keys)) {
        for (const key of keys) {
          const value = readLocalStorageValue(key);
          if (value !== undefined) result[key] = value;
        }
        return result;
      }
      if (keys && typeof keys === "object") {
        for (const [key, defaultValue] of Object.entries(keys)) {
          const value = readLocalStorageValue(key);
          result[key] = value === undefined ? defaultValue : value;
        }
        return result;
      }
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key !== null) result[key] = readLocalStorageValue(key);
      }
      return result;
    },
    async set(items) {
      for (const [key, value] of Object.entries(items || {})) {
        writeLocalStorageValue(key, value);
      }
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        if (typeof key === "string") window.localStorage.removeItem(key);
      }
    },
    async clear() {
      window.localStorage.clear();
    },
  });

  const createNoopTab = () => ({
    active: true,
    currentWindow: true,
    groupId: window.chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1,
    id: 1,
    title: document.title,
    url: window.location.href,
    windowId: 1,
  });

  if (!window.chrome) window.chrome = {};

  if (!window.chrome.tabGroups) {
    window.chrome.tabGroups = {
      TAB_GROUP_ID_NONE: -1,
      Color: {
        BLUE: "blue",
        CYAN: "cyan",
        GREEN: "green",
        GREY: "grey",
        ORANGE: "orange",
        PINK: "pink",
        PURPLE: "purple",
        RED: "red",
        YELLOW: "yellow",
      },
      async query() {
        return [];
      },
      async get() {
        return null;
      },
      async update(groupId) {
        return groupId;
      },
      async create() {
        return 1;
      },
    };
  }

  window.chrome.runtime ??= {};
  window.chrome.runtime.getURL ??= (path) =>
    new URL(path, window.location.origin).toString();
  window.chrome.runtime.sendMessage ??= async () => undefined;
  window.chrome.runtime.connect ??= () => ({
    disconnect() {},
    onDisconnect: createNoopEvent(),
    onMessage: createNoopEvent(),
    postMessage() {},
  });
  window.chrome.runtime.openOptionsPage ??= async () => {};
  window.chrome.runtime.getManifest ??= () => ({ version: "0.0.0" });
  window.chrome.runtime.reload ??= () => {};
  window.chrome.runtime.id ??= "codex-localhost";
  window.chrome.runtime.onMessage ??= createNoopEvent();
  window.chrome.runtime.onMessageExternal ??= createNoopEvent();
  window.chrome.runtime.onInstalled ??= createNoopEvent();
  window.chrome.runtime.onStartup ??= createNoopEvent();
  window.chrome.runtime.lastError ??= undefined;

  window.chrome.storage ??= {};
  window.chrome.storage.local ??= createStorageArea();
  window.chrome.storage.managed ??= {
    async get() {
      return {};
    },
  };
  window.chrome.storage.onChanged ??= createNoopEvent();

  window.chrome.tabs ??= {};
  window.chrome.tabs.get ??= async (tabId) => ({
    ...createNoopTab(),
    id: Number(tabId) || 1,
  });
  window.chrome.tabs.query ??= async () => [createNoopTab()];
  window.chrome.tabs.update ??= async (tabId) => ({
    id: Number(tabId) || 1,
  });
  window.chrome.tabs.create ??= async () => createNoopTab();
  window.chrome.tabs.remove ??= async () => {};
  window.chrome.tabs.group ??= async () => 1;
  window.chrome.tabs.ungroup ??= async () => {};
  window.chrome.tabs.sendMessage ??= async () => undefined;
  window.chrome.tabs.captureVisibleTab ??= async () =>
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X4ioAAAAASUVORK5CYII=";
  window.chrome.tabs.getCurrent ??= async () => createNoopTab();
  window.chrome.tabs.onActivated ??= createNoopEvent();
  window.chrome.tabs.onCreated ??= createNoopEvent();
  window.chrome.tabs.onUpdated ??= createNoopEvent();
  window.chrome.tabs.onRemoved ??= createNoopEvent();

  window.chrome.windows ??= {};
  window.chrome.windows.getCurrent ??= async (callback) => {
    const currentWindow = { id: 1, focused: true };
    if (typeof callback === "function") callback(currentWindow);
    return currentWindow;
  };
  window.chrome.windows.get ??= async (windowId) => ({
    id: Number(windowId) || 1,
    focused: true,
  });
  window.chrome.windows.update ??= async (windowId) => ({
    id: Number(windowId) || 1,
    focused: true,
  });
  window.chrome.windows.create ??= async () => ({ id: 1, focused: true });
  window.chrome.windows.onFocusChanged ??= createNoopEvent();

  window.chrome.scripting ??= {};
  window.chrome.scripting.executeScript ??= async () => [];

  window.chrome.sidePanel ??= {};
  window.chrome.sidePanel.setOptions ??= async () => {};
  window.chrome.sidePanel.getOptions ??= async () => ({ enabled: true });

  window.chrome.debugger ??= {};
  window.chrome.debugger.onEvent ??= createNoopEvent();
  window.chrome.debugger.onDetach ??= createNoopEvent();
  window.chrome.debugger.attach ??= async (_target, _version, callback) => {
    if (typeof callback === "function") callback();
  };
  window.chrome.debugger.detach ??= async (_target, callback) => {
    if (typeof callback === "function") callback();
  };
  window.chrome.debugger.getTargets ??= async () => [];
  window.chrome.debugger.sendCommand ??= async (
    _target,
    _method,
    _params,
    callback,
  ) => {
    if (typeof callback === "function") callback();
  };
})();
