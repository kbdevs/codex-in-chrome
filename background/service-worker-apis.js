import {
  e as executeMcpTool,
  f as registerBlockedPageNavigationListener,
  g as isBridgeConnected,
  h as sendBridgeNotification,
  s as ensureOffscreenDocument,
  t as tabGroupManager,
} from "../assets/mcpPermissions-X6RKG-4F.js";
import {
  c as checkAndRefreshOAuthTokenIfNeeded,
  d as clearAuthTokenAndLocalStorage,
  e as promptStore,
  f as refreshFeatureFlags,
  g as getRuntimeConfig,
  h as handleOAuthRedirect,
  v as getUserId,
  S as STORAGE_KEYS,
  s as setStorageValue,
} from "../assets/PermissionManager-BqJmxUlR.js";

export {
  STORAGE_KEYS,
  checkAndRefreshOAuthTokenIfNeeded,
  clearAuthTokenAndLocalStorage,
  ensureOffscreenDocument,
  executeMcpTool,
  getRuntimeConfig,
  getUserId,
  handleOAuthRedirect,
  isBridgeConnected,
  promptStore,
  registerBlockedPageNavigationListener,
  refreshFeatureFlags,
  sendBridgeNotification,
  setStorageValue,
  tabGroupManager,
};

export const NATIVE_HOST_NAME = "com.openai.codexextension";
export const NATIVE_HOST_STATUS_TIMEOUT_MS = 10_000;
export const POPULATE_PROMPT_INITIAL_DELAY_MS = 800;
export const POPULATE_PROMPT_RETRY_DELAY_MS = 500;
export const POPULATE_PROMPT_MAX_RETRIES = 5;
export const SCHEDULED_TASK_TAB_READY_TIMEOUT_MS = 30_000;
export const SCHEDULED_TASK_PROMPT_DELAY_MS = 3_000;

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSessionId(prefix = "session") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function parseMaybeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return tab ?? null;
}

export async function focusTab(tabId) {
  const tab = await chrome.tabs.get(tabId);

  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  await chrome.tabs.update(tabId, { active: true });
}

export async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {}
}

export function getOptionsPageUrl(hash = "") {
  const url = new URL(chrome.runtime.getURL("options.html"));
  if (hash) {
    url.hash = hash.startsWith("#") ? hash : `#${hash}`;
  }
  return url.toString();
}

export async function openOptionsPage(hash = "") {
  const optionsPageUrl = chrome.runtime.getURL("options.html");
  const targetUrl = getOptionsPageUrl(hash);
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find((tab) => tab.url?.startsWith(optionsPageUrl));

  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, {
      active: true,
      url: targetUrl,
    });

    if (typeof existingTab.windowId === "number") {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }

    return existingTab.id;
  }

  const createdTab = await chrome.tabs.create({ url: targetUrl });
  return createdTab.id;
}

export function getSidePanelPath(tabId) {
  return `sidepanel.html?tabId=${encodeURIComponent(tabId)}`;
}

export function getSidePanelWindowUrl({
  sessionId,
  skipPermissions = false,
  model,
} = {}) {
  const url = new URL(chrome.runtime.getURL("sidepanel.html"));
  url.searchParams.set("mode", "window");
  url.searchParams.set("sessionId", sessionId);

  if (skipPermissions) {
    url.searchParams.set("skipPermissions", "true");
  }

  if (model) {
    url.searchParams.set("model", model);
  }

  return url.toString();
}

export function getNotificationIconUrl() {
  return chrome.runtime.getURL("icon-128.png");
}

export async function showBasicNotification({
  message,
  priority = 0,
  title,
}) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: getNotificationIconUrl(),
      title,
      message,
      priority,
    });
  } catch {}
}

export function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const errorMessage = chrome.runtime.lastError?.message;
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }

      resolve(response);
    });
  });
}
