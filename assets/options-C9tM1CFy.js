import { r as React, j as jsxRuntime } from "./index-BBLsn8fp.js";
import { R as ReactDOM } from "./index-Bd-JAv43.js";
import {
  P as PermissionManager,
  b as startOAuthFlow,
} from "./PermissionManager-BqJmxUlR.js";

const { Fragment, jsx, jsxs } = jsxRuntime;
const {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} = React;

const ALLOWED_TABS = ["permissions", "prompts", "options"];
const ACCESS_TOKEN_KEY = "accessToken";
const NOTIFICATIONS_ENABLED_KEY = "notificationsEnabled";
const HIDE_HIGH_RISK_BANNER_KEY = "codex_hide_high_risk_banner";
const SAVED_PROMPTS_KEY = "savedPrompts";
const MODEL_CONFIG = {
  default: "gpt-5.5",
  options: [
    { model: "gpt-5.5", name: "GPT-5.5" },
    { model: "gpt-5.4", name: "GPT-5.4" },
    { model: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { model: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { model: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { model: "gpt-5.2", name: "GPT-5.2" },
  ],
};

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const PROMPT_REPEAT_OPTIONS = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "annually", label: "Annually" },
];

const INPUT_CLASS =
  "w-full rounded-lg border border-border-300 bg-bg-000 px-3 py-2 text-sm text-text-100 outline-none transition-colors placeholder:text-text-400 focus:border-border-200 focus:ring-2 focus:ring-accent-100/20";
const TEXTAREA_CLASS =
  "w-full rounded-lg border border-border-300 bg-bg-000 px-3 py-2 text-sm text-text-100 outline-none transition-colors placeholder:text-text-400 focus:border-border-200 focus:ring-2 focus:ring-accent-100/20";
const SELECT_CLASS = `${INPUT_CLASS} pr-8`;
const PANEL_CLASS =
  "bg-bg-100 border border-border-300 rounded-xl px-6 pt-6 pb-6 md:px-8 md:pt-8 md:pb-8";
const PRIMARY_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-brand-100 px-4 py-2.5 font-base text-oncolor-100 transition-colors hover:bg-brand-100/90 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border-300 px-4 py-2 font-base text-text-200 transition-colors hover:bg-bg-200 hover:text-text-100";
const DANGER_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-base text-danger-000 transition-colors hover:bg-danger-000/10";
const NAV_BUTTON_CLASS =
  "block w-full whitespace-nowrap rounded-lg px-3 py-3 text-left font-base transition-all ease-in-out active:scale-95";
const TOGGLE_TRACK_CLASS =
  "relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-border-300 after:bg-white after:transition-all";
const chromeStorageArea = globalThis.chrome?.storage?.local ?? null,
  chromeStorageEvents = globalThis.chrome?.storage?.onChanged ?? null,
  FALLBACK_STORAGE_PREFIX = "__codex_options__:";

function cx(...parts) {
  return parts.flat(Infinity).filter(Boolean).join(" ");
}

function notify(message, type = "success") {
  window.showToast?.(message, type);
}

function formatOrdinal(day) {
  if (day === 1 || day === 21 || day === 31) return "st";
  if (day === 2 || day === 22) return "nd";
  if (day === 3 || day === 23) return "rd";
  return "th";
}

function formatModelName(model) {
  const exactMatch = MODEL_CONFIG.options.find((entry) => entry.model === model);
  if (exactMatch) return exactMatch.name;
  if (model === "gpt-5.5") return "GPT-5.5";
  if (model === "gpt-5.4") return "GPT-5.4";
  if (model === "gpt-5.4-mini") return "GPT-5.4 Mini";
  if (model === "gpt-5.3-codex-spark") return "GPT-5.3 Codex Spark";
  if (model === "gpt-5.3-codex") return "GPT-5.3 Codex";
  if (model === "gpt-5.2") return "GPT-5.2";

  const gptMatch = model.match(/^gpt-(\d+(?:\.\d+)?(?:-[a-z]+)?)/i);
  if (gptMatch) return `GPT-${gptMatch[1]}`;

  const claudeMatch = model.match(/claude-(sonnet|opus|haiku)-(\d+(?:\.\d+)?)/i);
  if (claudeMatch) {
    const family = claudeMatch[1].charAt(0).toUpperCase() + claudeMatch[1].slice(1);
    return `${family} ${claudeMatch[2]}`;
  }

  return model;
}

function getModelOptions(currentModel) {
  const options = [...MODEL_CONFIG.options];
  if (currentModel && !options.some((entry) => entry.model === currentModel)) {
    options.unshift({ model: currentModel, name: formatModelName(currentModel) });
  }
  return options;
}

function parseHashState() {
  const hash = window.location.hash.replace(/^#/, "");
  const [rawTab = "permissions", query = ""] = hash.split("?");
  const tab = ALLOWED_TABS.includes(rawTab) ? rawTab : "permissions";
  const params = new URLSearchParams(query);
  const requestMicrophone = params.get("requestMicrophone") === "true";
  const returnTabIdText = params.get("returnTabId");
  const returnTabId = returnTabIdText ? Number.parseInt(returnTabIdText, 10) : undefined;
  return {
    tab,
    requestMicrophone,
    returnTabId: Number.isFinite(returnTabId) ? returnTabId : undefined,
  };
}

function isPromptScheduled(prompt) {
  return Boolean(prompt.repeatType && prompt.repeatType !== "none");
}

function getYesterdayDateForInput() {
  return new Date(Date.now() - 86400000).toISOString().split("T")[0];
}

async function readStorageValue(key) {
  if (chromeStorageArea) {
    const result = await chromeStorageArea.get(key);
    return result[key];
  }

  try {
    const serializedValue = window.localStorage.getItem(`${FALLBACK_STORAGE_PREFIX}${key}`);
    return serializedValue === null ? undefined : JSON.parse(serializedValue);
  } catch {
    return undefined;
  }
}

async function writeStorageValue(key, value) {
  if (chromeStorageArea) {
    if (value === undefined) {
      await chromeStorageArea.remove(key);
      return;
    }

    await chromeStorageArea.set({ [key]: value });
    return;
  }

  const fallbackKey = `${FALLBACK_STORAGE_PREFIX}${key}`;
  if (value === undefined) {
    window.localStorage.removeItem(fallbackKey);
    return;
  }

  window.localStorage.setItem(fallbackKey, JSON.stringify(value));
}

function subscribeToStorageChanges(key, onChange) {
  if (chromeStorageEvents) {
    const handleStorageChange = (changes, areaName) => {
      if (areaName !== "local" || !(key in changes)) return;
      onChange(changes[key].newValue);
    };

    chromeStorageEvents.addListener(handleStorageChange);
    return () => chromeStorageEvents.removeListener(handleStorageChange);
  }

  const fallbackKey = `${FALLBACK_STORAGE_PREFIX}${key}`;
  const handleWindowStorage = (event) => {
    if (event.storageArea !== window.localStorage || event.key !== fallbackKey) return;
    onChange(event.newValue === null ? undefined : JSON.parse(event.newValue));
  };

  window.addEventListener("storage", handleWindowStorage);
  return () => window.removeEventListener("storage", handleWindowStorage);
}

function useChromeStorageValue(key, defaultValue) {
  const [value, setValue] = useState(defaultValue);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const storedValue = await readStorageValue(key);
        if (!alive) return;
        setValue(storedValue === undefined ? defaultValue : storedValue);
      } catch {
        if (!alive) return;
        setValue(defaultValue);
      } finally {
        if (alive) setIsLoaded(true);
      }
    };

    load();
    const unsubscribe = subscribeToStorageChanges(key, (nextValue) => {
      if (!alive) return;
      setValue(nextValue === undefined ? defaultValue : nextValue);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [defaultValue, key]);

  const updateValue = useCallback(
    async (nextValue) => {
      const resolvedValue =
        typeof nextValue === "function" ? nextValue(value) : nextValue;
      setValue(resolvedValue);
      await writeStorageValue(key, resolvedValue);
    },
    [key, value],
  );

  return [value, updateValue, isLoaded];
}

function usePromptList() {
  const [prompts, setPrompts] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const applyPromptList = useCallback((nextList) => {
    const sorted = [...nextList].sort(
      (left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0),
    );
    setPrompts(sorted);
  }, []);

  const loadPrompts = useCallback(async () => {
    try {
      const storedPrompts = await readStorageValue(SAVED_PROMPTS_KEY);
      applyPromptList(Array.isArray(storedPrompts) ? storedPrompts : []);
    } catch {
      applyPromptList([]);
    } finally {
      setIsLoaded(true);
    }
  }, [applyPromptList]);

  useEffect(() => {
    let alive = true;

    loadPrompts();
    const unsubscribe = subscribeToStorageChanges(SAVED_PROMPTS_KEY, (nextList) => {
      if (!alive) return;
      applyPromptList(Array.isArray(nextList) ? nextList : []);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [applyPromptList, loadPrompts]);

  return { prompts, isLoaded, refreshPrompts: loadPrompts };
}

function useAuthState() {
  const [accessToken, , isLoaded] = useChromeStorageValue(ACCESS_TOKEN_KEY, null);

  return {
    accessToken,
    isAuthenticated: Boolean(accessToken),
    isLoaded,
  };
}

function useCommandShortcut(commandName) {
  const [shortcut, setShortcut] = useState("");

  const refreshShortcut = useCallback(() => {
    chrome.commands.getAll((commands) => {
      const command = commands.find((entry) => entry.name === commandName);
      setShortcut(command?.shortcut || "");
    });
  }, [commandName]);

  useEffect(() => {
    refreshShortcut();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshShortcut();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshShortcut]);

  return shortcut;
}

function useMicrophonePermission(isActive, onGranted) {
  const [state, setState] = useState("unknown");
  const permissionStatusRef = useRef(null);
  const onGrantedRef = useRef(onGranted);

  useEffect(() => {
    onGrantedRef.current = onGranted;
  }, [onGranted]);

  const refreshPermission = useCallback(async () => {
    try {
      const status = await navigator.permissions.query({ name: "microphone" });
      permissionStatusRef.current = status;
      setState(status.state);
      return status.state;
    } catch {
      setState("unknown");
      return "unknown";
    }
  }, []);

  useEffect(() => {
    if (!isActive) return undefined;

    let cancelled = false;
    let cleanup = () => {};

    const handlePermissionChange = () => {
      const nextState = permissionStatusRef.current?.state || "unknown";
      setState(nextState);
      if (nextState === "granted") {
        onGrantedRef.current?.();
      }
    };

    const initialize = async () => {
      try {
        const status = await navigator.permissions.query({ name: "microphone" });
        if (cancelled) return;
        permissionStatusRef.current = status;
        setState(status.state);
        status.addEventListener("change", handlePermissionChange);
        cleanup = () => status.removeEventListener("change", handlePermissionChange);
      } catch {
        if (!cancelled) setState("unknown");
      }
    };

    initialize();

    return () => {
      cancelled = true;
      cleanup();
      permissionStatusRef.current = null;
    };
  }, [isActive]);

  return [state, refreshPermission];
}

async function queryCurrentTabOrigin() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      if (!url) {
        resolve("");
        return;
      }

      try {
        const origin = new URL(url).origin;
        resolve(origin.startsWith("http") ? origin : "");
      } catch {
        resolve("");
      }
    });
  });
}

