import {
  STORAGE_KEYS,
  NATIVE_HOST_NAME,
  NATIVE_HOST_STATUS_TIMEOUT_MS,
  executeMcpTool,
  parseMaybeNumber,
  setStorageValue,
  tabGroupManager,
} from "./service-worker-apis.js";

const NATIVE_HOST_CANDIDATES = [{ name: NATIVE_HOST_NAME, label: "Codex" }];

function appendPermissionDeniedGuidance(content) {
  const guidance =
    "IMPORTANT: The user has explicitly declined this action. Do not attempt to use other tools or workarounds. Instead, acknowledge the denial and ask the user how they would prefer to proceed.";

  if (typeof content === "string") {
    return content.includes("Permission denied by user")
      ? `${content} - ${guidance}`
      : content;
  }

  return content.map((item) => {
    if (
      item &&
      typeof item === "object" &&
      "text" in item &&
      typeof item.text === "string" &&
      item.text.includes("Permission denied by user")
    ) {
      return { ...item, text: `${item.text} - ${guidance}` };
    }

    return item;
  });
}

function buildToolResponsePayload(result) {
  if (
    !result ||
    (typeof result.content !== "string" && !Array.isArray(result.content))
  ) {
    return null;
  }

  if (result.is_error) {
    return {
      type: "tool_response",
      error: { content: appendPermissionDeniedGuidance(result.content) },
    };
  }

  return {
    type: "tool_response",
    result: { content: result.content },
  };
}

function parseBrowserBatchTabId(args) {
  if (!args || !Array.isArray(args.actions)) {
    return undefined;
  }

  const action = args.actions.find(
    (entry) => typeof entry?.input?.tabId === "number",
  );

  return action?.input?.tabId;
}

export class NativeHostController {
  constructor() {
    this.port = null;
    this.hostName = null;
    this.connecting = false;
    this.nativeHostInstalled = false;
    this.mcpConnected = false;
    this.statusResolver = null;
    this.statusTimeoutId = null;
    this.statusPromise = null;
    this.boundMessageHandler = null;
    this.boundDisconnectHandler = null;
  }

  get snapshot() {
    return {
      nativeHostInstalled: this.nativeHostInstalled,
      mcpConnected: this.mcpConnected,
    };
  }

  async connect() {
    if (this.port) {
      return true;
    }

    if (this.connecting) {
      return false;
    }

    this.connecting = true;

    try {
      const hasPermission = await chrome.permissions.contains({
        permissions: ["nativeMessaging"],
      });

      if (!hasPermission) {
        return false;
      }

      if (typeof chrome.runtime.connectNative !== "function") {
        return false;
      }

      for (const candidate of NATIVE_HOST_CANDIDATES) {
        try {
          const port = chrome.runtime.connectNative(candidate.name);
          const isAlive = await this.pingPort(port);

          if (!isAlive) {
            try {
              port.disconnect();
            } catch {}
            continue;
          }

          this.port = port;
          this.hostName = candidate.name;
          this.nativeHostInstalled = true;
          this.boundMessageHandler = (message) => {
            void this.handleMessage(message);
          };
          this.boundDisconnectHandler = () => {
            void this.handleDisconnect();
          };
          port.onMessage.addListener(this.boundMessageHandler);
          port.onDisconnect.addListener(this.boundDisconnectHandler);
          try {
            port.postMessage({ type: "get_status" });
          } catch {
            this.port = null;
            this.hostName = null;
            this.nativeHostInstalled = false;
            this.mcpConnected = false;
            this.clearStatusTimeout();
            this.resolvePendingStatus(this.snapshot);
            try {
              port.disconnect();
            } catch {}
            continue;
          }
          return true;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("native messaging host not found")
          ) {
            this.nativeHostInstalled = false;
          }
        }
      }

      return false;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("native messaging host not found")
      ) {
        this.nativeHostInstalled = false;
      }

      return false;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect({ removePermission = false } = {}) {
    const port = this.port;
    this.port = null;
    this.hostName = null;
    this.connecting = false;
    this.nativeHostInstalled = false;
    this.mcpConnected = false;
    this.boundMessageHandler = null;
    this.boundDisconnectHandler = null;
    this.statusPromise = null;
    this.resolvePendingStatus(this.snapshot);

    if (port) {
      try {
        port.disconnect();
      } catch {}
    }

    if (removePermission) {
      try {
        await chrome.permissions.remove({ permissions: ["nativeMessaging"] });
      } catch {}
    }

    await setStorageValue(STORAGE_KEYS.MCP_CONNECTED, false);
    tabGroupManager.stopTabGroupChangeListener();
    return true;
  }

