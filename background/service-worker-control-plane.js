import {
  STORAGE_KEYS,
  checkAndRefreshOAuthTokenIfNeeded,
  clearAuthTokenAndLocalStorage,
  createSessionId,
  delay,
  closeTab,
  ensureOffscreenDocument,
  getActiveTab,
  getRuntimeConfig,
  getSidePanelPath,
  getSidePanelWindowUrl,
  focusTab,
  openOptionsPage,
  parseMaybeNumber,
  promptStore,
  refreshFeatureFlags,
  registerBlockedPageNavigationListener,
  sendRuntimeMessage,
  setStorageValue,
  showBasicNotification,
  tabGroupManager,
  POPULATE_PROMPT_INITIAL_DELAY_MS,
  POPULATE_PROMPT_MAX_RETRIES,
  POPULATE_PROMPT_RETRY_DELAY_MS,
  SCHEDULED_TASK_PROMPT_DELAY_MS,
  SCHEDULED_TASK_TAB_READY_TIMEOUT_MS,
} from "./service-worker-apis.js";
import { BRIDGE_KEEPALIVE_ALARM_NAME } from "./service-worker-bridge.js";

const MAIN_TAB_ACK_CACHE_TTL_MS = 3_000;
const SIDE_PANEL_UNSUPPORTED_NOTIFICATION = {
  title: "Browser not supported",
  message:
    "Codex requires the Chrome Side Panel API, which isn't available in this browser. Use Google Chrome, Microsoft Edge, or Brave.",
};

let activeNativeHostController = null;
let activeBridgeController = null;
let sidePanelUnsupportedBrowserNotified = false;
const mainTabAckCache = new Map();

function getNativeHostController() {
  if (!activeNativeHostController) {
    throw new Error("Service worker control plane not initialized");
  }

  return activeNativeHostController;
}

function getBridgeController() {
  if (!activeBridgeController) {
    throw new Error("Service worker control plane not initialized");
  }

  return activeBridgeController;
}

function buildSidePanelWindowOptions({ sessionId, skipPermissions, model }) {
  return {
    url: getSidePanelWindowUrl({
      sessionId,
      skipPermissions,
      model,
    }),
    type: "popup",
    width: 500,
    height: 768,
    left: 100,
    top: 100,
    focused: true,
  };
}

async function updateSessionHeaderRules() {
  const config = getRuntimeConfig();
  const version = chrome.runtime.getManifest().version;
  const userAgentValue = `claude-browser-extension/${version} (external) ${navigator.userAgent} `;

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            {
              header: "User-Agent",
              operation: chrome.declarativeNetRequest.HeaderOperation.SET,
              value: userAgentValue,
            },
            {
              header: "openai-client-platform",
              operation: chrome.declarativeNetRequest.HeaderOperation.SET,
              value: "codex_chrome_extension",
            },
            {
              header: "openai-client-version",
              operation: chrome.declarativeNetRequest.HeaderOperation.SET,
              value: version,
            },
          ],
        },
        condition: {
          urlFilter: `${config.apiBaseUrl}/*`,
          resourceTypes: [
            chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
            chrome.declarativeNetRequest.ResourceType.OTHER,
          ].filter(Boolean),
        },
      },
    ],
  });
}

async function syncScheduledPrompts() {
  try {
    const prompts = (await promptStore.getAllPrompts()).filter(
      (prompt) => prompt.repeatType && prompt.repeatType !== "none",
    );

    if (prompts.length === 0) {
      return;
    }

    for (const prompt of prompts) {
      try {
        await promptStore.updateAlarmForPrompt(prompt);
      } catch {}
    }

    try {
      await promptStore.updateNextRunTimes();
    } catch {}
  } catch {}
}

function buildPromptTaskFromStoredPrompt(storedPrompt) {
  return {
    id: storedPrompt.id,
    name: storedPrompt.command || "Scheduled Task",
    prompt: storedPrompt.prompt,
    url: storedPrompt.url,
    enabled: true,
    skipPermissions: storedPrompt.skipPermissions !== false,
    model: storedPrompt.model,
  };
}

