(function () {
  if (window.__codexFocusVisibilityShimInstalled) {
    return;
  }
  window.__codexFocusVisibilityShimInstalled = true;

  const defineGetter = (target, property, value) => {
    try {
      Object.defineProperty(target, property, {
        configurable: true,
        get: () => value,
      });
    } catch {}
  };

  defineGetter(Document.prototype, "hidden", false);
  defineGetter(Document.prototype, "webkitHidden", false);
  defineGetter(Document.prototype, "visibilityState", "visible");
  defineGetter(Document.prototype, "webkitVisibilityState", "visible");

  try {
    Document.prototype.hasFocus = function () {
      return true;
    };
  } catch {}

  try {
    document.hasFocus = function () {
      return true;
    };
  } catch {}

  const blockUnfocusEvent = (event) => {
    event.stopImmediatePropagation();
  };

  for (const target of [window, document]) {
    for (const eventName of [
      "blur",
      "focusout",
      "visibilitychange",
      "webkitvisibilitychange",
      "pagehide",
    ]) {
      try {
        target.addEventListener(eventName, blockUnfocusEvent, true);
      } catch {}
    }
  }
})();
