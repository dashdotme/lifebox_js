// ===== Shared Cellular Automata Main Thread/Renderer =====
// Handles orchestration, debug info and canvas drawing

import {
  GREEN,
  RED,
  BLACK,
  WATER,
  YELLOW,
  TEXT_CELL_1,
  TEXT_CELL_2,
  TEXT_CELL_3,
  PURPLE,
  colorRanges,
  coordToIdx,
  getRandomHue,
  generateTextPattern,
} from "./automata-shared.js";

const debug = document.getElementById("debug");
const canvas = document.getElementById("simulation-canvas");
const ctx = canvas.getContext("2d");

const CONFIG = {
  cellSize: 20,
  minCellSize: 1,
  greenGrowthLimit: 30,
  padding: 2,
  fullGridSize: 750,
  maxZoomSize: 1500,
  startingCells: 500,
  simSkipRate: 3,
  updateInterval: 33,
  renderInterval: 16,
  zoomDebounceMs: 300,
};

let cellSize = CONFIG.cellSize;
let gridSize = Math.floor(canvas.width / cellSize);
let viewOffsetX = Math.floor((CONFIG.fullGridSize - gridSize) / 2);
let viewOffsetY = Math.floor((CONFIG.fullGridSize - gridSize) / 2);
let updateCounter = 0;
let textRevealCounter = 0;
let revealedX = 0;
let textCellCount = 0;
let lastEdgeCells = 0;
let lastNonEmptyCells = 0;
let lastZoomTime = 0;

const startTime = performance.now();
let lastFrameTime = 0;
let lastSimulationTime = 0;
let frameCount = 0;
let fpsUpdateTime = 0;
let currentFPS = 0;

let gridBuffer = new Uint8Array(CONFIG.fullGridSize * CONFIG.fullGridSize);
let textGridBuffer = new Uint8Array(CONFIG.fullGridSize * CONFIG.fullGridSize);

let worker = null;
let isSimulationRunning = false;
let pendingUpdate = false;

let performanceMode = "high";
let lastFPSCheck = 0;
let fpsHistory = [];
let renderMode = "original";

const colorCache = {};
for (const typeStr in colorRanges) {
  const type = parseInt(typeStr);
  if (type === BLACK) {
    colorCache[type] = Array(20).fill("#000000");
    continue;
  }
  colorCache[type] = Array(20)
    .fill()
    .map(() => {
      const hue = getRandomHue(colorRanges[type]);
      return `hsl(${hue}, 100%, 50%)`;
    });
}