async function waitForTaskTabAndSendPrompt({
  isScheduledTask,
  prompt,
  runLogId,
  sessionId,
  tabId,
  taskName,
}) {
  const startedAt = Date.now();
  let sent = false;

  const pollUntilReady = async () => {
    if (Date.now() - startedAt > SCHEDULED_TASK_TAB_READY_TIMEOUT_MS) {
      throw new Error("Timeout waiting for tab to load for task execution");
    }

    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== "complete") {
      await delay(500);
      return pollUntilReady();
    }

    await delay(SCHEDULED_TASK_PROMPT_DELAY_MS);

    if (sent) {
      return;
    }

    sent = true;

    const response = await sendRuntimeMessage({
      type: "EXECUTE_TASK",
      prompt,
      taskName,
      runLogId,
      windowSessionId: sessionId,
      isScheduledTask,
    });

    if (!response?.success) {
      throw new Error("Failed to send prompt: side panel not ready");
    }
  };

  await delay(1_000);
  await pollUntilReady();
}

async function executeTaskInNewWindow(task, runLogId) {
  const sessionId = createSessionId("session");
  const window = await chrome.windows.create({
    url: task.url || "about:blank",
    type: "normal",
    focused: true,
  });

  if (!window || !window.id || !window.tabs || window.tabs.length === 0) {
    throw new Error("Failed to create window for scheduled task");
  }

  const tab = window.tabs[0];
  if (!tab.id) {
    throw new Error("Failed to get tab in new window for scheduled task");
  }

  await tabGroupManager.initialize(true);
  await tabGroupManager.createGroup(tab.id);
  await setStorageValue(STORAGE_KEYS.TARGET_TAB_ID, tab.id);

  await chrome.windows.create(
    buildSidePanelWindowOptions({
      sessionId,
      skipPermissions: task.skipPermissions,
      model: task.model,
    }),
  );

  await waitForTaskTabAndSendPrompt({
    isScheduledTask: true,
    prompt: task.prompt,
    runLogId,
    sessionId,
    tabId: tab.id,
    taskName: task.name,
  });
}

async function openOptionsPageWithScheduledTask(task) {
  await setStorageValue(STORAGE_KEYS.PENDING_SCHEDULED_TASK, task);
  await openOptionsPage("prompts");
  return { success: true };
}

async function retryPopulatePrompt(message) {
  const attemptPopulate = async (attempt = 0) => {
    try {
      await delay(
        attempt === 0
          ? POPULATE_PROMPT_INITIAL_DELAY_MS
          : POPULATE_PROMPT_RETRY_DELAY_MS,
      );

      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: "POPULATE_INPUT_TEXT",
            prompt: message.prompt,
            permissionMode: message.permissionMode,
            selectedModel: message.selectedModel,
            attachments: message.attachments,
          },
          (response) => {
            const errorMessage = chrome.runtime.lastError?.message;
            if (errorMessage || !response?.success) {
              reject(new Error(errorMessage ?? "side panel not ready"));
              return;
            }

            resolve();
          },
        );
      });
    } catch {
      if (attempt < POPULATE_PROMPT_MAX_RETRIES) {
        await attemptPopulate(attempt + 1);
      }
    }
  };

  await attemptPopulate();
}

async function openSidePanelForTab(tabId) {
  if (!chrome.sidePanel) {
    if (!sidePanelUnsupportedBrowserNotified) {
      sidePanelUnsupportedBrowserNotified = true;
      await showBasicNotification(SIDE_PANEL_UNSUPPORTED_NOTIFICATION);
    }

    return;
  }

  await tabGroupManager.initialize(true);

  const group = await tabGroupManager.findGroupByTab(tabId);
  const panelTabId = group && !group.isUnmanaged ? group.mainTabId : tabId;
  const setOptionsPromise = chrome.sidePanel.setOptions({
    tabId,
    path: getSidePanelPath(panelTabId),
    enabled: true,
  });
  const openPromise = chrome.sidePanel.open({ tabId });
  await Promise.all([setOptionsPromise, openPromise]);

  if (group) {
    if (group.isUnmanaged) {
      try {
        await tabGroupManager.adoptOrphanedGroup(tabId, group.chromeGroupId);
      } catch {}
    }

    return;
  }

  try {
    await tabGroupManager.createGroup(tabId);
  } catch {}

  void getNativeHostController().connect();
}