async function requestMicrophoneAccess() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

async function savePromptToStorage(prompt) {
  const prompts = await loadPromptsFromStorage();

  if (prompt.command && prompts.some((entry) => entry.command === prompt.command)) {
    throw new Error(`/${prompt.command} is already in use`);
  }

  const savedPrompt = {
    ...prompt,
    id: `prompt_${Date.now()}`,
    createdAt: prompt.createdAt || Date.now(),
    usageCount: prompt.usageCount || 0,
  };

  prompts.push(savedPrompt);
  await chrome.storage.local.set({ [SAVED_PROMPTS_KEY]: prompts });
  await schedulePromptAlarm(savedPrompt);
  return savedPrompt;
}

async function updatePromptInStorage(promptId, changes) {
  const prompts = await loadPromptsFromStorage();
  const index = prompts.findIndex((entry) => entry.id === promptId);
  if (index === -1) return undefined;

  if (changes.command && changes.command !== prompts[index].command) {
    const duplicate = prompts.find((entry) => entry.command === changes.command);
    if (duplicate) {
      throw new Error(`/${changes.command} is already in use`);
    }
  }

  prompts[index] = { ...prompts[index], ...changes };
  await chrome.storage.local.set({ [SAVED_PROMPTS_KEY]: prompts });
  await schedulePromptAlarm(prompts[index]);
  return prompts[index];
}

async function deletePromptFromStorage(promptId) {
  const prompts = await loadPromptsFromStorage();
  const targetPrompt = prompts.find((entry) => entry.id === promptId);
  const nextPrompts = prompts.filter((entry) => entry.id !== promptId);

  if (nextPrompts.length === prompts.length) {
    return false;
  }

  if (targetPrompt) {
    await chrome.alarms.clear(promptId);
  }

  await chrome.storage.local.set({ [SAVED_PROMPTS_KEY]: nextPrompts });
  return true;
}

async function loadPromptsFromStorage() {
  const storedPrompts = await readStorageValue(SAVED_PROMPTS_KEY);
  return Array.isArray(storedPrompts) ? storedPrompts : [];
}

async function schedulePromptAlarm(prompt) {
  await chrome.alarms.clear(prompt.id);

  if (!isPromptScheduled(prompt) || !prompt.specificTime) {
    return;
  }

  const now = new Date();
  const [hours, minutes] = prompt.specificTime.split(":").map(Number);

  switch (prompt.repeatType) {
    case "once": {
      if (!prompt.specificDate) return;
      const [year, month, day] = prompt.specificDate.split("-").map(Number);
      const scheduledDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
      if (scheduledDate > now) {
        await chrome.alarms.create(prompt.id, { when: scheduledDate.getTime() });
      }
      break;
    }
    case "daily": {
      const scheduledDate = new Date();
      scheduledDate.setHours(hours, minutes, 0, 0);
      if (scheduledDate <= now) {
        scheduledDate.setDate(scheduledDate.getDate() + 1);
      }
      await chrome.alarms.create(prompt.id, {
        when: scheduledDate.getTime(),
        periodInMinutes: 1440,
      });
      break;
    }
    case "weekly": {
      if (prompt.dayOfWeek === undefined) return;
      let daysUntil = (prompt.dayOfWeek - now.getDay() + 7) % 7;
      if (daysUntil === 0) {
        const scheduledToday = new Date();
        scheduledToday.setHours(hours, minutes, 0, 0);
        if (scheduledToday <= now) {
          daysUntil = 7;
        }
      }

      const scheduledDate = new Date();
      scheduledDate.setDate(now.getDate() + daysUntil);
      scheduledDate.setHours(hours, minutes, 0, 0);
      await chrome.alarms.create(prompt.id, {
        when: scheduledDate.getTime(),
        periodInMinutes: 10080,
      });
      break;
    }
    case "monthly": {
      if (!prompt.dayOfMonth) return;
      const scheduledDate = new Date();
      scheduledDate.setDate(prompt.dayOfMonth);
      scheduledDate.setHours(hours, minutes, 0, 0);
      if (scheduledDate <= now) {
        scheduledDate.setMonth(scheduledDate.getMonth() + 1);
      }
      await chrome.alarms.create(prompt.id, { when: scheduledDate.getTime() });
      break;
    }
    case "annually": {
      if (!prompt.monthAndDay) return;
      const [month, day] = prompt.monthAndDay.split("-").map(Number);
      const scheduledDate = new Date();
      scheduledDate.setMonth(month - 1);
      scheduledDate.setDate(day);
      scheduledDate.setHours(hours, minutes, 0, 0);
      if (scheduledDate <= now) {
        scheduledDate.setFullYear(scheduledDate.getFullYear() + 1);
      }
      await chrome.alarms.create(prompt.id, { when: scheduledDate.getTime() });
      break;
    }
    default:
      break;
  }
}

function formatPromptSchedule(prompt) {
  if (!isPromptScheduled(prompt)) {
    return "";
  }

  const timeText = prompt.specificTime
    ? new Date(`2000-01-01T${prompt.specificTime}`).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";
  const suffix = timeText ? ` at ${timeText}` : "";

  switch (prompt.repeatType) {
    case "once":
      if (prompt.specificDate) {
        const [year, month, day] = prompt.specificDate.split("-").map(Number);
        return `${MONTH_LABELS[month - 1]} ${day}, ${year}${suffix}`;
      }
      return `Once${suffix}`;
    case "daily":
      return `Daily${suffix}`;
    case "weekly":
      return `Weekly on ${WEEKDAY_LABELS[prompt.dayOfWeek || 0]}${suffix}`;
    case "monthly":
      return `Monthly on day ${prompt.dayOfMonth || 1}${suffix}`;
    case "annually":
      if (prompt.monthAndDay) {
        const [month, day] = prompt.monthAndDay.split("-").map(Number);
        return `Annually on ${MONTH_LABELS[month - 1]} ${day}${suffix}`;
      }
      return `Annually${suffix}`;
    default:
      return "";
  }
}