const rgbColors = {};
for (const type in colorCache) {
  if (parseInt(type) === BLACK) {
    rgbColors[type] = [0, 0, 0];
    continue;
  }
  const hslMatch = colorCache[type][0].match(
    /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/,
  );
  if (hslMatch) {
    const [, h, s, l] = hslMatch.map(Number);
    const c = ((1 - Math.abs((2 * l) / 100 - 1)) * s) / 100;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l / 100 - c / 2;
    let r, g, b;
    if (h < 60) {
      r = c;
      g = x;
      b = 0;
    } else if (h < 120) {
      r = x;
      g = c;
      b = 0;
    } else if (h < 180) {
      r = 0;
      g = c;
      b = x;
    } else if (h < 240) {
      r = 0;
      g = x;
      b = c;
    } else if (h < 300) {
      r = x;
      g = 0;
      b = c;
    } else {
      r = c;
      g = 0;
      b = x;
    }
    rgbColors[type] = [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }
}

function updateDebug() {
  const elapsedTime = (performance.now() - startTime) / 1000;
  const zoomLevel = ((CONFIG.cellSize / cellSize) * 100).toFixed(1);
  const totalCells = gridSize * gridSize;

  debug.innerHTML = `
<strong>Automata Info</strong>
Time: ${elapsedTime.toFixed(1)}s | FPS: ${currentFPS}
Update: ${updateCounter} | Visible cells: ${totalCells.toLocaleString()}
Non-empty cells: ${lastNonEmptyCells.toLocaleString()}

<strong>Grid & Zoom</strong>
Cell size: ${cellSize.toFixed(2)}px | Zoom: ${zoomLevel}%
Grid size: ${gridSize}x${gridSize}
Simulation: ${CONFIG.fullGridSize}x${CONFIG.fullGridSize}

<strong>Viewport</strong>
Offset: (${viewOffsetX}, ${viewOffsetY})
Edge cells: ${lastEdgeCells}

<strong>Performance</strong>
Render Mode: ${renderMode}
Adaptive Performance: ${performanceMode}

<strong>Text Reveal</strong>
Applied: ${textCellCount} | Columns revealed: ${revealedX}
      `.trim();
}

function calculateFPS(timestamp) {
  frameCount++;
  if (timestamp - fpsUpdateTime >= 1000) {
    currentFPS = Math.round((frameCount * 1000) / (timestamp - fpsUpdateTime));
    frameCount = 0;
    fpsUpdateTime = timestamp;
  }
}

function drawGridOriginal() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const colorIndex = Math.floor(Math.random() * 20);
  const maxCellsX = Math.floor(canvas.width / cellSize);
  const maxCellsY = Math.floor(canvas.height / cellSize);
  const renderWidth = Math.min(gridSize, maxCellsX);
  const renderHeight = Math.min(gridSize, maxCellsY);

  for (let y = 0; y < renderHeight; y++) {
    for (let x = 0; x < renderWidth; x++) {
      const gridX = x + viewOffsetX;
      const gridY = y + viewOffsetY;

      if (
        gridX >= 0 &&
        gridX < CONFIG.fullGridSize &&
        gridY >= 0 &&
        gridY < CONFIG.fullGridSize
      ) {
        const cellType =
          gridBuffer[coordToIdx(gridX, gridY, CONFIG.fullGridSize)];
        if (cellType) {
          ctx.fillStyle = colorCache[cellType][colorIndex];
          const minVisualSize = Math.max(1, cellSize - CONFIG.padding);
          ctx.fillRect(
            x * cellSize + (cellSize - minVisualSize) / 2,
            y * cellSize + (cellSize - minVisualSize) / 2,
            minVisualSize,
            minVisualSize,
          );
        }
      }
    }
  }
}

function drawGridBatched() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cellsByColor = {};
  const maxCellsX = Math.floor(canvas.width / cellSize);
  const maxCellsY = Math.floor(canvas.height / cellSize);
  const renderWidth = Math.min(gridSize, maxCellsX);
  const renderHeight = Math.min(gridSize, maxCellsY);

  for (let y = 0; y < renderHeight; y++) {
    for (let x = 0; x < renderWidth; x++) {
      const gridX = x + viewOffsetX;
      const gridY = y + viewOffsetY;

      if (
        gridX >= 0 &&
        gridX < CONFIG.fullGridSize &&
        gridY >= 0 &&
        gridY < CONFIG.fullGridSize
      ) {
        const cellType =
          gridBuffer[coordToIdx(gridX, gridY, CONFIG.fullGridSize)];
        if (cellType) {
          const color = colorCache[cellType][0];
          if (!cellsByColor[color]) cellsByColor[color] = [];
          cellsByColor[color].push({ x, y });
        }
      }
    }
  }

  const minVisualSize = Math.max(1, cellSize - CONFIG.padding);
  for (const color in cellsByColor) {
    ctx.fillStyle = color;
    ctx.beginPath();

    for (const { x, y } of cellsByColor[color]) {
      ctx.rect(
        x * cellSize + (cellSize - minVisualSize) / 2,
        y * cellSize + (cellSize - minVisualSize) / 2,
        minVisualSize,
        minVisualSize,
      );
    }
    ctx.fill();
  }
}

