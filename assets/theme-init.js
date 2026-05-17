// Chrome extension pages cannot run inline scripts under MV3 CSP.
(function () {
  document.documentElement.setAttribute("data-mode", "dark");
})();