function formatPermissionScope(permission) {
  if (permission.scope.type === "domain_transition") {
    return `${permission.scope.fromDomain} → ${permission.scope.toDomain}`;
  }

  return (
    permission.scope.netloc ||
    "Unknown domain"
  );
}

function IconBase({ children, className, ...props }) {
  return jsx("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    ...props,
    children,
  });
}

function CheckCircleIcon(props) {
  return jsx(IconBase, {
    ...props,
    children: jsxs(Fragment, {
      children: [
        jsx("circle", { cx: "12", cy: "12", r: "9" }),
        jsx("path", { d: "m8 12 2.5 2.5L16 9" }),
      ],
    }),
  });
}

function XCircleIcon(props) {
  return jsx(IconBase, {
    ...props,
    children: jsxs(Fragment, {
      children: [
        jsx("circle", { cx: "12", cy: "12", r: "9" }),
        jsx("path", { d: "m9 9 6 6" }),
        jsx("path", { d: "m15 9-6 6" }),
      ],
    }),
  });
}

function MicIcon(props) {
  return jsx(IconBase, {
    ...props,
    children: jsxs(Fragment, {
      children: [
        jsx("path", { d: "M9 10a3 3 0 0 1 6 0v3a3 3 0 0 1-6 0z" }),
        jsx("path", { d: "M5 11v2a7 7 0 0 0 14 0v-2" }),
        jsx("path", { d: "M12 18v4" }),
      ],
    }),
  });
}

