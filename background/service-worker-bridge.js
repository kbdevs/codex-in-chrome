import {
  STORAGE_KEYS,
  checkAndRefreshOAuthTokenIfNeeded,
  executeMcpTool,
  getRuntimeConfig,
  getUserId,
  parseMaybeNumber,
  sendRuntimeMessage,
  setStorageValue,
  tabGroupManager,
} from "./service-worker-apis.js";

export const BRIDGE_KEEPALIVE_ALARM_NAME = "bridge-keepalive";

const BRIDGE_RECONNECT_BASE_DELAY_MS = 2_000;
const BRIDGE_RECONNECT_MAX_DELAY_MS = 20_000;
const BRIDGE_PING_INTERVAL_MS = 20_000;
const BRIDGE_STALE_SOCKET_MS = 90_000;
const BRIDGE_TOKEN_REFRESH_MS = 30 * 60 * 1_000;
const REMOTE_BRIDGE_ENABLED = false;

function getPlatformLabel() {
  try {
    return navigator.userAgentData?.platform ?? navigator.platform ?? "Unknown";
  } catch {
    return navigator.platform ?? "Unknown";
  }
}

function buildPairingUrl({ requestId, clientType, currentName }) {
  const url = new URL(chrome.runtime.getURL("pairing.html"));
  if (requestId) {
    url.searchParams.set("request_id", requestId);
  }
  if (clientType) {
    url.searchParams.set("client_type", clientType);
  }
  if (typeof currentName !== "undefined") {
    url.searchParams.set("current_name", currentName || "");
  }
  return url.toString();
}

function buildBrowserBatchTabId(args) {
  if (!args || !Array.isArray(args.actions)) {
    return undefined;
  }

  const action = args.actions.find(
    (entry) => typeof entry?.input?.tabId === "number",
  );

  return action?.input?.tabId;
}

async function readLocalStorage(keys) {
  return await chrome.storage.local.get(keys);
}

export class BridgeController {
  constructor() {
    this.socket = null;
    this.connecting = false;
    this.started = false;
    this.deviceId = null;
    this.displayName = null;
    this.accountUuid = null;
    this.lastPairingRequestId = null;
    this.pendingPairingResponses = [];
    this.reconnectAttempt = 0;
    this.reconnectTimeoutId = null;
    this.keepaliveIntervalId = null;
    this.lastPongAt = 0;
    this.lastTokenRefreshAt = Date.now();
    this.shouldReconnect = true;
  }

