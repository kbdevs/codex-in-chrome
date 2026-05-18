/* global GIF, Path2D */

const KEEPALIVE_INTERVAL_MS = 20_000;
const DEFAULT_SOUND_VOLUME = 0.5;
const DEFAULT_FRAME_DELAY_MS = 800;
const FINAL_FRAME_EXTENSION_MS = 2_000;
const GIF_WORKER_COUNT = 2;
const GIF_QUALITY_DEFAULT = 10;
const GIF_WORKER_SCRIPT_URL = chrome.runtime.getURL("gif.worker.js");

const MESSAGE_TYPES = {
  keepAlive: "SW_KEEPALIVE",
  playSound: "OFFSCREEN_PLAY_SOUND",
  revokeBlobUrl: "REVOKE_BLOB_URL",
  generateGif: "GENERATE_GIF",
};

const WATERMARK_VIEWBOX_SIZE = 691;
const WATERMARK_PATH_DATA =
  "M189.531 430.72L288.951 374.971L290.59 370.088L288.951 367.369H284.035L267.374 366.355L210.562 364.835L161.399 362.807L113.6 360.273L101.583 357.739L90.3843 342.788L91.4768 335.439L101.583 328.597L116.059 329.864L148.015 332.145L196.086 335.439L230.774 337.467L282.396 342.788H290.59L291.682 339.494L288.951 337.467L286.766 335.439L237.056 301.736L183.249 266.259L155.117 245.733L140.094 235.344L132.447 225.714L129.169 204.428L142.826 189.223L161.399 190.491L166.042 191.758L184.888 206.202L225.038 237.371L277.48 275.889L285.127 282.224L288.207 280.145L288.678 278.676L285.127 272.848L256.722 221.406L226.404 168.951L212.747 147.158L209.197 134.234C207.821 128.811 207.012 124.324 207.012 118.776L222.58 97.4901L231.32 94.7026L252.351 97.4901L261.092 105.092L274.202 134.994L295.233 181.875L328.009 245.733L337.569 264.739L342.758 282.224L344.67 287.545H347.948V284.505L350.679 248.521L355.595 204.428L360.512 147.665L362.15 131.7L370.071 112.441L385.913 102.051L398.204 107.88L408.31 122.324L406.944 131.7L400.935 170.725L389.19 231.796L381.543 272.848H385.913L391.102 267.526L411.86 240.158L446.548 196.572L461.843 179.341L479.87 160.335L491.342 151.212H513.192L529.034 175.033L521.932 199.613L499.536 227.995L480.963 252.068L454.332 287.747L437.808 316.434L439.29 318.8L443.271 318.461L503.359 305.537L535.862 299.709L574.647 293.12L592.127 301.229L594.039 309.592L587.211 326.57L545.695 336.706L497.077 346.589L424.68 363.632L423.878 364.277L424.824 365.68L457.473 368.636L471.403 369.396H505.545L569.184 374.211L585.845 385.107L595.678 398.538L594.039 408.927L568.365 421.851L533.95 413.742L453.376 394.483L425.79 387.641H421.966V389.922L444.909 412.475L487.245 450.486L539.959 499.647L542.69 511.811L535.862 521.44L528.761 520.427L482.328 485.456L464.302 469.745L423.878 435.535H421.147V439.083L430.433 452.767L479.87 527.015L482.328 549.822L478.778 557.171L465.94 561.732L452.011 559.198L422.786 518.399L393.014 472.786L368.979 431.734L366.076 433.567L351.771 586.312L345.216 594.168L329.921 599.996L317.084 590.367L310.255 574.656L317.084 543.487L325.278 502.941L331.833 470.759L337.842 430.72L341.511 417.345L341.187 416.45L338.255 416.943L308.07 458.342L262.184 520.427L225.858 559.198L217.117 562.746L202.095 554.89L203.461 540.953L211.928 528.536L262.184 464.677L292.502 424.892L312.042 402.055L311.851 398.751L310.773 398.659L177.24 485.71L153.478 488.751L143.099 479.121L144.464 463.41L149.381 458.342L189.531 430.72Z";

let audioContext = null;

logOffscreen("Document loaded and ready");
startServiceWorkerKeepalive();
chrome.runtime.onMessage.addListener(handleRuntimeMessage);

function logOffscreen(message, ...details) {
  console.log(`[Offscreen] ${message}`, ...details);
}

function logOffscreenError(message, error) {
  console.error(`[Offscreen] ${message}`, error);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function startServiceWorkerKeepalive() {
  setInterval(() => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.keepAlive }).catch(() => {
      // The service worker can restart independently; the next ping will recover.
    });
  }, KEEPALIVE_INTERVAL_MS);
}

