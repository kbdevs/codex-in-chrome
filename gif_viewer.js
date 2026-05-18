const GIF_STORAGE_KEY = "exportedGifData";
const GIF_MAX_AGE_MS = 5 * 60 * 1000;

void initializeGifViewer();

async function initializeGifViewer() {
  const content = document.getElementById("content");

  if (!content) {
    return;
  }

  try {
    const gifData = await readStoredGifData();
    validateGifData(gifData);

    const blobUrl = createGifBlobUrl(gifData.base64);
    renderGifPreview(content, blobUrl, gifData.filename);

    document.title = gifData.filename;
    window.addEventListener(
      "unload",
      () => URL.revokeObjectURL(blobUrl),
      { once: true },
    );

    await chrome.storage.local.remove(GIF_STORAGE_KEY);
  } catch (error) {
    renderErrorState(content, error);
    console.error("[GIF Viewer] Error:", error);
  }
}

async function readStoredGifData() {
  const result = await chrome.storage.local.get(GIF_STORAGE_KEY);
  return result.exportedGifData;
}

function validateGifData(gifData) {
  if (
    !gifData ||
    typeof gifData.base64 !== "string" ||
    typeof gifData.filename !== "string"
  ) {
    throw new Error("No GIF data found. The export may have expired.");
  }

  if (Date.now() - gifData.timestamp > GIF_MAX_AGE_MS) {
    throw new Error("GIF data expired. Please export again.");
  }
}

function createGifBlobUrl(base64) {
  const bytes = decodeBase64(base64);
  const blob = new Blob([bytes], { type: "image/gif" });
  return URL.createObjectURL(blob);
}

function decodeBase64(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return bytes;
}

function renderGifPreview(content, blobUrl, filename) {
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;

  const image = document.createElement("img");
  image.src = blobUrl;
  image.alt = filename;

  link.appendChild(image);
  content.replaceChildren(link);
}

function renderErrorState(content, error) {
  const errorBox = document.createElement("div");
  errorBox.className = "error";
  errorBox.textContent = getErrorMessage(error);
  content.replaceChildren(errorBox);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
