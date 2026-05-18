(function () {
  const ONBOARDING_BUTTON_SELECTOR = "#claude-onboarding-button";

  async function openSidePanelFromButton(button) {
    const prompt = button.getAttribute("data-task-prompt");
    if (!prompt) {
      return;
    }

    await chrome.runtime.sendMessage({
      type: "open_side_panel",
      prompt,
    });
  }

  document.body.addEventListener("click", (event) => {
    const button = event.target.closest(ONBOARDING_BUTTON_SELECTOR);
    if (!button) {
      return;
    }

    openSidePanelFromButton(button);
  });
})();