  async refreshStatus() {
    if (!this.port || !this.nativeHostInstalled) {
      return this.snapshot;
    }

    if (this.statusResolver) {
      return this.statusPromise;
    }

    this.statusPromise = new Promise((resolve) => {
      this.statusResolver = resolve;
      this.clearStatusTimeout();
      this.statusTimeoutId = setTimeout(() => {
        this.resolvePendingStatus(this.snapshot);
      }, NATIVE_HOST_STATUS_TIMEOUT_MS);

      try {
        this.port.postMessage({ type: "get_status" });
      } catch {
        this.resolvePendingStatus(this.snapshot);
      }
    }).finally(() => {
      this.clearStatusTimeout();
      this.statusResolver = null;
      this.statusPromise = null;
    });

    return this.statusPromise;
  }

  async sendNotification(method, params) {
    if (!this.port) {
      return false;
    }

    try {
      this.port.postMessage({
        type: "notification",
        jsonrpc: "2.0",
        method,
        params: params || {},
      });
      return true;
    } catch {
      return false;
    }
  }

  async handleMessage(message) {
    switch (message?.type) {
      case "tool_request":
        await this.handleToolRequest(message);
        break;
      case "status_response":
        this.resolvePendingStatus(this.snapshot);
        break;
      case "mcp_connected":
        this.nativeHostInstalled = true;
        this.mcpConnected = true;
        await setStorageValue(STORAGE_KEYS.MCP_CONNECTED, true);
        await tabGroupManager.initialize();
        tabGroupManager.startTabGroupChangeListener();
        break;
      case "mcp_disconnected":
        this.mcpConnected = false;
        await setStorageValue(STORAGE_KEYS.MCP_CONNECTED, false);
        tabGroupManager.stopTabGroupChangeListener();
        break;
      default:
        break;
    }
  }

  async handleToolRequest(message) {
    try {
      const { method, params } = message;

      if (method !== "execute_tool") {
        this.postToolResponse({
          content: `Unknown method: ${method}`,
        });
        return;
      }

      if (!params?.tool) {
        this.postToolResponse({
          content: "No tool specified",
          is_error: true,
        });
        return;
      }

      const tabGroupId = parseMaybeNumber(params.args?.tabGroupId);
      const requestedTabId =
        params.args?.tabId ??
        (params.tool === "browser_batch"
          ? parseBrowserBatchTabId(params.args)
          : undefined);
      const tabId = parseMaybeNumber(requestedTabId);

      const result = await executeMcpTool({
        toolName: params.tool,
        args: params.args || {},
        tabId,
        tabGroupId,
        clientId: params.client_id,
        source: "native-messaging",
        sessionScope: params.session_scope,
      });

      this.postToolResponse(result);
    } catch (error) {
      this.postToolResponse({
        content: `Tool execution failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        is_error: true,
      });
    }
  }

  postToolResponse(result) {
    const payload = buildToolResponsePayload(result);
    if (!payload || !this.port) {
      return;
    }

    try {
      this.port.postMessage(payload);
    } catch {}
  }

  async handleDisconnect() {
    const port = this.port;
    if (!port) {
      return;
    }

    const errorMessage = chrome.runtime.lastError?.message;
    if (
      errorMessage &&
      errorMessage.includes("native messaging host not found")
    ) {
      this.nativeHostInstalled = false;
    }

    if (this.port !== port) {
      return;
    }

    this.port = null;
    this.hostName = null;
    this.mcpConnected = false;
    this.connecting = false;
    this.boundMessageHandler = null;
    this.boundDisconnectHandler = null;
    this.resolvePendingStatus(this.snapshot);
    this.clearStatusTimeout();
    this.statusPromise = null;
    await setStorageValue(STORAGE_KEYS.MCP_CONNECTED, false);
    tabGroupManager.stopTabGroupChangeListener();
  }

  async pingPort(port) {
    return new Promise((resolve) => {
      let settled = false;

      const cleanup = () => {
        try {
          port.onDisconnect.removeListener(onDisconnect);
        } catch {}
        try {
          port.onMessage.removeListener(onMessage);
        } catch {}
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };

      const finish = (value) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(value);
      };

      const onDisconnect = () => {
        finish(false);
      };

      const onMessage = (message) => {
        if (message?.type === "pong") {
          finish(true);
        }
      };

      const timeoutId = setTimeout(() => {
        finish(false);
      }, NATIVE_HOST_STATUS_TIMEOUT_MS);

      port.onDisconnect.addListener(onDisconnect);
      port.onMessage.addListener(onMessage);

      try {
        port.postMessage({ type: "ping" });
      } catch {
        finish(false);
      }
    });
  }

  resolvePendingStatus(status) {
    if (!this.statusResolver) {
      return;
    }

    clearTimeout(this.statusTimeoutId);
    this.statusTimeoutId = null;

    const resolver = this.statusResolver;
    this.statusResolver = null;
    resolver(status);
  }

  clearStatusTimeout() {
    if (this.statusTimeoutId) {
      clearTimeout(this.statusTimeoutId);
      this.statusTimeoutId = null;
    }
  }
}