function drawGridWithImageData() {
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  const data = imageData.data;

  const maxCellsX = Math.floor(canvas.width / cellSize);
  const maxCellsY = Math.floor(canvas.height / cellSize);
  const renderWidth = Math.min(gridSize, maxCellsX);
  const renderHeight = Math.min(gridSize, maxCellsY);

  for (let y = 0; y < renderHeight; y++) {
    for (let x = 0; x < renderWidth; x++) {
      const gridX = x + viewOffsetX;
      const gridY = y + viewOffsetY;

      if (
        gridX >= 0 &&
        gridX < CONFIG.fullGridSize &&
        gridY >= 0 &&
        gridY < CONFIG.fullGridSize
      ) {
        const cellType =
          gridBuffer[coordToIdx(gridX, gridY, CONFIG.fullGridSize)];
        if (cellType && rgbColors[cellType]) {
          const [r, g, b] = rgbColors[cellType];

          const startPixelX = Math.floor(x * cellSize);
          const startPixelY = Math.floor(y * cellSize);
          const endPixelX = Math.min(
            startPixelX + Math.floor(cellSize),
            canvas.width,
          );
          const endPixelY = Math.min(
            startPixelY + Math.floor(cellSize),
            canvas.height,
          );

          for (let py = startPixelY; py < endPixelY; py++) {
            for (let px = startPixelX; px < endPixelX; px++) {
              const index = (py * canvas.width + px) * 4;
              data[index] = r;
              data[index + 1] = g;
              data[index + 2] = b;
              data[index + 3] = 255;
            }
          }
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function drawGridLowQuality() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const step = cellSize < 2 ? 2 : 1;
  const maxCellsX = Math.floor(canvas.width / cellSize);
  const maxCellsY = Math.floor(canvas.height / cellSize);
  const renderWidth = Math.min(gridSize, maxCellsX);
  const renderHeight = Math.min(gridSize, maxCellsY);

  const simpleColors = {
    [GREEN]: "#00ff00",
    [RED]: "#ff0000",
    [BLACK]: "#000000",
    [WATER]: "#0000ff",
    [YELLOW]: "#ffff00",
    [PURPLE]: "#ff00ff",
    [TEXT_CELL_1]: "#000000",
    [TEXT_CELL_2]: "#000000",
    [TEXT_CELL_3]: "#000000",
  };

  for (let y = 0; y < renderHeight; y += step) {
    for (let x = 0; x < renderWidth; x += step) {
      const gridX = x + viewOffsetX;
      const gridY = y + viewOffsetY;
      if (
        gridX >= 0 &&
        gridX < CONFIG.fullGridSize &&
        gridY >= 0 &&
        gridY < CONFIG.fullGridSize
      ) {
        const cellType =
          gridBuffer[coordToIdx(gridX, gridY, CONFIG.fullGridSize)];
        if (cellType && simpleColors[cellType]) {
          ctx.fillStyle = simpleColors[cellType];
          ctx.fillRect(
            x * cellSize,
            y * cellSize,
            cellSize * step,
            cellSize * step,
          );
        }
      }
    }
  }
}

function adaptiveDrawGrid() {
  const now = performance.now();
  if (now - lastFPSCheck > 2000) {
    fpsHistory.push(currentFPS);
    if (fpsHistory.length > 3) fpsHistory.shift();
    const avgFPS = fpsHistory.reduce((a, b) => a + b) / fpsHistory.length;
    performanceMode = avgFPS < 15 ? "low" : "high";
    lastFPSCheck = now;
  }

  performanceMode === "low" ? drawGridLowQuality() : drawGridBatched();
}

function drawGrid() {
  switch (renderMode) {
    case "original":
      drawGridOriginal();
      break;
    case "batched":
      drawGridBatched();
      break;
    case "imagedata":
      drawGridWithImageData();
      break;
    case "adaptive":
      adaptiveDrawGrid();
      break;
    case "lowquality":
      drawGridLowQuality();
      break;
  }
}

function initializeGrid() {
  gridBuffer.fill(0);
  const cellTypes = [GREEN, RED, WATER];
  for (let i = 0; i < CONFIG.startingCells; i++) {
    const x = viewOffsetX + Math.floor(Math.random() * gridSize);
    const y = viewOffsetY + Math.floor(Math.random() * gridSize);
    const randomIndex = Math.floor(Math.random() * cellTypes.length);
    gridBuffer[y * CONFIG.fullGridSize + x] = cellTypes[randomIndex];
  }
  // remove loading pop-in
  zoomOut(50);
}

function generateTextGrid() {
  textGridBuffer = generateTextPattern(CONFIG.fullGridSize).textGridBuffer;

  // generateDebugTextPanel();
  return textGridBuffer;
}

function generateDebugTextPanel() {
  const previewSize = 200;
  const { textGridBuffer: previewTextGrid } = generateTextPattern(previewSize);

  const previewCanvas = document.createElement("canvas");
  previewCanvas.id = "textPreview";
  previewCanvas.width = previewSize;
  document.body.appendChild(previewCanvas);

  const previewCtx = previewCanvas.getContext("2d");
  const previewImageData = previewCtx.createImageData(previewSize, previewSize);

  for (let y = 0; y < previewSize; y++) {
    for (let x = 0; x < previewSize; x++) {
      const idx = (y * previewSize + x) * 4;
      const alpha = previewTextGrid[y * previewSize + x];
      previewImageData.data[idx + 3] = alpha;
    }
  }

  previewCtx.putImageData(previewImageData, 0, 0);

  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = previewSize;
  scaledCanvas.height = 150;
  const scaledCtx = scaledCanvas.getContext("2d");
  scaledCtx.drawImage(
    previewCanvas,
    0,
    0,
    previewSize,
    previewSize,
    0,
    0,
    previewSize,
    150,
  );

  previewCtx.clearRect(0, 0, previewSize, 150);
  previewCtx.drawImage(scaledCanvas, 0, 0);
}

function zoomOut(edgeCells) {
  const zoomFactor = Math.min(1.05 + edgeCells * 0.1, 2);
  const newCellSize = cellSize / zoomFactor;
  if (newCellSize >= CONFIG.minCellSize) {
    cellSize = newCellSize;
    gridSize = Math.floor(canvas.width / cellSize);
  }
}

function centerOnTextArea() {
  const centerX = Math.floor(CONFIG.fullGridSize / 2);
  const centerY = Math.floor(CONFIG.fullGridSize / 2);
  if (gridSize >= CONFIG.fullGridSize) {
    viewOffsetX = centerX - Math.floor(gridSize / 2);
    viewOffsetY = centerY - Math.floor(gridSize / 2);
  } else {
    viewOffsetX = Math.max(
      0,
      Math.min(
        centerX - Math.floor(gridSize / 2),
        CONFIG.fullGridSize - gridSize,
      ),
    );
    viewOffsetY = Math.max(
      0,
      Math.min(
        centerY - Math.floor(gridSize / 2),
        CONFIG.fullGridSize - gridSize,
      ),
    );
  }
}

function initializeWorker() {
  try {
    worker = new Worker("./worker.js", { type: "module" });
  } catch (e) {
    console.warn("Could not load module worker");
    return;
  }

  worker.onmessage = (e) => {
    const {
      type,
      grid,
      counter,
      textCounter,
      revealedX: newRevealedX,
      textCellCount: newTextCellCount,
      edgeCells,
      nonEmptyCells,
    } = e.data;

    if (type === "updated") {
      if (grid) gridBuffer = new Uint8Array(grid);
      if (counter !== undefined) updateCounter = counter;
      if (textCounter !== undefined) textRevealCounter = textCounter;
      if (newRevealedX !== undefined) revealedX = newRevealedX;
      if (newTextCellCount !== undefined) textCellCount = newTextCellCount;
      if (edgeCells !== undefined) lastEdgeCells = edgeCells;
      if (nonEmptyCells !== undefined && nonEmptyCells !== 0) lastNonEmptyCells = nonEmptyCells;

      const now = performance.now();
      if (edgeCells > 1 && gridSize < CONFIG.maxZoomSize && (now - lastZoomTime) > CONFIG.zoomDebounceMs) {
        zoomOut(edgeCells);
        centerOnTextArea();
        lastZoomTime = now;
      }

      pendingUpdate = false;
      if (isSimulationRunning) {
        requestSimulationUpdate();
      }
    } else if (type === "initialized") {
      startSimulation();
    }
  };

  worker.onerror = function (error) {
    console.error("Worker error:", error);
    pendingUpdate = false;
  };

  const gridCopy = new Uint8Array(gridBuffer);
  const textGridCopy = new Uint8Array(textGridBuffer);

  worker.postMessage(
    {
      type: "initialize",
      fullGridSize: CONFIG.fullGridSize,
      greenGrowthLimit: CONFIG.greenGrowthLimit,
      simSkipRate: CONFIG.simSkipRate,
      grid: gridCopy.buffer,
      textGrid: textGridCopy.buffer,
    },
    [gridCopy.buffer, textGridCopy.buffer],
  );
}

function requestSimulationUpdate() {
  if (pendingUpdate || !isSimulationRunning) return;
  const now = performance.now();
  const timeSinceLastUpdate = now - lastSimulationTime;
  if (timeSinceLastUpdate < CONFIG.updateInterval) {
    setTimeout(
      requestSimulationUpdate,
      CONFIG.updateInterval - timeSinceLastUpdate,
    );
    return;
  }
  pendingUpdate = true;
  lastSimulationTime = now;
  const gridCopy = new Uint8Array(CONFIG.fullGridSize * CONFIG.fullGridSize);
  gridCopy.set(gridBuffer);
  worker.postMessage(
    {
      type: "update",
      grid: gridCopy.buffer,
      viewOffsetX: viewOffsetX,
      viewOffsetY: viewOffsetY,
      gridSize: gridSize,
    },
    [gridCopy.buffer],
  );
}

function startSimulation() {
  if (isSimulationRunning) return;
  isSimulationRunning = true;
  requestSimulationUpdate();
}

function loop(timestamp) {
  calculateFPS(timestamp);
  const targetFrameTime = currentFPS < 20 ? 100 : CONFIG.renderInterval;
  if (timestamp - lastFrameTime >= targetFrameTime) {
    drawGrid();
    centerOnTextArea();
    const debugUpdateFreq = currentFPS < 15 ? 60 : 30;
    if (frameCount % debugUpdateFreq === 0) {
      updateDebug();
    }
    lastFrameTime = timestamp;
  }
  requestAnimationFrame(loop);
}

function initialize() {
  updateDebug();
  initializeGrid();
  generateTextGrid();
  centerOnTextArea();
  initializeWorker();

  document.getElementById("original").onclick = () => {
    renderMode = "original";
    document
      .querySelectorAll("#controls button")
      .forEach((b) => b.classList.remove("active"));
    document.getElementById("original").classList.add("active");
  };

  document.getElementById("batched").onclick = () => {
    renderMode = "batched";
    document
      .querySelectorAll("#controls button")
      .forEach((b) => b.classList.remove("active"));
    document.getElementById("batched").classList.add("active");
  };

  document.getElementById("imagedata").onclick = () => {
    renderMode = "imagedata";
    document
      .querySelectorAll("#controls button")
      .forEach((b) => b.classList.remove("active"));
    document.getElementById("imagedata").classList.add("active");
  };

  document.getElementById("adaptive").onclick = () => {
    renderMode = "adaptive";
    document
      .querySelectorAll("#controls button")
      .forEach((b) => b.classList.remove("active"));
    document.getElementById("adaptive").classList.add("active");
  };

  document.getElementById("lowquality").onclick = () => {
    renderMode = "lowquality";
    document
      .querySelectorAll("#controls button")
      .forEach((b) => b.classList.remove("active"));
    document.getElementById("lowquality").classList.add("active");
  };

  requestAnimationFrame(loop);
}

if (document.fonts) {
  document.fonts.ready.then(() => {
    setTimeout(initialize, 500);
  });
} else {
  setTimeout(initialize, 1000);
}