function getOrCreateAudioContext() {
  if (!audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextCtor) {
      throw new Error("Web Audio API is not available in this document.");
    }

    audioContext = new AudioContextCtor();
    logOffscreen("AudioContext created", audioContext.state);
  }

  return audioContext;
}

async function playAudioFromUrl(audioUrl, volume = DEFAULT_SOUND_VOLUME) {
  const context = getOrCreateAudioContext();

  try {
    logOffscreen("Fetching audio file", audioUrl);

    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch audio file (${response.status} ${response.statusText})`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    logOffscreen("Decoding audio data");

    const audioBuffer = await context.decodeAudioData(arrayBuffer);
    const sourceNode = context.createBufferSource();
    const gainNode = context.createGain();

    sourceNode.buffer = audioBuffer;
    gainNode.gain.value = volume;
    sourceNode.connect(gainNode);
    gainNode.connect(context.destination);

    if (context.state === "suspended") {
      logOffscreen("Resuming AudioContext");
      await context.resume();
    }

    const playbackFinished = new Promise((resolve) => {
      sourceNode.onended = () => resolve();
    });

    logOffscreen("Starting playback");
    sourceNode.start(0);
    await playbackFinished;
    logOffscreen("Playback finished");
  } catch (error) {
    logOffscreenError("Web Audio playback error", error);
    throw error;
  }
}

function drawClickIndicator(ctx, x, y, scaleFactor = 1) {
  ctx.save();

  ctx.beginPath();
  ctx.arc(x, y, 15 * scaleFactor, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(207, 107, 60, 0.3)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, 11 * scaleFactor, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(207, 107, 60, 0.5)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, 11 * scaleFactor, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(207, 107, 60, 1)";
  ctx.lineWidth = 2 * scaleFactor;
  ctx.stroke();

  ctx.restore();
}

function drawDragPath(ctx, startX, startY, endX, endY, scaleFactor = 1) {
  ctx.save();

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 3 * scaleFactor;
  ctx.stroke();

  const angle = Math.atan2(endY - startY, endX - startX);
  const arrowLength = 15 * scaleFactor;

  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - arrowLength * Math.cos(angle - Math.PI / 6),
    endY - arrowLength * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    endX - arrowLength * Math.cos(angle + Math.PI / 6),
    endY - arrowLength * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fillStyle = "#dc2626";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(startX, startY, 6 * scaleFactor, 0, 2 * Math.PI);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#cf6b3c";
  ctx.lineWidth = 2 * scaleFactor;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(endX, endY, 6 * scaleFactor, 0, 2 * Math.PI);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 2 * scaleFactor;
  ctx.stroke();

  ctx.restore();
}

function drawRoundedRectPath(ctx, x, y, width, height, radius) {
  const cornerRadius = Math.min(radius, width / 2, height / 2);

  ctx.moveTo(x + cornerRadius, y);
  ctx.lineTo(x + width - cornerRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
  ctx.lineTo(x + width, y + height - cornerRadius);
  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - cornerRadius,
    y + height,
  );
  ctx.lineTo(x + cornerRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - cornerRadius);
  ctx.lineTo(x, y + cornerRadius);
  ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
  ctx.closePath();
}

function drawActionLabel(ctx, text, x, y, scaleFactor = 1) {
  ctx.save();

  const fontSize = 14 * scaleFactor;
  ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = 20 * scaleFactor;
  const padding = 8 * scaleFactor;

  let labelX = x + 20 * scaleFactor;
  let labelY = y - 10 * scaleFactor;

  if (labelX + textWidth + padding * 2 > ctx.canvas.width) {
    labelX = x - textWidth - padding * 2 - 20 * scaleFactor;
  }

  if (labelY < 0) {
    labelY = y + 20 * scaleFactor;
  }

  const backgroundWidth = textWidth + padding * 2;
  const backgroundHeight = textHeight + padding;
  const backgroundRadius = 6 * scaleFactor;

  ctx.beginPath();
  drawRoundedRectPath(
    ctx,
    labelX,
    labelY,
    backgroundWidth,
    backgroundHeight,
    backgroundRadius,
  );
  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 4 * scaleFactor;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2 * scaleFactor;
  ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, labelX + padding, labelY + padding);

  ctx.restore();
}

function drawProgressBar(ctx, progress, scaleFactor = 1) {
  ctx.save();

  const barHeight = 4 * scaleFactor;
  const barWidth = ctx.canvas.width;
  const progressWidth = barWidth * progress;
  const y = ctx.canvas.height - barHeight;

  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(0, y, barWidth, barHeight);

  ctx.fillStyle = "#C96442";
  ctx.fillRect(0, y, progressWidth, barHeight);

  ctx.restore();
}

function drawWatermark(ctx, scaleFactor = 1) {
  ctx.save();

  const padding = 8 * scaleFactor;
  const logoSize = 32 * scaleFactor;
  const x = ctx.canvas.width - padding - logoSize;
  const y = ctx.canvas.height - padding - logoSize - 4 * scaleFactor;

  const radius = logoSize * 0.234;
  ctx.beginPath();
  drawRoundedRectPath(ctx, x, y, logoSize, logoSize, radius);

  const gradient = ctx.createLinearGradient(x, y + logoSize, x, y);
  gradient.addColorStop(0, "#DC6038");
  gradient.addColorStop(1, "#D97757");
  ctx.fillStyle = gradient;
  ctx.fill();

  const logoScale = logoSize / WATERMARK_VIEWBOX_SIZE;
  ctx.translate(x, y);
  ctx.scale(logoScale, logoScale);
  ctx.fillStyle = "rgba(250, 249, 245, 0.9)";
  ctx.fill(new Path2D(WATERMARK_PATH_DATA));

  ctx.restore();
}

function hasCoordinate(point) {
  return Array.isArray(point) && point.length === 2;
}

function scalePoint(point, scaleFactor) {
  const [x, y] = point;
  return {
    x: x * scaleFactor,
    y: y * scaleFactor,
  };
}

function getFrameScaleFactor(frame, canvas) {
  if (
    Number.isFinite(frame.viewportWidth) &&
    frame.viewportWidth > 0 &&
    canvas.width > 0
  ) {
    return canvas.width / frame.viewportWidth;
  }

  return 1;
}

function applyActionIndicators(canvas, action, renderOptions, scaleFactor = 1) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !action) return;

  const actionType = action.type || "";
  const shouldShowActionLabel =
    renderOptions.showActionLabels && Boolean(action.description);

  if (
    renderOptions.showClickIndicators &&
    hasCoordinate(action.coordinate) &&
    (actionType.includes("click") || actionType === "scroll")
  ) {
    const { x, y } = scalePoint(action.coordinate, scaleFactor);
    drawClickIndicator(ctx, x, y, scaleFactor);

    if (shouldShowActionLabel) {
      drawActionLabel(ctx, action.description, x, y, scaleFactor);
    }
  }

  if (
    renderOptions.showDragPaths &&
    actionType === "left_click_drag" &&
    hasCoordinate(action.start_coordinate) &&
    hasCoordinate(action.coordinate)
  ) {
    const start = scalePoint(action.start_coordinate, scaleFactor);
    const end = scalePoint(action.coordinate, scaleFactor);

    drawDragPath(ctx, start.x, start.y, end.x, end.y, scaleFactor);

    if (shouldShowActionLabel) {
      drawActionLabel(ctx, action.description, end.x, end.y, scaleFactor);
    }
  }

  if (
    renderOptions.showActionLabels &&
    action.description &&
    !hasCoordinate(action.coordinate) &&
    (actionType === "type" || actionType === "key" || actionType === "wait")
  ) {
    drawActionLabel(
      ctx,
      action.description,
      20 * scaleFactor,
      20 * scaleFactor,
      scaleFactor,
    );
  }
}

function normalizeGifRenderOptions(options = {}) {
  return {
    showClickIndicators: options.showClickIndicators ?? true,
    showDragPaths: options.showDragPaths ?? true,
    showActionLabels: options.showActionLabels ?? true,
    showProgressBar: options.showProgressBar ?? true,
    showWatermark: options.showWatermark ?? true,
  };
}

function buildFrameDataUrl(frame) {
  return `data:image/${frame.format || "png"};base64,${frame.base64}`;
}

function loadFrameImage(frame, index, totalFrames) {
  logOffscreen(`Loading image ${index + 1}/${totalFrames}`);

  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      logOffscreen(
        `Image ${index + 1} loaded: ${image.width}x${image.height}`,
      );
      resolve(image);
    };

    image.onerror = () => {
      reject(new Error(`Failed to load frame ${index + 1} of ${totalFrames}`));
    };

    image.src = buildFrameDataUrl(frame);
  });
}

function createFrameCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  return canvas;
}

async function generateGif(frames, options = {}) {
  logOffscreen(`Generating GIF from ${frames.length} frames`);
  logOffscreen("Options:", options);

  const renderOptions = normalizeGifRenderOptions(options);

  const images = await Promise.all(
    frames.map((frame, index) => loadFrameImage(frame, index, frames.length)),
  );

  logOffscreen(`All ${images.length} images loaded`);

  const width = images[0].width;
  const height = images[0].height;

  logOffscreen("Enhancing frames with indicators and overlays");

  const enhancedCanvases = images.map((image, index) => {
    const canvas = createFrameCanvas(image);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Unable to create a 2D canvas context");
    }

    ctx.drawImage(image, 0, 0);

    const frame = frames[index];
    const scaleFactor = getFrameScaleFactor(frame, canvas);

    if (frame.viewportWidth && canvas.width) {
      logOffscreen(
        `Frame ${index + 1}: Applying scale factor ${scaleFactor} (canvas: ${canvas.width}x${canvas.height}, viewport: ${frame.viewportWidth}x${frame.viewportHeight})`,
      );
    } else {
      logOffscreen(
        `Frame ${index + 1}: No viewport metadata, using scale factor 1.0 (backwards compatibility)`,
      );
    }

    if (frame.action) {
      applyActionIndicators(
        canvas,
        frame.action,
        renderOptions,
        scaleFactor,
      );
    }

    const progress = (index + 1) / images.length;

    if (renderOptions.showProgressBar) {
      drawProgressBar(ctx, progress, scaleFactor);
    }

    if (renderOptions.showWatermark) {
      drawWatermark(ctx, scaleFactor);
    }

    logOffscreen(
      `Frame ${index + 1}/${images.length} enhanced (progress: ${Math.round(progress * 100)}%)`,
    );

    return canvas;
  });

  logOffscreen(
    `Creating GIF encoder: ${width}x${height}, workers: ${GIF_WORKER_COUNT}`,
  );

  const frameDelays = frames.map((frame, index) => {
    const baseDelay = frame.delay || DEFAULT_FRAME_DELAY_MS;
    const isLastFrame = index === frames.length - 1;
    return isLastFrame ? baseDelay + FINAL_FRAME_EXTENSION_MS : baseDelay;
  });

  return new Promise((resolve, reject) => {
    const gif = new GIF({
      workers: GIF_WORKER_COUNT,
      quality: options.quality || GIF_QUALITY_DEFAULT,
      width,
      height,
      workerScript: GIF_WORKER_SCRIPT_URL,
      repeat: 0,
      debug: true,
    });

    gif.on("progress", (percent) => {
      logOffscreen(`GIF encoding progress: ${Math.round(percent * 100)}%`);
    });

    gif.on("finished", (blob) => {
      logOffscreen(`GIF created: ${blob.size} bytes`);

      const blobUrl = URL.createObjectURL(blob);
      logOffscreen(`Created blob URL: ${blobUrl}`);

      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;

        if (typeof result !== "string") {
          reject(new Error("Failed to convert GIF blob to base64"));
          return;
        }

        const base64 = result.split(",")[1];
        logOffscreen(`Conversion complete, base64 length: ${base64.length}`);
        resolve({
          base64,
          blobUrl,
          size: blob.size,
          width,
          height,
        });
      };

      reader.onerror = () => reject(new Error("Failed to convert GIF blob to base64"));
      reader.readAsDataURL(blob);
    });

    gif.on("abort", () => reject(new Error("GIF rendering aborted")));

    enhancedCanvases.forEach((canvas, index) => {
      gif.addFrame(canvas, { delay: frameDelays[index] });
    });

    logOffscreen("Starting GIF rendering");
    gif.render();
  });
}

function handleRuntimeMessage(message, _sender, sendResponse) {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === MESSAGE_TYPES.playSound) {
    logOffscreen("Received OFFSCREEN_PLAY_SOUND message");

    const volume = message.volume || DEFAULT_SOUND_VOLUME;
    if (typeof message.audioUrl !== "string" || message.audioUrl.length === 0) {
      sendResponse({
        success: false,
        error: "Missing audioUrl for offscreen playback",
      });
      return false;
    }

    playAudioFromUrl(message.audioUrl, volume)
      .then(() => {
        logOffscreen("Sound played successfully via Web Audio API");
        sendResponse({ success: true });
      })
      .catch((error) => {
        logOffscreenError("Failed to play sound", error);
        sendResponse({ success: false, error: getErrorMessage(error) });
      });

    return true;
  }

  if (message.type === MESSAGE_TYPES.revokeBlobUrl) {
    if (typeof message.blobUrl === "string" && message.blobUrl.length > 0) {
      URL.revokeObjectURL(message.blobUrl);
    }

    sendResponse({ success: true });
    return false;
  }

  if (message.type === MESSAGE_TYPES.generateGif) {
    logOffscreen("Received GENERATE_GIF message");
    logOffscreen(`Frames: ${message.frames?.length}`);
    logOffscreen("Options:", message.options);

    if (!Array.isArray(message.frames) || message.frames.length === 0) {
      sendResponse({
        success: false,
        error: "No frames were provided for GIF generation",
      });
      return false;
    }

    generateGif(message.frames, message.options)
      .then((result) => {
        logOffscreen("GIF generated successfully");
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        logOffscreenError("Failed to generate GIF", error);
        sendResponse({ success: false, error: getErrorMessage(error) });
      });

    return true;
  }

  return false;
}
