(function () {
  const elementRefs =
    window.__claudeElementMap || (window.__claudeElementMap = Object.create(null));

  if (typeof window.__claudeRefCounter !== "number") {
    window.__claudeRefCounter = 0;
  }

  const DEFAULT_FILTER = "all";
  const DEFAULT_DEPTH = 15;
  const MAX_LABEL_LENGTH = 100;
  const REDACTED_VALUE = "[value redacted]";

  const NON_CONTENT_TAGS = new Set([
    "script",
    "style",
    "meta",
    "link",
    "title",
    "noscript",
  ]);

  const INTERACTIVE_TAGS = new Set([
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "details",
    "summary",
  ]);

  const LANDMARK_TAGS = new Set([
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "nav",
    "main",
    "header",
    "footer",
    "section",
    "article",
    "aside",
  ]);

  const SENSITIVE_AUTOCOMPLETE_TOKENS = [
    "current-password",
    "new-password",
    "one-time-code",
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
  ];

  function getTagName(element) {
    return element.tagName.toLowerCase();
  }

  function trimText(value) {
    return value.trim();
  }

  function truncateText(value, maxLength = MAX_LABEL_LENGTH, appendEllipsis = false) {
    if (value.length <= maxLength) {
      return value;
    }

    return appendEllipsis ? value.slice(0, maxLength) + "..." : value.slice(0, maxLength);
  }

  function collapseWhitespace(value) {
    return trimText(value).replace(/\s+/g, " ");
  }

  function escapeQuotedText(value) {
    return value.replace(/"/g, '\\"');
  }

  function getDirectTextContent(node) {
    let textContent = "";

    for (let index = 0; index < node.childNodes.length; index += 1) {
      const childNode = node.childNodes[index];
      if (childNode.nodeType === Node.TEXT_NODE) {
        textContent += childNode.textContent || "";
      }
    }

    return trimText(textContent);
  }

  function findLabelTextForElement(element) {
    if (!element.id) {
      return "";
    }

    const label = document.querySelector('label[for="' + element.id + '"]');
    return label ? getDirectTextContent(label) : "";
  }

  function isSensitiveField(element) {
    const inputType = trimText((element.getAttribute("type") || "").toLowerCase());
    if (inputType === "password" || inputType === "hidden") {
      return true;
    }

    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();
    for (let index = 0; index < SENSITIVE_AUTOCOMPLETE_TOKENS.length; index += 1) {
      if (autocomplete.indexOf(SENSITIVE_AUTOCOMPLETE_TOKENS[index]) !== -1) {
        return true;
      }
    }

    return false;
  }

  function getRole(element) {
    const explicitRole = element.getAttribute("role");
    if (explicitRole) {
      return explicitRole;
    }

    const tagName = getTagName(element);
    const inputType = element.getAttribute("type");

    return (
      {
        a: "link",
        button: "button",
        input:
          inputType === "submit" || inputType === "button"
            ? "button"
            : inputType === "checkbox"
              ? "checkbox"
              : inputType === "radio"
                ? "radio"
                : inputType === "file"
                  ? "button"
                  : "textbox",
        select: "combobox",
        textarea: "textbox",
        h1: "heading",
        h2: "heading",
        h3: "heading",
        h4: "heading",
        h5: "heading",
        h6: "heading",
        img: "image",
        nav: "navigation",
        main: "main",
        header: "banner",
        footer: "contentinfo",
        section: "region",
        article: "article",
        aside: "complementary",
        form: "form",
        table: "table",
        ul: "list",
        ol: "list",
        li: "listitem",
        label: "label",
      }[tagName] || "generic"
    );
  }

  function getAccessibleLabel(element) {
    const tagName = getTagName(element);

    if (tagName === "select") {
      if (isSensitiveField(element)) {
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel && trimText(ariaLabel)) {
          return trimText(ariaLabel);
        }

        const title = element.getAttribute("title");
        if (title && trimText(title)) {
          return trimText(title);
        }

        const labelText = findLabelTextForElement(element);
        if (labelText) {
          return labelText;
        }

        return REDACTED_VALUE;
      }

      const selectedOption =
        element.querySelector("option[selected]") ||
        element.options[element.selectedIndex];
      if (selectedOption && selectedOption.textContent) {
        return trimText(selectedOption.textContent);
      }
    }

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel && trimText(ariaLabel)) {
      return trimText(ariaLabel);
    }

    const placeholder = element.getAttribute("placeholder");
    if (placeholder && trimText(placeholder)) {
      return trimText(placeholder);
    }

    const title = element.getAttribute("title");
    if (title && trimText(title)) {
      return trimText(title);
    }

    const altText = element.getAttribute("alt");
    if (altText && trimText(altText)) {
      return trimText(altText);
    }

    const labelText = findLabelTextForElement(element);
    if (labelText) {
      return labelText;
    }

    if (tagName === "input") {
      const inputType = element.getAttribute("type") || "";
      const valueAttribute = element.getAttribute("value");

      if (inputType === "submit" && valueAttribute && trimText(valueAttribute)) {
        return trimText(valueAttribute);
      }

      if (isSensitiveField(element)) {
        return element.value ? REDACTED_VALUE : "";
      }

      if (element.value && element.value.length < 50 && trimText(element.value)) {
        return trimText(element.value);
      }
    }

    if (tagName === "textarea" && isSensitiveField(element)) {
      return element.value ? REDACTED_VALUE : "";
    }

    if (tagName === "button" || tagName === "a" || tagName === "summary") {
      const directText = getDirectTextContent(element);
      if (directText) {
        return directText;
      }
    }

    if (/^h[1-6]$/.test(tagName)) {
      const headingText = element.textContent;
      if (headingText && trimText(headingText)) {
        return truncateText(trimText(headingText), MAX_LABEL_LENGTH, false);
      }
    }

    if (tagName === "img") {
      return "";
    }

    const fallbackText = getDirectTextContent(element);
    if (fallbackText && fallbackText.length >= 3) {
      return truncateText(fallbackText, MAX_LABEL_LENGTH, true);
    }

    return "";
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      element.offsetWidth > 0 &&
      element.offsetHeight > 0
    );
  }

  function isInteractiveElement(element) {
    const tagName = getTagName(element);
    return (
      INTERACTIVE_TAGS.has(tagName) ||
      element.getAttribute("onclick") !== null ||
      element.getAttribute("tabindex") !== null ||
      element.getAttribute("role") === "button" ||
      element.getAttribute("role") === "link" ||
      element.getAttribute("contenteditable") === "true"
    );
  }

  function isLandmarkElement(element) {
    const tagName = getTagName(element);
    return LANDMARK_TAGS.has(tagName) || element.getAttribute("role") !== null;
  }

  function shouldIncludeElement(element, context) {
    const tagName = getTagName(element);

    if (NON_CONTENT_TAGS.has(tagName)) {
      return false;
    }

    if (context.filter !== "all" && element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    if (context.filter !== "all" && !isVisible(element)) {
      return false;
    }

    if (context.filter !== "all" && !context.refId) {
      const bounds = element.getBoundingClientRect();
      if (
        !(
          bounds.top < window.innerHeight &&
          bounds.bottom > 0 &&
          bounds.left < window.innerWidth &&
          bounds.right > 0
        )
      ) {
        return false;
      }
    }

    if (context.filter === "interactive") {
      return isInteractiveElement(element);
    }

    if (isInteractiveElement(element) || isLandmarkElement(element)) {
      return true;
    }

    if (getAccessibleLabel(element).length > 0) {
      return true;
    }

    const role = getRole(element);
    return role !== "generic" && role !== "image";
  }

  function getOrCreateRefId(element) {
    for (const refId in elementRefs) {
      if (elementRefs[refId].deref() === element) {
        return refId;
      }
    }

    const refId = "ref_" + ++window.__claudeRefCounter;
    elementRefs[refId] = new WeakRef(element);
    return refId;
  }

  function pruneDeadRefs() {
    for (const refId in elementRefs) {
      if (!elementRefs[refId].deref()) {
        delete elementRefs[refId];
      }
    }
  }

  function formatElementLine(element, depth) {
    const role = getRole(element);
    const label = getAccessibleLabel(element);
    const refId = getOrCreateRefId(element);
    const tagName = getTagName(element);

    let line = " ".repeat(depth) + role;
    if (label) {
      line += ' "' + escapeQuotedText(label) + '"';
    }

    line += " [" + refId + "]";

    const href = element.getAttribute("href");
    if (href) {
      line += ' href="' + escapeQuotedText(href) + '"';
    }

    const type = element.getAttribute("type");
    if (type) {
      line += ' type="' + escapeQuotedText(type) + '"';
    }

    const placeholder = element.getAttribute("placeholder");
    if (placeholder) {
      line += ' placeholder="' + escapeQuotedText(placeholder) + '"';
    }

    return line;
  }

  function appendSelectOptionLines(selectElement, depth, lines) {
    for (let index = 0; index < selectElement.options.length; index += 1) {
      const option = selectElement.options[index];
      let line = " ".repeat(depth + 1) + "option";

      const rawText = option.textContent ? trimText(option.textContent) : "";
      if (rawText) {
        const displayText = truncateText(collapseWhitespace(rawText), MAX_LABEL_LENGTH, false);
        line += ' "' + escapeQuotedText(displayText) + '"';
      }

      if (option.selected) {
        line += " (selected)";
      }

      const displayText = rawText
        ? truncateText(collapseWhitespace(rawText), MAX_LABEL_LENGTH, false)
        : "";
      if (option.value && option.value !== displayText) {
        line += ' value="' + escapeQuotedText(option.value) + '"';
      }

      lines.push(line);
    }
  }

  function collectAccessibilityTree(element, depth, context, maxDepth, lines) {
    if (!element || !element.tagName || depth > maxDepth) {
      return;
    }

    const tagName = getTagName(element);
    const includeSelf =
      shouldIncludeElement(element, context) || (context.refId !== null && depth === 0);

    if (includeSelf) {
      lines.push(formatElementLine(element, depth));

      if (tagName === "select" && !isSensitiveField(element)) {
        appendSelectOptionLines(element, depth, lines);
      }
    }

    if ((tagName !== "select" || isSensitiveField(element)) && element.children && depth < maxDepth) {
      const nextDepth = includeSelf ? depth + 1 : depth;
      for (let index = 0; index < element.children.length; index += 1) {
        collectAccessibilityTree(element.children[index], nextDepth, context, maxDepth, lines);
      }
    }
  }

  function buildViewport() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  function buildEmptyResult(pageContent) {
    return {
      pageContent,
      viewport: buildViewport(),
    };
  }

  function buildRefNotFoundResult(refId, reason) {
    return {
      error:
        "Element with ref_id '" +
        refId +
        "' " +
        reason +
        ". Use read_page without ref_id to get the current page state.",
      pageContent: "",
      viewport: buildViewport(),
    };
  }

  function buildOutputTooLargeResult(
    maxChars,
    pageContentLength,
    refId,
    depthWasProvided,
  ) {
    let message =
      "Output exceeds " + maxChars + " character limit (" + pageContentLength + " characters). ";

    if (refId) {
      message +=
        "The specified element has too much content. Try specifying a smaller depth parameter or focus on a more specific child element.";
    } else if (depthWasProvided) {
      message +=
        "Try specifying an even smaller depth parameter or use ref_id to focus on a specific element.";
    } else {
      message +=
        "Try specifying a depth parameter (e.g., depth: 5) or use ref_id to focus on a specific element from the page.";
    }

    return {
      error: message,
      pageContent: "",
      viewport: buildViewport(),
    };
  }

  function generateAccessibilityTree(filter, depth, maxChars, refId) {
    try {
      const effectiveFilter = filter || DEFAULT_FILTER;
      const effectiveDepth = depth != null ? depth : DEFAULT_DEPTH;
      const depthWasProvided = depth !== undefined;
      const context = {
        filter: effectiveFilter,
        refId,
      };

      const lines = [];

      if (refId) {
        const refEntry = window.__claudeElementMap[refId];
        if (!refEntry) {
          return buildRefNotFoundResult(
            refId,
            "not found. It may have been removed from the page",
          );
        }

        const referencedElement = refEntry.deref();
        if (!referencedElement) {
          return buildRefNotFoundResult(
            refId,
            "no longer exists. It may have been removed from the page",
          );
        }

        collectAccessibilityTree(referencedElement, 0, context, effectiveDepth, lines);
      } else if (document.body) {
        collectAccessibilityTree(document.body, 0, context, effectiveDepth, lines);
      }

      pruneDeadRefs();

      const pageContent = lines.join("\n");
      if (maxChars != null && pageContent.length > maxChars) {
        return buildOutputTooLargeResult(
          maxChars,
          pageContent.length,
          refId,
          depthWasProvided,
        );
      }

      return buildEmptyResult(pageContent);
    } catch (error) {
      throw new Error(
        "Error generating accessibility tree: " + (error.message || "Unknown error"),
      );
    }
  }

  window.__generateAccessibilityTree = generateAccessibilityTree;
})();