function LogoutIcon(props) {
  return jsx(IconBase, {
    ...props,
    children: jsxs(Fragment, {
      children: [
        jsx("path", { d: "m16 17 5-5-5-5" }),
        jsx("path", { d: "M21 12H9" }),
        jsx("path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }),
      ],
    }),
  });
}

function UserIcon(props) {
  return jsx(IconBase, {
    ...props,
    children: jsxs(Fragment, {
      children: [
        jsx("circle", { cx: "12", cy: "8", r: "4" }),
        jsx("path", { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" }),
      ],
    }),
  });
}

function KeyboardIcon(props) {
  return jsx(IconBase, {
    ...props,
    children: jsxs(Fragment, {
      children: [
        jsx("rect", { x: "3", y: "5", width: "18", height: "14", rx: "2" }),
        jsx("path", { d: "M7 9h.01" }),
        jsx("path", { d: "M10 9h.01" }),
        jsx("path", { d: "M14 9h.01" }),
        jsx("path", { d: "M17 9h.01" }),
        jsx("path", { d: "M7 13h10" }),
      ],
    }),
  });
}

function ClockIcon(props) {
  return jsx(IconBase, {
    ...props,
    children: jsxs(Fragment, {
      children: [
        jsx("circle", { cx: "12", cy: "12", r: "9" }),
        jsx("path", { d: "M12 7v5l3 2" }),
      ],
    }),
  });
}

function AlertIcon(props) {
  return jsx(IconBase, {
    ...props,
    children: jsxs(Fragment, {
      children: [
        jsx("path", { d: "M12 9v4" }),
        jsx("path", { d: "M12 17h.01" }),
        jsx("path", { d: "M10.3 4.7 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.7a2 2 0 0 0-3.4 0z" }),
      ],
    }),
  });
}

function MenuIcon(props) {
  return jsx(IconBase, {
    ...props,
    children: jsxs(Fragment, {
      children: [
        jsx("path", { d: "M5 7h14" }),
        jsx("path", { d: "M5 12h14" }),
        jsx("path", { d: "M5 17h14" }),
      ],
    }),
  });
}

function Modal({ open, onClose, title, children, childrenClassName, sizeClassName = "max-w-2xl" }) {
  if (!open) return null;

  return jsx("div", {
    className:
      "fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity duration-200",
    onClick: (event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
    children: jsx("div", {
      className: cx(
        "bg-bg-000 mx-4 w-full rounded-2xl shadow-xl transition-all duration-200",
        sizeClassName,
      ),
      children: jsxs("div", {
        className: cx("px-6 pb-6 pt-6", childrenClassName),
        children: [
          jsxs("div", {
            className: "mb-4 flex items-start justify-between gap-4",
            children: [
              jsx("h2", {
                className: "font-xl-bold text-text-100",
                children: title,
              }),
              jsx("button", {
                type: "button",
                onClick: onClose,
                className: "rounded-lg p-2 text-text-300 transition-colors hover:bg-bg-200",
                "aria-label": "Close",
                children: jsx(XCircleIcon, { className: "h-4 w-4" }),
              }),
            ],
          }),
          children,
        ],
      }),
    }),
  });
}

function Field({ label, error, helperText, children, className }) {
  return jsxs("div", {
    className,
    children: [
      jsx("label", {
        className: "mb-1 block font-base text-text-200",
        children: label,
      }),
      children,
      error
        ? jsx("p", {
            className: "mt-1 text-sm text-danger-000",
            children: error,
          })
        : helperText
          ? jsx("p", {
              className: "mt-1 text-sm text-text-400",
              children: helperText,
            })
          : null,
    ],
  });
}

function ToggleSwitch({ checked, onChange, disabled }) {
  return jsx("label", {
    className: "relative inline-flex cursor-pointer items-center",
    children: jsxs(Fragment, {
      children: [
        jsx("input", {
          type: "checkbox",
          className: "sr-only peer",
          checked,
          disabled,
          onChange,
        }),
        jsx("div", {
          className: cx(
            TOGGLE_TRACK_CLASS,
            "bg-bg-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent-100 peer-checked:bg-accent-100",
            "after:content-[''] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full",
          ),
        }),
      ],
    }),
  });
}

function Spinner() {
  return jsx("div", {
    className: "h-8 w-8 animate-spin rounded-full border-b-2 border-text-100",
  });
}

function PageLoadingState({ label = "Loading..." }) {
  return jsx("div", {
    className: "flex min-h-[360px] items-center justify-center",
    children: jsxs("div", {
      className: "flex flex-col items-center gap-4 text-text-200",
      children: [
        jsx(Spinner, {}),
        jsx("div", { className: "font-base", children: label }),
      ],
    }),
  });
}

function Toast({ toast, onClose }) {
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsLeaving(true);
      window.setTimeout(() => {
        onClose(toast.id);
      }, 200);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [onClose, toast.id]);

  return jsxs("div", {
    className: cx(
      "flex min-w-[300px] items-center gap-2 rounded-xl border-[0.5px] border-border-300 bg-bg-000 px-4 py-3 shadow-lg transition-all duration-200 ease-out",
      isLeaving ? "translate-x-full opacity-0" : "translate-x-0 opacity-100",
    ),
    children: [
      toast.type === "success"
        ? jsx(CheckCircleIcon, { className: "h-4 w-4 flex-shrink-0 text-accent-100" })
        : jsx(AlertIcon, { className: "h-4 w-4 flex-shrink-0 text-danger-000" }),
      jsx("p", {
        className: "flex-1 font-base text-text-200",
        children: toast.message,
      }),
      jsx("button", {
        type: "button",
        onClick: () => {
          setIsLeaving(true);
          window.setTimeout(() => onClose(toast.id), 200);
        },
        className: "flex-shrink-0 rounded p-1 transition-colors hover:bg-bg-100",
        children: jsx(XCircleIcon, { className: "h-4 w-4 text-text-300" }),
      }),
    ],
  });
}

function ToastViewport() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "success") => {
    const id = Date.now().toString();
    setToasts((current) => [...current, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    window.showToast = addToast;
    return () => {
      delete window.showToast;
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return jsx("div", {
    className: "fixed right-4 top-4 z-50 flex flex-col gap-2",
    children: toasts.map((toast) => jsx(Toast, { toast, onClose: removeToast }, toast.id)),
  });
}

function LoginScreen({ onLogin, isLoggingIn }) {
  return jsx("div", {
    className: "flex min-h-[420px] items-center justify-center px-4",
    children: jsx("div", {
      className:
        "w-full max-w-md rounded-2xl border border-border-300 bg-bg-100 px-8 py-10 text-center shadow-sm",
      children: jsxs("div", {
        className: "flex flex-col items-center",
        children: [
          jsx("div", {
            className:
              "mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100/10 text-brand-100",
            children: jsx(UserIcon, { className: "h-8 w-8" }),
          }),
          jsx("h2", {
            className: "font-xl-bold text-text-100",
            children: "Log in to use Codex in Chrome",
          }),
          jsx("p", {
            className: "mt-3 max-w-sm font-base text-text-300",
            children: "Sign in to view settings, manage shortcuts, and use the extension.",
          }),
          jsx("button", {
            type: "button",
            onClick: onLogin,
            disabled: isLoggingIn,
            className: cx(PRIMARY_BUTTON_CLASS, "mt-6 min-w-32"),
            children: isLoggingIn ? "Logging in..." : "Log in",
          }),
        ],
      }),
    }),
  });
}

function SectionCard({ title, description, children, className }) {
  return jsxs("section", {
    className: cx(PANEL_CLASS, className),
    children: [
      jsx("h3", {
        className: "font-xl-bold text-text-100",
        children: title,
      }),
      description
        ? jsx("p", {
            className: "mt-2 mb-6 font-base text-text-300",
            children: description,
          })
        : null,
      children,
    ],
  });
}

function ShortcutSection() {
  const shortcut = useCommandShortcut("toggle-side-panel");

  return jsx(SectionCard, {
    title: "Keyboard shortcut",
    description: "Configure the keyboard shortcut used to open Codex in Chrome.",
    children: jsxs("div", {
      className: "flex items-center justify-between gap-4 py-4",
      children: [
        jsx("div", {
          className: "flex-1",
          children: jsxs(Fragment, {
            children: [
              jsx("div", {
                className: "font-large text-text-100",
                children: "Open side panel",
              }),
              jsx("div", {
                className: "mt-1 text-text-400 font-base-sm",
                children: shortcut
                  ? jsxs(Fragment, {
                      children: [
                        "Current shortcut: ",
                        jsx("kbd", {
                          className:
                            "rounded border border-border-300 bg-bg-300 px-1.5 py-0.5 font-mono text-xs text-text-200",
                          children: shortcut,
                        }),
                      ],
                    })
                  : "No shortcut configured",
              }),
            ],
          }),
        }),
        jsx("button", {
          type: "button",
          onClick: () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
          className: SECONDARY_BUTTON_CLASS,
          children: jsxs(Fragment, {
            children: ["+", " Configure"],
          }),
        }),
      ],
    }),
  });
}

function SafetyBannerSection() {
  const [hideHighRiskBanner, setHideHighRiskBanner] = useChromeStorageValue(
    HIDE_HIGH_RISK_BANNER_KEY,
    false,
  );

  return jsx(SectionCard, {
    title: "Safety banner",
    description: "Hide the high-risk reminder shown when Codex can act without asking.",
    children: jsxs("div", {
      className: "flex items-center justify-between gap-4 py-4",
      children: [
        jsx("div", {
          className: "flex-1",
          children: jsxs(Fragment, {
            children: [
              jsx("div", {
                className: "font-large text-text-100",
                children: "Hide high-risk banner",
              }),
              jsx("div", {
                className: "mt-1 text-text-400 font-base-sm",
                children:
                  "This only hides the banner. It does not change permission behavior.",
              }),
            ],
          }),
        }),
        jsx(ToggleSwitch, {
          checked: Boolean(hideHighRiskBanner),
          onChange: (event) => setHideHighRiskBanner(event.target.checked),
        }),
      ],
    }),
  });
}

function NotificationsSection() {
  const [notificationsEnabled, setNotificationsEnabled] = useChromeStorageValue(
    NOTIFICATIONS_ENABLED_KEY,
    undefined,
  );

  const checked = notificationsEnabled === "enabled";
  const statusText =
    notificationsEnabled === "enabled"
      ? "You'll receive notifications when tasks finish"
      : notificationsEnabled === "disabled"
        ? "Notifications are turned off"
        : "You haven't set your notification preference yet";

  return jsx(SectionCard, {
    title: "Notifications",
    description: "Get notified when tasks complete or need your input.",
    children: jsxs("div", {
      className: "flex items-center justify-between gap-4 py-4",
      children: [
        jsx("div", {
          className: "flex-1",
          children: jsxs(Fragment, {
            children: [
              jsx("div", {
                className: "font-large text-text-100",
                children: "Task completion notifications",
              }),
              jsx("div", {
                className: "mt-1 text-text-400 font-base-sm",
                children: statusText,
              }),
            ],
          }),
        }),
        jsx(ToggleSwitch, {
          checked,
          onChange: (event) =>
            setNotificationsEnabled(event.target.checked ? "enabled" : "disabled"),
        }),
      ],
    }),
  });
}

function MicrophoneSection() {
  const [permissionState, refreshPermission] = useMicrophonePermission(true);
  const [isRequesting, setIsRequesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const openChromeSettings = () => {
    chrome.tabs.create({
      url: `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${chrome.runtime.id}%2F`,
    });
  };

  const handleRequestAccess = async () => {
    setIsRequesting(true);
    setErrorMessage("");

    try {
      await requestMicrophoneAccess();
      const nextState = await refreshPermission();
      if (nextState !== "granted") {
        setErrorMessage(
          'You selected "Allow this time" which does not persist. Please click the button again and select "Allow while visiting the site" to enable voice narration.',
        );
      }
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError") {
          await refreshPermission();
        } else if (error.name === "NotFoundError") {
          setErrorMessage("No microphone found. Please connect a microphone and try again.");
        } else {
          setErrorMessage(`Error: ${error.message}`);
        }
      } else if (error instanceof Error) {
        setErrorMessage(`Error: ${error.message}`);
      } else {
        setErrorMessage("An unknown error occurred");
      }
    } finally {
      setIsRequesting(false);
    }
  };

  return jsx(SectionCard, {
    title: "Microphone",
    description:
      "Enable microphone access to use your browser's speech-to-text functionality for voice narration during workflow recording.",
    children: jsxs("div", {
      className: "space-y-4",
      children: [
        permissionState === "granted"
          ? jsxs("div", {
              className: "flex items-start gap-3 rounded-xl border border-success-100/20 bg-success-100/10 p-4",
              children: [
                jsx("div", {
                  className:
                    "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-success-100",
                  children: jsx(CheckCircleIcon, { className: "h-3 w-3 text-oncolor-100" }),
                }),
                jsx("div", {
                  children: jsxs(Fragment, {
                    children: [
                      jsx("div", {
                        className: "font-large text-text-100",
                        children: "Microphone access granted",
                      }),
                      jsx("div", {
                        className: "mt-1 text-text-400 font-base-sm",
                        children: jsxs(Fragment, {
                          children: [
                            "You can now use voice narration when recording workflows. To disable, go to ",
                            jsx("button", {
                              type: "button",
                              onClick: openChromeSettings,
                              className: "cursor-pointer text-brand-100 hover:underline",
                              children: "Chrome settings",
                            }),
                            ".",
                          ],
                        }),
                      }),
                    ],
                  }),
                }),
              ],
            })
          : null,

        permissionState === "denied"
          ? jsxs("div", {
              className: "flex items-start gap-3 rounded-xl border border-danger-000/20 bg-danger-000/10 p-4",
              children: [
                jsx("div", {
                  className:
                    "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-danger-200",
                  children: jsx(XCircleIcon, { className: "h-3 w-3 text-danger-000" }),
                }),
                jsx("div", {
                  children: jsxs(Fragment, {
                    children: [
                      jsx("div", {
                        className: "font-large text-text-100",
                        children: "Microphone access blocked",
                      }),
                      jsx("div", {
                        className: "mt-1 text-text-400 font-base-sm",
                        children: jsxs(Fragment, {
                          children: [
                            "Microphone access has been denied. To enable, change Microphone to 'Allow' in ",
                            jsx("button", {
                              type: "button",
                              onClick: openChromeSettings,
                              className: "cursor-pointer text-brand-100 hover:underline",
                              children: "Chrome settings",
                            }),
                            ".",
                          ],
                        }),
                      }),
                    ],
                  }),
                }),
              ],
            })
          : null,

        (permissionState === "prompt" || permissionState === "unknown") &&
          jsxs("div", {
            children: [
              jsx("button", {
                type: "button",
                onClick: handleRequestAccess,
                disabled: isRequesting,
                className: PRIMARY_BUTTON_CLASS,
                children: isRequesting ? "Requesting..." : "Allow Microphone Access",
              }),
              errorMessage
                ? jsx("div", {
                    className:
                      "mt-3 rounded-lg border border-danger-000/20 bg-danger-000/10 px-4 py-3 text-danger-000",
                    children: errorMessage,
                  })
                : null,
            ],
          }),

        errorMessage && permissionState !== "prompt" && permissionState !== "unknown"
          ? jsx("div", {
              className:
                "rounded-lg border border-danger-000/20 bg-danger-000/10 px-4 py-3 text-danger-000",
              children: errorMessage,
            })
          : null,
      ],
    }),
  });
}

function ApprovedPermissionList({ permissions, onRevoke, formatScope }) {
  return jsx("div", {
    children: permissions.map((permission, index) =>
      jsxs(Fragment, {
        children: [
          jsxs("div", {
            className: "flex items-center justify-between gap-4 py-4",
            children: [
              jsx("div", {
                className: "flex-1",
                children: jsxs(Fragment, {
                  children: [
                    jsx("div", {
                      className: "font-large text-text-100",
                      children: formatScope(permission),
                    }),
                    permission.lastUsed
                      ? jsx("div", {
                          className: "mt-1 text-xs text-text-400",
                          children: `Last used: ${new Date(permission.lastUsed).toLocaleString()}`,
                        })
                      : null,
                  ],
                }),
              }),
              jsx("button", {
                type: "button",
                onClick: () => onRevoke(permission.id),
                className: DANGER_BUTTON_CLASS,
                children: "Revoke",
              }),
            ],
          }),
          index < permissions.length - 1
            ? jsx("div", { className: "border-b border-border-400" })
            : null,
        ],
      }, permission.id),
    ),
  });
}

function PermissionsTab() {
  const permissionManager = useMemo(
    () => new PermissionManager(() => false),
    [],
  );
  const [permissionsByScope, setPermissionsByScope] = useState({
    netloc: [],
    domain_transition: [],
  });
  const [isLoading, setIsLoading] = useState(true);

  const loadPermissions = useCallback(async () => {
    setIsLoading(true);
    try {
      await permissionManager.loadPermissions();
      const nextPermissions = permissionManager.getPermissionsByScope();
      setPermissionsByScope({
        netloc: nextPermissions.netloc.filter((permission) => !permission.toolUseId),
        domain_transition: nextPermissions.domain_transition.filter(
          (permission) => !permission.toolUseId,
        ),
      });
    } finally {
      setIsLoading(false);
    }
  }, [permissionManager]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const handleRevoke = async (permissionId) => {
    await permissionManager.revokePermission(permissionId);
    await loadPermissions();
  };

  if (isLoading) {
    return jsx("div", {
      className: "p-6 text-text-200",
      children: "Loading permissions...",
    });
  }

  return jsxs("div", {
    className: "space-y-6",
    children: [
      jsx(NotificationsSection, {}),
      jsx(MicrophoneSection, {}),
      jsx(SectionCard, {
        title: "Your approved sites",
        description:
          "You have allowed Codex to take all actions (browse, click, type) on these sites.",
        children:
          permissionsByScope.netloc.length > 0
            ? jsx(ApprovedPermissionList, {
                permissions: permissionsByScope.netloc,
                onRevoke: handleRevoke,
                formatScope: formatPermissionScope,
              })
            : jsx("div", {
                className: "pb-5 text-text-400 font-base-sm",
                children: "No sites have been approved yet",
              }),
      }),
      permissionsByScope.domain_transition.length > 0
        ? jsx(SectionCard, {
            title: "Domain transitions",
            description: "Permissions for navigating between different domains.",
            children: jsx(ApprovedPermissionList, {
              permissions: permissionsByScope.domain_transition,
              onRevoke: handleRevoke,
              formatScope: formatPermissionScope,
            }),
          })
        : null,
    ],
  });
}

function PromptCard({ prompt, scheduleText, onEdit, onDelete, menuOpen, setMenuOpen }) {
  return jsxs("div", {
    className:
      "group relative w-full cursor-pointer rounded-2xl border border-border-300 bg-bg-000 p-4 shadow-[0_2px_4px_0_rgba(0,0,0,0.04)] transition-all hover:border-border-200 hover:shadow-[0_4px_20px_0_rgba(0,0,0,0.08)]",
    onClick: onEdit,
    children: [
      jsxs("div", {
        className: "mb-2 flex items-start justify-between gap-2",
        children: [
          jsx("div", {
            className: "min-w-0 flex-1 text-left",
            children: prompt.command
              ? jsxs("div", {
                  className: "relative overflow-hidden font-large-bold text-text-200",
                  children: [
                    jsxs("div", {
                      className: "whitespace-nowrap",
                      children: [
                        jsx("span", {
                          className: "font-mono text-text-500/50",
                          children: "/",
                        }),
                        jsx("span", {
                          className: "ml-0.5",
                          children: prompt.command,
                        }),
                      ],
                    }),
                    jsx("div", {
                      className:
                        "pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bg-000 to-transparent",
                    }),
                  ],
                })
              : null,
          }),
          jsx("div", {
            className: "relative",
            "data-prompt-menu-root": "true",
            onClick: (event) => event.stopPropagation(),
            children: jsxs(Fragment, {
              children: [
                jsx("button", {
                  type: "button",
                  onClick: () => setMenuOpen(menuOpen ? null : prompt.id),
                  className:
                    "relative z-10 rounded p-1 opacity-0 transition-colors hover:bg-bg-200 group-hover:opacity-100",
                  children: jsx(MenuIcon, { className: "h-4 w-4 text-text-300" }),
                }),
                menuOpen
                  ? jsx("div", {
                      className:
                        "absolute right-0 top-8 z-20 min-w-32 rounded-xl border border-border-300 bg-bg-000 p-1 shadow-lg",
                      children: jsxs(Fragment, {
                        children: [
                          jsx("button", {
                            type: "button",
                            onClick: () => {
                              setMenuOpen(null);
                              onEdit();
                            },
                            className:
                              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-200 transition-colors hover:bg-bg-200",
                            children: "Edit",
                          }),
                          jsx("button", {
                            type: "button",
                            onClick: () => {
                              setMenuOpen(null);
                              onDelete();
                            },
                            className:
                              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger-000 transition-colors hover:bg-danger-000/10",
                            children: "Delete",
                          }),
                        ],
                      }),
                    })
                  : null,
              ],
            }),
          }),
        ],
      }),
      jsx("div", {
        className: "w-full rounded-lg bg-bg-100 p-3 text-left",
        children: jsx("div", {
          className: "h-24 overflow-y-auto whitespace-pre-wrap text-sm text-text-300",
          children: prompt.prompt,
        }),
      }),
      scheduleText
        ? jsx("div", {
            className: "mt-3 text-text-300",
            children: jsx("span", {
              className: "text-xs",
              children: scheduleText,
            }),
          })
        : null,
    ],
  });
}

function PromptScheduleControls({
  scheduleEnabled,
  setScheduleEnabled,
  repeatType,
  setRepeatType,
  specificDate,
  setSpecificDate,
  dayOfWeek,
  setDayOfWeek,
  dayOfMonth,
  setDayOfMonth,
  month,
  setMonth,
  day,
  setDay,
  specificTime,
  setSpecificTime,
  url,
  setUrl,
  urlError,
  model,
  setModel,
}) {
  const modelOptions = useMemo(() => getModelOptions(model), [model]);

  return jsxs("div", {
    className: "space-y-3",
    children: [
      jsx(Field, {
        label: "Start from",
        error: urlError,
        children: jsx("input", {
          type: "text",
          value: url,
          onChange: (event) => setUrl(event.target.value),
          placeholder: "https://example.com",
          className: INPUT_CLASS,
        }),
      }),
      jsxs("label", {
        className: "mt-4 flex cursor-pointer items-center justify-between",
        children: [
          jsx("span", {
            className: "font-base text-text-200",
            children: "Schedule",
          }),
          jsx(ToggleSwitch, {
            checked: scheduleEnabled,
            onChange: (event) => setScheduleEnabled(event.target.checked),
          }),
        ],
      }),
      scheduleEnabled
        ? jsxs("div", {
            className: "space-y-3",
            children: [
              jsx(Field, {
                label: "Repeat",
                children: jsx("select", {
                  value: repeatType,
                  onChange: (event) => setRepeatType(event.target.value),
                  className: SELECT_CLASS,
                  children: PROMPT_REPEAT_OPTIONS.map((option) =>
                    jsx(
                      "option",
                      { value: option.value, children: option.label },
                      option.value,
                    ),
                  ),
                }),
              }),
              repeatType === "once"
                ? jsxs("div", {
                    className: "grid gap-2 md:grid-cols-2",
                    children: [
                      jsx(Field, {
                        label: "Date",
                        children: jsx("input", {
                          type: "date",
                          value: specificDate,
                          min: getYesterdayDateForInput(),
                          onChange: (event) => setSpecificDate(event.target.value),
                          className: INPUT_CLASS,
                        }),
                      }),
                      jsx(Field, {
                        label: "Time",
                        children: jsx("input", {
                          type: "time",
                          value: specificTime,
                          onChange: (event) => setSpecificTime(event.target.value),
                          className: INPUT_CLASS,
                        }),
                      }),
                    ],
                  })
                : null,
              repeatType === "daily"
                ? jsx(Field, {
                    label: "Time",
                    children: jsx("input", {
                      type: "time",
                      value: specificTime,
                      onChange: (event) => setSpecificTime(event.target.value),
                      className: INPUT_CLASS,
                    }),
                  })
                : null,
              repeatType === "weekly"
                ? jsxs("div", {
                    className: "grid gap-2 md:grid-cols-2",
                    children: [
                      jsx(Field, {
                        label: "Day of week",
                        children: jsx("select", {
                          value: String(dayOfWeek),
                          onChange: (event) => setDayOfWeek(Number(event.target.value)),
                          className: SELECT_CLASS,
                          children: WEEKDAY_LABELS.map((label, index) =>
                            jsx(
                              "option",
                              { value: String(index), children: label },
                              label,
                            ),
                          ),
                        }),
                      }),
                      jsx(Field, {
                        label: "Time",
                        children: jsx("input", {
                          type: "time",
                          value: specificTime,
                          onChange: (event) => setSpecificTime(event.target.value),
                          className: INPUT_CLASS,
                        }),
                      }),
                    ],
                  })
                : null,
              repeatType === "monthly"
                ? jsxs("div", {
                    className: "grid gap-2 md:grid-cols-2",
                    children: [
                      jsx(Field, {
                        label: "Day of month",
                        children: jsx("select", {
                          value: String(dayOfMonth),
                          onChange: (event) =>
                            setDayOfMonth(Number(event.target.value)),
                          className: SELECT_CLASS,
                          children: Array.from({ length: 31 }, (_, index) => {
                            const value = index + 1;
                            return jsx(
                              "option",
                              {
                                value: String(value),
                                children: `${value}${formatOrdinal(value)}`,
                              },
                              value,
                            );
                          }),
                        }),
                      }),
                      jsx(Field, {
                        label: "Time",
                        children: jsx("input", {
                          type: "time",
                          value: specificTime,
                          onChange: (event) => setSpecificTime(event.target.value),
                          className: INPUT_CLASS,
                        }),
                      }),
                    ],
                  })
                : null,
              repeatType === "annually"
                ? jsxs("div", {
                    className: "grid gap-2 md:grid-cols-3",
                    children: [
                      jsx(Field, {
                        label: "Month",
                        children: jsx("select", {
                          value: String(month),
                          onChange: (event) => setMonth(Number(event.target.value)),
                          className: SELECT_CLASS,
                          children: MONTH_LABELS.map((label, index) =>
                            jsx(
                              "option",
                              { value: String(index + 1), children: label },
                              label,
                            ),
                          ),
                        }),
                      }),
                      jsx(Field, {
                        label: "Day",
                        children: jsx("select", {
                          value: String(day),
                          onChange: (event) => setDay(Number(event.target.value)),
                          className: SELECT_CLASS,
                          children: Array.from({ length: 31 }, (_, index) => {
                            const value = index + 1;
                            return jsx(
                              "option",
                              {
                                value: String(value),
                                children: `${value}${formatOrdinal(value)}`,
                              },
                              value,
                            );
                          }),
                        }),
                      }),
                      jsx(Field, {
                        label: "Time",
                        children: jsx("input", {
                          type: "time",
                          value: specificTime,
                          onChange: (event) => setSpecificTime(event.target.value),
                          className: INPUT_CLASS,
                        }),
                      }),
                    ],
                  })
                : null,
            ],
          })
        : null,
      jsx(Field, {
        label: "Model",
        children: jsx("select", {
          value: model,
          onChange: (event) => setModel(event.target.value),
          className: SELECT_CLASS,
          children: modelOptions.map((option) =>
            jsx(
              "option",
              {
                value: option.model,
                children: option.name,
              },
              option.model,
            ),
          ),
        }),
      }),
    ],
  });
}

function PromptEditorModal({ prompt, onClose, onSave }) {
  const isEditing = Boolean(prompt?.id);
  const commandInputRef = useRef(null);
  const [command, setCommand] = useState(prompt?.command || "");
  const [promptText, setPromptText] = useState(prompt?.prompt || "");
  const [commandError, setCommandError] = useState("");
  const [promptError, setPromptError] = useState("");
  const [urlError, setUrlError] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(
    Boolean(prompt?.repeatType && prompt.repeatType !== "none"),
  );
  const [repeatType, setRepeatType] = useState(
    prompt?.repeatType && prompt.repeatType !== "none" ? prompt.repeatType : "once",
  );
  const [specificDate, setSpecificDate] = useState(prompt?.specificDate || "");
  const [specificTime, setSpecificTime] = useState(prompt?.specificTime || "09:00");
  const [dayOfWeek, setDayOfWeek] = useState(prompt?.dayOfWeek ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState(prompt?.dayOfMonth || 1);
  const [month, setMonth] = useState(
    (prompt?.monthAndDay && Number(prompt.monthAndDay.split("-")[0])) || 1,
  );
  const [day, setDay] = useState(
    (prompt?.monthAndDay && Number(prompt.monthAndDay.split("-")[1])) || 1,
  );
  const [url, setUrl] = useState(prompt?.url || "");
  const [model, setModel] = useState(prompt?.model || MODEL_CONFIG.default);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setCommandError("");
    setPromptError("");
    setUrlError("");
    setFormError("");

    const trimmedCommand = command.trim();
    const trimmedPrompt = promptText.trim();
    const trimmedUrl = url.trim();

    if (!trimmedCommand) {
      setCommandError("Name is required");
      setIsSaving(false);
      return;
    }

    if (!trimmedPrompt) {
      setPromptError("Prompt is required");
      setIsSaving(false);
      return;
    }

    if (scheduleEnabled && trimmedUrl) {
      if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
        setUrlError("URL must start with http:// or https://");
        setIsSaving(false);
        return;
      }

      try {
        new URL(trimmedUrl);
      } catch {
        setUrlError("Invalid URL format");
        setIsSaving(false);
        return;
      }
    }

    const payload = {
      prompt: trimmedPrompt,
      command: trimmedCommand,
      url: trimmedUrl || undefined,
    };

    if (scheduleEnabled) {
      payload.repeatType = repeatType;
      payload.specificTime = specificTime;
      payload.model = model;
      if (repeatType === "once") payload.specificDate = specificDate;
      if (repeatType === "weekly") payload.dayOfWeek = dayOfWeek;
      if (repeatType === "monthly") payload.dayOfMonth = dayOfMonth;
      if (repeatType === "annually") {
        payload.monthAndDay = `${String(month).padStart(2, "0")}-${String(day).padStart(
          2,
          "0",
        )}`;
      }
    } else {
      payload.repeatType = undefined;
      payload.specificTime = undefined;
      payload.specificDate = undefined;
      payload.dayOfWeek = undefined;
      payload.dayOfMonth = undefined;
      payload.monthAndDay = undefined;
      payload.model = undefined;
    }

    try {
      if (isEditing) {
        await updatePromptInStorage(prompt.id, payload);
      } else {
        await savePromptToStorage({
          ...payload,
          createdAt: Date.now(),
          usageCount: 0,
        });
      }

      onSave(isEditing);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save";
      if (message.includes("already in use")) {
        setCommandError(message);
      } else {
        setFormError(message);
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    command,
    day,
    dayOfMonth,
    dayOfWeek,
    isEditing,
    model,
    onSave,
    prompt?.id,
    promptText,
    repeatType,
    scheduleEnabled,
    specificDate,
    specificTime,
    url,
    month,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => commandInputRef.current?.focus(), 100);

    if (!isEditing) {
      queryCurrentTabOrigin().then((origin) => {
        if (origin) {
          setUrl(origin);
        }
      });
    }

    return () => window.clearTimeout(timer);
  }, [isEditing]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Enter") return;

      const target = document.activeElement;
      const tagName = target?.tagName;
      const isEditable =
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        target?.isContentEditable;

      if (!isEditable) {
        event.preventDefault();
        void handleSave();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  return jsx(Modal, {
    open: true,
    onClose,
    title: isEditing ? "Edit shortcut" : "Create shortcut",
    sizeClassName: "max-w-4xl",
    children: jsxs("div", {
      className: "space-y-4",
      children: [
        jsx(Field, {
          label: "Name",
          error: commandError,
          children: jsx("div", {
            className: "relative",
            children: jsxs(Fragment, {
              children: [
                jsx("span", {
                  className:
                    "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-300",
                  children: "/",
                }),
                jsx("input", {
                  ref: commandInputRef,
                  type: "text",
                  value: command,
                  onChange: (event) => {
                    const nextValue = event.target.value
                      .replace(/\s/g, "-")
                      .replace(/[^a-zA-Z0-9-_]/g, "");
                    setCommand(nextValue);
                    if (commandError) setCommandError("");
                    if (formError) setFormError("");
                  },
                  placeholder: "task-name",
                  className: cx(INPUT_CLASS, "pl-7"),
                }),
              ],
            }),
          }),
        }),
        jsx(Field, {
          label: "Prompt",
          error: promptError,
          children: jsx("textarea", {
            required: true,
            value: promptText,
            onChange: (event) => {
              setPromptText(event.target.value);
              if (promptError) setPromptError("");
              if (formError) setFormError("");
            },
            placeholder: "Enter your prompt text...",
            className: cx(TEXTAREA_CLASS, "min-h-32 max-h-64 overflow-y-auto text-sm"),
          }),
        }),
        jsx(PromptScheduleControls, {
          scheduleEnabled,
          setScheduleEnabled,
          repeatType,
          setRepeatType,
          specificDate,
          setSpecificDate,
          dayOfWeek,
          setDayOfWeek,
          dayOfMonth,
          setDayOfMonth,
          month,
          setMonth,
          day,
          setDay,
          specificTime,
          setSpecificTime,
          url,
          setUrl: (nextUrl) => {
            setUrl(nextUrl);
            if (urlError) setUrlError("");
          },
          urlError,
          model,
          setModel,
        }),
        formError
          ? jsx("div", {
              className: "rounded-lg border border-danger-000/20 bg-danger-000/10 px-4 py-3 text-danger-000",
              children: formError,
            })
          : null,
        jsxs("div", {
          className: "flex items-center justify-end gap-3 border-t border-border-300 pt-4",
          children: [
            jsx("button", {
              type: "button",
              onClick: onClose,
              className: SECONDARY_BUTTON_CLASS,
              children: "Cancel",
            }),
            jsx("button", {
              type: "button",
              onClick: handleSave,
              disabled: isSaving,
              className: PRIMARY_BUTTON_CLASS,
              children: isSaving
                ? "Saving..."
                : isEditing
                  ? "Save changes"
                  : "Create shortcut",
            }),
          ],
        }),
      ],
    }),
  });
}

function PromptsTab() {
  const { prompts, isLoaded, refreshPrompts } = usePromptList();
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [isCreatingPrompt, setIsCreatingPrompt] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  useEffect(() => {
    if (!openMenuId) return undefined;

    const handleDocumentClick = (event) => {
      const menuRoot = event.target.closest("[data-prompt-menu-root='true']");
      if (!menuRoot) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [openMenuId]);

  const scheduledPrompts = prompts.filter((prompt) => isPromptScheduled(prompt));
  const otherPrompts = prompts.filter((prompt) => !isPromptScheduled(prompt));

  const handleDelete = async (promptId) => {
    const shouldDelete = window.confirm("Are you sure you want to delete this prompt?");
    if (!shouldDelete) return;

    await deletePromptFromStorage(promptId);
    await refreshPrompts();
    notify("Shortcut deleted");
  };

  const handleSavedPrompt = async (isEditing) => {
    await refreshPrompts();
    setEditingPrompt(null);
    setIsCreatingPrompt(false);
    notify(isEditing ? "Shortcut updated" : "Shortcut added");
  };

  if (!isLoaded) {
    return jsx("div", {
      className: "p-6 text-text-200",
      children: "Loading shortcuts...",
    });
  }

  return jsxs("div", {
    className: "space-y-6",
    children: [
      jsx(SectionCard, {
        title: "Shortcuts",
        description: "Type / in the chat to use shortcuts or run them on schedule.",
        children: jsxs(Fragment, {
          children: [
            jsxs("div", {
              className: "mb-6 flex items-start justify-between gap-4",
              children: [
                jsx("div", {}),
                jsx("button", {
                  type: "button",
                  onClick: () => {
                    setEditingPrompt(null);
                    setIsCreatingPrompt(true);
                  },
                  className: SECONDARY_BUTTON_CLASS,
                  children: "+ Create shortcut",
                }),
              ],
            }),

            scheduledPrompts.length > 0
              ? jsxs("div", {
                  className: "space-y-4",
                  children: [
                    jsxs("div", {
                      className: "mb-4 flex items-center gap-2",
                      children: [
                        jsx(ClockIcon, { className: "h-4 w-4 text-text-300" }),
                        jsx("h4", {
                          className: "font-base-bold text-text-200",
                          children: "Scheduled",
                        }),
                      ],
                    }),
                    jsx("div", {
                      className:
                        "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3",
                      children: scheduledPrompts.map((prompt) =>
                        jsx(
                          PromptCard,
                          {
                            prompt,
                            scheduleText: formatPromptSchedule(prompt),
                            menuOpen: openMenuId === prompt.id,
                            setMenuOpen: setOpenMenuId,
                            onEdit: () => setEditingPrompt(prompt),
                            onDelete: () => handleDelete(prompt.id),
                          },
                          prompt.id,
                        ),
                      ),
                    }),
                  ],
                })
              : null,

            otherPrompts.length > 0
              ? jsxs("div", {
                  className: "space-y-4",
                  children: [
                    scheduledPrompts.length > 0
                      ? jsxs("div", {
                          className: "mb-4 flex items-center gap-2",
                          children: [
                            jsx(KeyboardIcon, { className: "h-4 w-4 text-text-300" }),
                            jsx("h4", {
                              className: "font-base-bold text-text-200",
                              children: "Other",
                            }),
                          ],
                        })
                      : null,
                    jsx("div", {
                      className:
                        "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3",
                      children: otherPrompts.map((prompt) =>
                        jsx(
                          PromptCard,
                          {
                            prompt,
                            menuOpen: openMenuId === prompt.id,
                            setMenuOpen: setOpenMenuId,
                            onEdit: () => setEditingPrompt(prompt),
                            onDelete: () => handleDelete(prompt.id),
                          },
                          prompt.id,
                        ),
                      ),
                    }),
                  ],
                })
              : null,

            prompts.length === 0
              ? jsxs("div", {
                  className: "rounded-xl bg-bg-200 p-12 text-center",
                  children: [
                    jsx("div", {
                      className:
                        "mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-bg-000 text-text-300",
                      children: jsx(KeyboardIcon, { className: "h-8 w-8" }),
                    }),
                    jsx("p", {
                      className: "mx-auto max-w-xs text-text-300",
                      children: "Create your first shortcut to get started",
                    }),
                  ],
                })
              : null,
          ],
        }),
      }),
      isCreatingPrompt
        ? jsx(PromptEditorModal, {
            prompt: null,
            onClose: () => setIsCreatingPrompt(false),
            onSave: handleSavedPrompt,
          })
        : null,
      editingPrompt
        ? jsx(PromptEditorModal, {
            prompt: editingPrompt,
            onClose: () => setEditingPrompt(null),
            onSave: handleSavedPrompt,
          })
        : null,
    ],
  });
}

function OptionsTab() {
  return jsxs("div", {
    className: "space-y-6",
    children: [
      jsx(ShortcutSection, {}),
      jsx(SafetyBannerSection, {}),
    ],
  });
}

function SideNav({ activeTab, onTabChange, onLogout, canLogout }) {
  return jsxs("nav", {
    className:
      "relative mb-4 w-full overflow-x-auto p-2 md:sticky md:top-4 md:mb-0 md:w-full",
    children: [
      jsx("ul", {
        className: "mb-0 flex gap-1 md:flex-col",
        children: ALLOWED_TABS.map((tab) =>
          jsx(
            "li",
            {
              children: jsx("button", {
                type: "button",
                onClick: () => onTabChange(tab),
                className: cx(
                  NAV_BUTTON_CLASS,
                  activeTab === tab
                    ? "bg-bg-300 font-medium text-text-000"
                    : "text-text-200 hover:bg-bg-200 hover:text-text-100",
                ),
                children:
                  tab === "permissions"
                    ? "Permissions"
                    : tab === "prompts"
                      ? "Shortcuts"
                      : "Options",
              }),
            },
            tab,
          ),
        ),
      }),
      canLogout
        ? jsx("div", {
            className: "mt-4 border-t border-border-300 pt-4",
            children: jsx("button", {
              type: "button",
              onClick: onLogout,
              className: cx(
                DANGER_BUTTON_CLASS,
                "w-full justify-start px-3 py-3 text-left",
              ),
              children: jsxs(Fragment, {
                children: [
                  jsx(LogoutIcon, { className: "h-4 w-4" }),
                  "Log out",
                ],
              }),
            }),
          })
        : null,
    ],
  });
}

function SettingsLayout({ activeTab, onTabChange, onLogout, canLogout, children }) {
  return jsxs("div", {
    className: "grid w-full max-w-6xl gap-x-8 md:grid-cols-[220px_minmax(0px,_1fr)]",
    children: [
      jsx(SideNav, {
        activeTab,
        onTabChange,
        onLogout,
        canLogout,
      }),
      jsx("div", { children }),
    ],
  });
}

function RequestMicrophoneModal({ open, returnTabId, onClose }) {
  const [isClosing, setIsClosing] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const statusRef = useRef({ returnTabId });

  useEffect(() => {
    statusRef.current = { returnTabId };
  }, [returnTabId]);

  const closeAndReturn = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    window.setTimeout(() => {
      const { returnTabId: targetTabId } = statusRef.current;
      if (targetTabId) {
        chrome.tabs.update(targetTabId, { active: true }, () => {
          chrome.tabs.getCurrent((currentTab) => {
            if (currentTab?.id) {
              chrome.tabs.remove(currentTab.id);
            }
          });
        });
      } else {
        chrome.tabs.getCurrent((currentTab) => {
          if (currentTab?.id) {
            chrome.tabs.remove(currentTab.id);
          }
        });
      }
    }, 200);
  }, [isClosing]);

  const [permissionState, refreshPermission] = useMicrophonePermission(
    open,
    closeAndReturn,
  );

  useEffect(() => {
    if (!open) {
      setIsClosing(false);
      setIsRequesting(false);
      setErrorMessage("");
    }
  }, [open]);

  const handleRequestAccess = async () => {
    setIsRequesting(true);
    setErrorMessage("");

    try {
      await requestMicrophoneAccess();
      const nextState = await refreshPermission();
      if (nextState === "granted") {
        closeAndReturn();
        return;
      }
      setErrorMessage(
        'You selected "Allow this time" which doesn\'t persist. Please click the button again and select "Allow while visiting the site" to enable voice narration.',
      );
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError") {
          await refreshPermission();
        } else if (error.name === "NotFoundError") {
          setErrorMessage("No microphone found. Please connect a microphone and try again.");
        } else {
          setErrorMessage(`Error: ${error.message}`);
        }
      } else if (error instanceof Error) {
        setErrorMessage(`Error: ${error.message}`);
      } else {
        setErrorMessage("An unknown error occurred");
      }
    } finally {
      setIsRequesting(false);
    }
  };

  if (!open) return null;

  const cardState = isClosing ? "opacity-0 scale-95" : "opacity-100 scale-100";

  return jsx("div", {
    className: cx(
      "fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity duration-200",
      isClosing ? "opacity-0" : "opacity-100",
    ),
    children: jsx("div", {
      className: cx(
        "mx-4 w-full max-w-md rounded-2xl bg-bg-000 shadow-xl transition-all duration-200",
        cardState,
      ),
      children: jsxs("div", {
        className: "px-6 pb-6 pt-6 text-center",
        children: [
          jsxs("div", {
            className: "mb-4 flex items-center justify-between",
            children: [
              jsx("div", { className: "w-8" }),
              jsx("button", {
                type: "button",
                onClick: () => {
                  setIsClosing(true);
                  window.setTimeout(() => {
                    onClose();
                  }, 200);
                },
                className: "rounded-lg p-2 text-text-300 transition-colors hover:bg-bg-200",
                "aria-label": "Close",
                children: jsx(XCircleIcon, { className: "h-4 w-4" }),
              }),
            ],
          }),
          jsx("div", {
            className:
              "mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100/10 text-brand-100",
            children: jsx(MicIcon, { className: "h-8 w-8" }),
          }),
          jsx("h2", {
            className: "mb-2 font-xl-bold text-text-100",
            children: "Enable microphone access",
          }),
          jsx("p", {
            className: "mb-6 font-base text-text-300",
            children:
              "Codex needs microphone access to hear your voice narration while you demonstrate workflows. When prompted, select Allow while visiting the site to enable voice narration.",
          }),
          permissionState === "granted"
            ? jsxs("div", {
                className:
                  "mb-6 rounded-xl border border-success-100/20 bg-success-100/10 p-4",
                children: [
                  jsxs("div", {
                    className:
                      "flex items-center justify-center gap-2 text-success-100",
                    children: [
                      jsx(CheckCircleIcon, { className: "h-5 w-5" }),
                      jsx("span", {
                        className: "font-large",
                        children: "Microphone access granted",
                      }),
                    ],
                  }),
                  jsx("p", {
                    className: "mt-2 font-base-sm text-text-300",
                    children: "Returning to your workflow...",
                  }),
                ],
              })
            : null,
          permissionState === "denied"
            ? jsx("div", {
                className:
                  "mb-6 rounded-xl border border-danger-000/20 bg-danger-000/10 p-4",
                children: jsx("p", {
                  className: "font-base text-danger-000",
                  children: jsxs(Fragment, {
                    children: [
                      "Microphone access was denied. You can either try again or ",
                      jsx("button", {
                        type: "button",
                        onClick: () => {
                          chrome.tabs.create({
                            url: `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${chrome.runtime.id}%2F`,
                          });
                        },
                        className: "underline transition-colors hover:no-underline",
                        children: "open Chrome settings",
                      }),
                      " to enable microphone access.",
                    ],
                  }),
                }),
              })
            : null,
          errorMessage
            ? jsx("div", {
                className:
                  "mb-6 rounded-xl border border-danger-000/20 bg-danger-000/10 p-4",
                children: jsx("p", {
                  className: "font-base text-danger-000",
                  children: errorMessage,
                }),
              })
            : null,
          permissionState !== "granted" && permissionState !== "denied"
            ? jsxs(Fragment, {
                children: [
                  jsx("button", {
                    type: "button",
                    onClick: handleRequestAccess,
                    disabled: isRequesting,
                    className: cx(PRIMARY_BUTTON_CLASS, "w-full"),
                    children: isRequesting ? "Requesting access..." : "Allow microphone access",
                  }),
                  jsx("button", {
                    type: "button",
                    onClick: () => {
                      setIsClosing(true);
                      window.setTimeout(() => {
                        onClose();
                      }, 200);
                    },
                    className: "mt-4 font-base-sm text-text-300 transition-colors hover:text-text-200",
                    children: "Skip for now",
                  }),
                ],
              })
            : jsx("button", {
                type: "button",
                onClick: () => {
                  setIsClosing(true);
                  window.setTimeout(() => {
                    onClose();
                  }, 200);
                },
                className: "mt-4 font-base-sm text-text-300 transition-colors hover:text-text-200",
                children: "Close",
              }),
        ],
      }),
    }),
  });
}

function App() {
  const authState = useAuthState();
  const [activeTab, setActiveTab] = useState("permissions");
  const [showRequestMicrophone, setShowRequestMicrophone] = useState(false);
  const [returnTabId, setReturnTabId] = useState(undefined);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const syncFromHash = () => {
      const { tab, requestMicrophone, returnTabId: nextReturnTabId } = parseHashState();
      setActiveTab(tab);
      setShowRequestMicrophone(requestMicrophone);
      setReturnTabId(nextReturnTabId);
    };

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
    window.location.hash = nextTab;
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await startOAuthFlow();
    } catch {
      // The original page ignores login failures here.
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: "logout" });
      if (!result?.success) {
        throw new Error(result?.error || "Logout failed");
      }
      window.location.reload();
    } catch {
      alert("Failed to logout. Please try again.");
    }
  };

  const canShowSettings = authState.isAuthenticated;

  return jsxs("div", {
    "data-theme": "claude",
    children: [
      jsx("div", {
        className: "sticky top-0 z-header h-12 w-full bg-bg-100",
        children: jsx("div", {
          className: "flex h-full w-full items-center justify-between gap-4 pl-11 pr-3 lg:pl-8",
          children: jsx("h1", {
            className: "font-heading text-lg text-text-200",
            children: "Codex in Chrome settings",
          }),
        }),
      }),
      jsx("main", {
        className: "mx-auto mt-4 flex w-full flex-1 px-4 md:pl-8 lg:mt-6",
        children: authState.isLoaded
          ? canShowSettings
            ? jsx(SettingsLayout, {
                activeTab,
                onTabChange: handleTabChange,
                onLogout: handleLogout,
                canLogout: true,
                children: jsx(
                  activeTab === "permissions"
                    ? PermissionsTab
                    : activeTab === "prompts"
                      ? PromptsTab
                      : OptionsTab,
                  {},
                ),
              })
            : jsx(LoginScreen, {
                onLogin: handleLogin,
                isLoggingIn,
              })
          : jsx(PageLoadingState, { label: "Loading settings..." }),
      }),
      jsx(ToastViewport, {}),
      jsx(RequestMicrophoneModal, {
        open: showRequestMicrophone,
        returnTabId,
        onClose: () => {
          setShowRequestMicrophone(false);
        },
      }),
    ],
  });
}

// Keep the root render explicit and easy to inspect.
ReactDOM.createRoot(document.getElementById("root")).render(
  jsx(React.StrictMode, {
    children: jsx(App, {}),
  }),
);