async function handleExternalNavigation(url, tabId) {
  const parsedUrl = new URL(url);
  if (parsedUrl.host !== "clau.de") {
    return false;
  }

  if (parsedUrl.pathname.toLowerCase() === "/chrome/permissions") {
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("options.html#permissions"),
      });
    } finally {
      await closeTab(tabId);
    }
    return true;
  }

  if (!parsedUrl.pathname.startsWith("/chrome/")) {
    return false;
  }

  const action = parsedUrl.pathname.slice("/chrome/".length).toLowerCase();

  if (action === "reconnect") {
    try {
      await getNativeHostController().disconnect({ removePermission: true });
      await getBridgeController().disconnect();
      await delay(500);
      await Promise.all([
        getNativeHostController().connect(),
        getBridgeController().connect(),
      ]);
    } finally {
      await closeTab(tabId);
    }
    return true;
  }

  if (action.startsWith("tab/")) {
    const targetTabId = Number.parseInt(action.slice("tab/".length), 10);
    if (Number.isNaN(targetTabId)) {
      await closeTab(tabId);
      return true;
    }

    try {
      await tabGroupManager.initialize();
      const group = await tabGroupManager.findGroupByTab(targetTabId);
      if (!group || group.isUnmanaged) {
        await closeTab(tabId);
        return true;
      }

      await focusTab(targetTabId);
      await closeTab(tabId);
      return true;
    } catch {
      await closeTab(tabId);
      return true;
    }
  }

  return false;
}

async function handleNotificationClick(notificationId) {
  await chrome.notifications.clear(notificationId);

  const [, maybeTabId] = notificationId.split("_");
  const parsedTabId =
    maybeTabId && maybeTabId !== "unknown"
      ? parseMaybeNumber(maybeTabId)
      : undefined;

  if (typeof parsedTabId === "number") {
    try {
      await focusTab(parsedTabId);
      return;
    } catch {}
  }

  const activeTab = await getActiveTab();
  if (activeTab?.windowId !== undefined) {
    await chrome.windows.update(activeTab.windowId, { focused: true });
  }
}

async function handleStaticIndicatorHeartbeat(sender) {
  const currentTabId = sender.tab?.id;
  if (!currentTabId) {
    return { success: false };
  }

  try {
    const currentTab = await chrome.tabs.get(currentTabId);
    const groupId = currentTab.groupId;

    if (
      typeof groupId !== "number" ||
      groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
    ) {
      return { success: false };
    }

    if (await tabGroupManager.findGroupByTab(currentTabId)) {
      return { success: true };
    }

    const groupTabs = await chrome.tabs.query({ groupId });
    for (const tab of groupTabs) {
      if (!tab.id || tab.id === currentTabId) {
        continue;
      }

      const now = Date.now();
      const cachedAck = mainTabAckCache.get(tab.id);
      if (cachedAck && now - cachedAck.timestamp < MAIN_TAB_ACK_CACHE_TTL_MS) {
        if (cachedAck.isAlive) {
          return { success: true };
        }

        continue;
      }

      const response = await sendRuntimeMessage({
        type: "MAIN_TAB_ACK_REQUEST",
        secondaryTabId: currentTabId,
        mainTabId: tab.id,
        timestamp: now,
      }).catch(() => null);

      const isAlive = Boolean(response?.success);
      mainTabAckCache.set(tab.id, {
        timestamp: now,
        isAlive,
      });

      if (isAlive) {
        return { success: true };
      }
    }
  } catch {}

  return { success: false };
}