  get snapshot() {
    return {
      bridgeConnected: this.isConnected(),
    };
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async start() {
    if (this.started) {
      return;
    }

    this.started = true;

    try {
      await chrome.alarms.create(BRIDGE_KEEPALIVE_ALARM_NAME, {
        periodInMinutes: 0.5,
      });
    } catch {}

    void this.connect();
  }

  async connect() {
    // The recovered production bundle kept this remote websocket bridge dormant.
    // Leave the implementation below intact for reference, but do not open the
    // ChatGPT bridge on extension startup because the server rejects it with a
    // 403 handshake for this unpacked reconstruction.
    if (!REMOTE_BRIDGE_ENABLED) {
      return false;
    }

    if (this.socket || this.connecting) {
      return Boolean(this.socket);
    }

    this.connecting = true;
    this.clearReconnectTimeout();

    try {
      const config = getRuntimeConfig();
      const tokenStatus = await checkAndRefreshOAuthTokenIfNeeded();
      if (!tokenStatus.isValid) {
        return false;
      }

      const storage = await readLocalStorage([
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.ACCOUNT_UUID,
        "bridgeDisplayName",
        "bridgeDeviceId",
      ]);

      const accessToken = storage[STORAGE_KEYS.ACCESS_TOKEN];
      let accountUuid = storage[STORAGE_KEYS.ACCOUNT_UUID];
      if (!accessToken) {
        return false;
      }

      if (!accountUuid) {
        accountUuid = await getUserId(accessToken);
      }

      if (!accountUuid) {
        return false;
      }

      this.accountUuid = accountUuid;
      this.displayName = storage.bridgeDisplayName;
      this.deviceId = storage.bridgeDeviceId || crypto.randomUUID();

      if (!storage.bridgeDeviceId) {
        await chrome.storage.local.set({ bridgeDeviceId: this.deviceId });
      }

      const url = `wss://chatgpt.com/backend-api/codex/chrome/${accountUuid}`;
      const socket = new WebSocket(url);
      this.socket = socket;
      this.lastPongAt = 0;
      this.shouldReconnect = true;

      socket.onopen = () => {
        if (this.socket !== socket) {
          return;
        }

        this.clearReconnectTimeout();
        this.reconnectAttempt = 0;
        this.lastPongAt = Date.now();
        this.flushPendingPairingResponses();

        const payload = {
          type: "connect",
          client_type: "chrome-extension",
          device_id: this.deviceId,
          os_platform: getPlatformLabel(),
          extension_version: chrome.runtime.getManifest().version,
        };

        if (this.displayName) {
          payload.display_name = this.displayName;
        }

        if (!config.localBridge) {
          payload.oauth_token = accessToken;
        }

        this.sendJson(payload);
        this.startKeepaliveInterval();
      };

      socket.onmessage = (event) => {
        void this.handleSocketMessage(event.data);
      };

      socket.onerror = () => {
        if (this.socket === socket) {
          this.connecting = false;
        }
      };

      socket.onclose = (event) => {
        void this.handleSocketClose(socket, event);
      };

      return true;
    } catch {
      this.socket = null;
      return false;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect() {
    this.shouldReconnect = false;
    this.reconnectAttempt = 0;
    this.clearReconnectTimeout();
    this.stopKeepaliveInterval();
    this.connecting = false;

    const socket = this.socket;
    this.socket = null;

    if (socket) {
      try {
        socket.onclose = null;
        socket.close();
      } catch {}
    }

    await setStorageValue(STORAGE_KEYS.MCP_CONNECTED, false);
    tabGroupManager.stopTabGroupChangeListener();
  }

  async handleAlarm(alarm) {
    if (alarm.name !== BRIDGE_KEEPALIVE_ALARM_NAME) {
      return;
    }

    void this.connect();

    if (!this.isConnected()) {
      return;
    }

    if (
      this.lastPongAt > 0 &&
      Date.now() - this.lastPongAt > BRIDGE_STALE_SOCKET_MS
    ) {
      try {
        this.socket?.close(4001, "pong-timeout");
      } catch {}
      return;
    }

    this.sendJson({ type: "ping" });

    if (Date.now() - this.lastTokenRefreshAt >= BRIDGE_TOKEN_REFRESH_MS) {
      this.lastTokenRefreshAt = Date.now();
      void checkAndRefreshOAuthTokenIfNeeded().catch(() => {});
    }
  }

  async handleRuntimeMessage(message) {
    if (message.type !== "pairing_confirmed" && message.type !== "pairing_dismissed") {
      return undefined;
    }

    if (message.type === "pairing_confirmed") {
      if (typeof message.name === "string") {
        this.displayName = message.name;
        try {
          await chrome.storage.local.set({ bridgeDisplayName: message.name });
        } catch {}
      }

      await this.queueOrSend({
        type: "pairing_response",
        request_id: message.request_id,
        device_id: await this.ensureDeviceId(),
        name: this.displayName || message.name,
      });
      return { ok: true };
    }

    await this.queueOrSend({
      type: "pairing_response",
      request_id: message.request_id,
      dismissed: true,
    });
    return { ok: true };
  }

  sendNotification(method, params) {
    return this.sendJson({
      type: "notification",
      method,
      params: params || {},
    });
  }

  async handleSocketMessage(rawMessage) {
    let message;
    try {
      message = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
    } catch {
      return;
    }

    switch (message?.type) {
      case "paired":
      case "waiting":
        this.lastPongAt = Date.now();
        break;
      case "ping":
        this.sendJson({ type: "pong" });
        break;
      case "pong":
        this.lastPongAt = Date.now();
        break;
      case "peer_connected":
        await setStorageValue(STORAGE_KEYS.MCP_CONNECTED, true);
        await tabGroupManager.initialize();
        tabGroupManager.startTabGroupChangeListener();
        break;
      case "peer_disconnected":
        await setStorageValue(STORAGE_KEYS.MCP_CONNECTED, false);
        tabGroupManager.stopTabGroupChangeListener();
        break;
      case "tool_call":
        await this.handleToolCall(message);
        break;
      case "pairing_request":
        await this.handlePairingRequest(message);
        break;
      case "error":
        break;
      default:
        break;
    }
  }

  async handleSocketClose(socket, event) {
    if (this.socket !== socket) {
      return;
    }

    this.socket = null;
    this.stopKeepaliveInterval();
    this.connecting = false;
    await setStorageValue(STORAGE_KEYS.MCP_CONNECTED, false);
    tabGroupManager.stopTabGroupChangeListener();

    if (!this.shouldReconnect) {
      return;
    }

    this.scheduleReconnect();

    if (event?.code === 1008) {
      this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 2);
    }
  }

  async handleToolCall(message) {
    const targetDeviceId = message.target_device_id;
    const deviceId = await this.ensureDeviceId();
    if (targetDeviceId && targetDeviceId !== deviceId) {
      return;
    }

    const toolUseId = message.tool_use_id;
    const toolName = message.tool;
    if (!toolUseId || !toolName) {
      return;
    }

    const authState = await chrome.storage.local.get(
      STORAGE_KEYS.LAST_AUTH_FAILURE_REASON,
    );
    if (authState[STORAGE_KEYS.LAST_AUTH_FAILURE_REASON] === "session_expired") {
      this.sendJson({
        type: "tool_result",
        tool_use_id: toolUseId,
        error: {
          content: [
            {
              type: "text",
              text:
                "Authentication failed. The extension may need to be re-authenticated. Open the Codex in Chrome side panel and sign in again.",
            },
          ],
        },
      });
      return;
    }

    const args = message.args ?? {};
    const browserBatchTabId =
      toolName === "browser_batch" ? buildBrowserBatchTabId(args) : undefined;
    const requestedTabId = args.tabId ?? browserBatchTabId;
    const tabId = parseMaybeNumber(requestedTabId);
    const tabGroupId = parseMaybeNumber(args.tabGroupId);

    if (typeof tabId === "number") {
      try {
        await chrome.tabs.get(tabId);
      } catch {
        if (targetDeviceId) {
          this.sendJson({
            type: "tool_result",
            tool_use_id: toolUseId,
            error: {
              content: [
                {
                  type: "text",
                  text: `Tab ${tabId} no longer exists. Call tabs_context_mcp to get current tabs.`,
                },
              ],
            },
          });
        }
        return;
      }
    }

    try {
      const result = await executeMcpTool({
        toolName,
        args,
        tabId,
        tabGroupId,
        clientId: message.client_type || "desktop",
        source: "bridge",
        permissionMode: message.permission_mode,
        allowedDomains: message.allowed_domains,
        toolUseId,
        handlePermissionPrompts: false,
        sessionScope: message.session_scope,
      });

      if (!result) {
        return;
      }

      this.sendJson({
        ...result,
        type: "tool_result",
        tool_use_id: toolUseId,
      });
    } catch (error) {
      this.sendJson({
        type: "tool_result",
        tool_use_id: toolUseId,
        error: {
          content: [
            {
              type: "text",
              text: `Tool execution failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        },
      });
    }
  }

  async handlePairingRequest(message) {
    const requestId = message.request_id;
    if (!requestId || requestId === this.lastPairingRequestId) {
      return;
    }

    this.lastPairingRequestId = requestId;
    const currentName = this.displayName || (await this.getStoredDisplayName());

    try {
      const response = await sendRuntimeMessage({
        type: "show_pairing_prompt",
        request_id: requestId,
        client_type: message.client_type || "desktop",
        current_name: currentName,
      }).catch(() => null);

      if (response?.handled) {
        return;
      }
    } catch {}

    try {
      await chrome.tabs.create({
        url: buildPairingUrl({
          requestId,
          clientType: message.client_type || "desktop",
          currentName,
        }),
      });
    } catch {}
  }

  async queueOrSend(message) {
    if (!this.isConnected()) {
      this.pendingPairingResponses.push(message);
      return false;
    }

    return this.sendJson(message);
  }

  async flushPendingPairingResponses() {
    if (!this.isConnected() || this.pendingPairingResponses.length === 0) {
      return;
    }

    const pending = this.pendingPairingResponses.splice(0);
    for (const message of pending) {
      this.sendJson(message);
    }
  }

  async ensureDeviceId() {
    if (this.deviceId) {
      return this.deviceId;
    }

    const storage = await readLocalStorage(["bridgeDeviceId"]);
    this.deviceId = storage.bridgeDeviceId || crypto.randomUUID();
    if (!storage.bridgeDeviceId) {
      await chrome.storage.local.set({ bridgeDeviceId: this.deviceId });
    }
    return this.deviceId;
  }

  async getStoredDisplayName() {
    const storage = await readLocalStorage(["bridgeDisplayName"]);
    this.displayName = storage.bridgeDisplayName || null;
    return this.displayName;
  }

  sendJson(message) {
    if (!this.isConnected()) {
      return false;
    }

    try {
      this.socket?.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  startKeepaliveInterval() {
    this.stopKeepaliveInterval();
    this.keepaliveIntervalId = setInterval(() => {
      if (!this.isConnected()) {
        return;
      }

      if (
        this.lastPongAt > 0 &&
        Date.now() - this.lastPongAt > BRIDGE_STALE_SOCKET_MS
      ) {
        try {
          this.socket?.close(4001, "pong-timeout");
        } catch {}
        return;
      }

      this.sendJson({ type: "ping" });
    }, BRIDGE_PING_INTERVAL_MS);
  }

  stopKeepaliveInterval() {
    if (this.keepaliveIntervalId) {
      clearInterval(this.keepaliveIntervalId);
      this.keepaliveIntervalId = null;
    }
  }

  clearReconnectTimeout() {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimeoutId || !this.shouldReconnect) {
      return;
    }

    this.reconnectAttempt += 1;
    const delayMs = Math.min(
      BRIDGE_RECONNECT_BASE_DELAY_MS * Math.pow(1.5, this.reconnectAttempt - 1),
      BRIDGE_RECONNECT_MAX_DELAY_MS,
    );

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      void this.connect();
    }, delayMs);
  }
}