async function handleDismissingStaticIndicators(sender) {
  const currentTabId = sender.tab?.id;
  if (!currentTabId) {
    return { success: false };
  }

  try {
    const currentTab = await chrome.tabs.get(currentTabId);
    const groupId = currentTab.groupId;

    if (
      typeof groupId !== "number" ||
      groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
    ) {
      return { success: false };
    }

    await tabGroupManager.initialize();
    await tabGroupManager.dismissStaticIndicatorsForGroup(groupId);
    return { success: true };
  } catch {
    return { success: false };
  }
}

async function handleRuntimeMessage(message, sender) {
  if (message.type === "SW_KEEPALIVE") {
    return undefined;
  }

  if (
    message.type === "pairing_confirmed" ||
    message.type === "pairing_dismissed"
  ) {
    return await getBridgeController().handleRuntimeMessage(message);
  }

  if (message.type === "check_and_refresh_oauth") {
    return await checkAndRefreshOAuthTokenIfNeeded();
  }

  if (message.type === "PLAY_NOTIFICATION_SOUND") {
    await ensureOffscreenDocument();
    await sendRuntimeMessage({
      type: "OFFSCREEN_PLAY_SOUND",
      audioUrl: message.audioUrl,
      volume: message.volume || 0.5,
    });
    return { success: true };
  }

  if (message.type === "open_side_panel") {
    const tabId = message.tabId || sender.tab?.id;
    if (!tabId) {
      return { success: false };
    }

    await openSidePanelForTab(tabId);

    if (message.prompt) {
      await retryPopulatePrompt(message);
    }

    return { success: true };
  }

  if (message.type === "logout") {
    await clearAuthTokenAndLocalStorage();
    await getBridgeController().disconnect();
    await tabGroupManager.clearAllGroups();
    return { success: true };
  }

  if (message.type === "check_native_host_status") {
    const controller = getNativeHostController();
    if (controller.port && controller.nativeHostInstalled) {
      const status = await controller.refreshStatus();
      return {
        status: {
          nativeHostInstalled: status.nativeHostInstalled,
          mcpConnected:
            status.mcpConnected || getBridgeController().isConnected(),
        },
      };
    }

    const status = controller.snapshot;
    return {
      status: {
        nativeHostInstalled: status.nativeHostInstalled,
        mcpConnected:
          status.mcpConnected || getBridgeController().isConnected(),
      },
    };
  }

  if (message.type === "SEND_MCP_NOTIFICATION") {
    const controller = getNativeHostController();
    const nativeHostSuccess = await controller.sendNotification(
      message.method,
      message.params,
    );
    const bridgeSuccess = getBridgeController().sendNotification(
      message.method,
      message.params,
    );
    return { success: nativeHostSuccess || bridgeSuccess };
  }

  if (message.type === "OPEN_OPTIONS_WITH_TASK") {
    return await openOptionsPageWithScheduledTask(message.task);
  }

  if (message.type === "EXECUTE_SCHEDULED_TASK") {
    if (sender.tab) {
      return { success: false, error: "Forbidden sender" };
    }

    try {
      const task = message.task;
      await executeTaskInNewWindow(task, message.runLogId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (message.type === "STOP_AGENT") {
    let targetTabId;

    if (message.fromTabId === "CURRENT_TAB" && sender.tab?.id) {
      targetTabId =
        (await tabGroupManager.getMainTabId(sender.tab.id)) || sender.tab.id;
    } else if (typeof message.fromTabId === "number") {
      targetTabId = message.fromTabId;
    }

    if (targetTabId) {
      chrome.runtime.sendMessage({
        type: "STOP_AGENT",
        targetTabId,
      });
    }

    return { success: true };
  }

  if (message.type === "SWITCH_TO_MAIN_TAB") {
    if (!sender.tab?.id) {
      return { success: false, error: "No sender tab" };
    }

    try {
      await tabGroupManager.initialize(true);
      const mainTabId = await tabGroupManager.getMainTabId(sender.tab.id);
      if (!mainTabId) {
        return { success: false, error: "No main tab found" };
      }

      await focusTab(mainTabId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (message.type === "SECONDARY_TAB_CHECK_MAIN") {
    try {
      const response = await sendRuntimeMessage({
        type: "MAIN_TAB_ACK_REQUEST",
        secondaryTabId: message.secondaryTabId,
        mainTabId: message.mainTabId,
        timestamp: message.timestamp,
      });
      return response?.success ? { success: true } : { success: false };
    } catch {
      return { success: false };
    }
  }

  if (message.type === "MAIN_TAB_ACK_RESPONSE") {
    return { success: Boolean(message.success) };
  }

  if (message.type === "STATIC_INDICATOR_HEARTBEAT") {
    return await handleStaticIndicatorHeartbeat(sender);
  }

  if (message.type === "DISMISS_STATIC_INDICATOR_FOR_GROUP") {
    return await handleDismissingStaticIndicators(sender);
  }

  return undefined;
}

async function handleExternalMessage(message, sender) {
  const origin = sender.origin;
  if (!origin || !["https://chatgpt.com", "https://openai.com"].includes(origin)) {
    return { success: false, error: "Untrusted origin" };
  }

  if (message.type === "oauth_redirect") {
    const response = await handleOAuthRedirect(
      message.redirect_uri,
      sender?.tab?.id,
    );
    if (response.success) {
      void refreshFeatureFlags()
        .then(() => getBridgeController().connect())
        .catch(() => {});
      void getNativeHostController().connect();
    }

    return response;
  }

  if (message.type === "ping") {
    return { success: true, exists: true };
  }

  if (message.type === "onboarding_task") {
    try {
      const response = await sendRuntimeMessage({
        type: "POPULATE_INPUT_TEXT",
        prompt: message.payload?.prompt,
      });

      return {
        success: Boolean(response?.success),
        error: response?.success ? undefined : "side panel not ready",
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "side panel not ready",
      };
    }
  }

  return { success: false, error: "Unsupported message" };
}

async function handleAlarm(alarm) {
  if (alarm.name === BRIDGE_KEEPALIVE_ALARM_NAME) {
    await getBridgeController().handleAlarm(alarm);
    return;
  }

  if (alarm.name.startsWith("prompt_")) {
    try {
      const prompt = (await promptStore.getAllPrompts()).find(
        (entry) => entry.id === alarm.name,
      );

      if (!prompt) {
        return;
      }

      const runLogId = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const task = buildPromptTaskFromStoredPrompt(prompt);

      try {
        await executeTaskInNewWindow(task, runLogId);
      } catch (error) {
        await showBasicNotification({
          title: "Scheduled Task Failed",
          message: `Task "${prompt.command || "Scheduled Task"}" failed to execute. ${
            error instanceof Error ? error.message : String(error)
          }`,
          priority: 2,
        });
      }

      if (
        prompt.repeatType === "monthly" ||
        prompt.repeatType === "annually"
      ) {
        try {
          await promptStore.updateAlarmForPrompt(prompt);
        } catch {
          try {
            await chrome.alarms.create(`retry_${alarm.name}`, {
              delayInMinutes: 1,
            });
          } catch {}

          await showBasicNotification({
            title: "Scheduled Task Setup Failed",
            message: `Failed to schedule next occurrence of "${
              prompt.command || "Scheduled Task"
            }". Please check the task settings.`,
            priority: 2,
          });
        }
      }
    } catch {}

    return;
  }

  if (!alarm.name.startsWith("retry_")) {
    return;
  }

  try {
    const promptId = alarm.name.replace("retry_", "");
    const prompt = (await promptStore.getAllPrompts()).find(
      (entry) => entry.id === promptId,
    );

    if (
      prompt &&
      (prompt.repeatType === "monthly" || prompt.repeatType === "annually")
    ) {
      try {
        await promptStore.updateAlarmForPrompt(prompt);
      } catch {
        await showBasicNotification({
          title: "Scheduled Task Needs Attention",
          message: `Could not automatically reschedule "${
            prompt.command || "Scheduled Task"
          }". Please edit the task to reschedule it.`,
          priority: 2,
        });
      }
    }
  } catch {}
}

async function handleNavigationBeforeNavigate(details) {
  if (details.frameId !== 0) {
    return;
  }

  try {
    await handleExternalNavigation(details.url, details.tabId);
  } catch {}
}

async function handleNotificationSelection(notificationId) {
  await chrome.notifications.clear(notificationId);

  const [, maybeTabId] = notificationId.split("_");
  const parsedTabId =
    maybeTabId && maybeTabId !== "unknown"
      ? parseMaybeNumber(maybeTabId)
      : undefined;

  if (typeof parsedTabId === "number") {
    try {
      await focusTab(parsedTabId);
      return;
    } catch {}
  }

  const activeTab = await getActiveTab();
  if (activeTab?.windowId !== undefined) {
    await chrome.windows.update(activeTab.windowId, { focused: true });
  }
}

async function handleInstall() {
  await chrome.storage.local.remove(["updateAvailable"]);
  await tabGroupManager.initialize();
  await updateSessionHeaderRules();
  void getBridgeController().connect();
  void getNativeHostController().connect();
  await syncScheduledPrompts();
}

async function handleStartup() {
  await updateSessionHeaderRules();
  await tabGroupManager.initialize();
  void getBridgeController().connect();
  void getNativeHostController().connect();
  await syncScheduledPrompts();
}

async function handleActionClick(tab) {
  if (!tab.id) {
    return;
  }

  void openSidePanelForTab(tab.id).catch(() => {});
}

async function handleCommand(command) {
  if (command !== "toggle-side-panel") {
    return;
  }

  const activeTab = await getActiveTab();
  if (activeTab?.id) {
    void openSidePanelForTab(activeTab.id).catch(() => {});
  }
}

async function handleUpdateAvailable() {
  await setStorageValue(STORAGE_KEYS.UPDATE_AVAILABLE, true);
}

function registerListeners() {
  chrome.runtime.onInstalled.addListener(() => {
    void handleInstall().catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => {
    void handleStartup().catch(() => {});
  });

  chrome.permissions.onAdded.addListener((permissions) => {
    if (permissions.permissions?.includes("nativeMessaging")) {
      void getNativeHostController().connect();
    }
  });

  chrome.permissions.onRemoved.addListener((permissions) => {
    if (permissions.permissions?.includes("nativeMessaging")) {
      void getNativeHostController().disconnect();
    }
  });

  chrome.action.onClicked.addListener((tab) => {
    void handleActionClick(tab).catch(() => {});
  });

  chrome.notifications.onClicked.addListener((notificationId) => {
    void handleNotificationSelection(notificationId).catch(() => {});
  });

  chrome.commands.onCommand.addListener((command) => {
    void handleCommand(command).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      const response = await handleRuntimeMessage(message, sender);
      if (typeof response !== "undefined") {
        sendResponse(response);
      } else {
        sendResponse();
      }
    })().catch((error) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return true;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void tabGroupManager.handleTabClosed(tabId);
  });

  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    void handleNavigationBeforeNavigate(details).catch(() => {});
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    void handleAlarm(alarm).catch(() => {});
  });

  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    (async () => {
      const response = await handleExternalMessage(message, sender);
      sendResponse(response);
    })().catch((error) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return true;
  });

  chrome.runtime.onUpdateAvailable.addListener(() => {
    void handleUpdateAvailable().catch(() => {});
  });
}

export function initializeServiceWorkerControlPlane(
  nativeHostController,
  bridgeController,
) {
  activeNativeHostController = nativeHostController;
  activeBridgeController = bridgeController;
  registerBlockedPageNavigationListener();
  void ensureOffscreenDocument().catch(() => {});
  void bridgeController.start();
  void nativeHostController.connect();
  registerListeners();
}
