// ===== Shared Cellular Automata Constants and Logic =====
// Mini library for code shared between worker and main threads

// Cell type constants
export const EMPTY = 0;
export const GREEN = 1;
export const RED = 2;
export const BLACK = 3;
export const WATER = 4;
export const YELLOW = 5;
export const TEXT_CELL_1 = 6;
export const TEXT_CELL_2 = 7;
export const TEXT_CELL_3 = 8;
export const PURPLE = 9;

// Color ranges for rendering
export const colorRanges = {
  [GREEN]: { min: 100, max: 140 },
  [RED]: { min: 270, max: 285 },
  [BLACK]: { min: 0, max: 0 },
  [WATER]: { min: 190, max: 210 },
  [YELLOW]: { min: 170, max: 190 },
  [TEXT_CELL_1]: { min: 190, max: 210 },
  [TEXT_CELL_2]: { min: 215, max: 235 },
  [TEXT_CELL_3]: { min: 170, max: 185 },
  [PURPLE]: { min: 270, max: 285 },
};

// Direction vectors for neighbor checking
export const directions = {
  origin: [0, 0],
  left: [0, -1],
  right: [0, 1],
  up: [-1, 0],
  down: [1, 0],
  upleft: [-1, -1],
  upright: [-1, 1],
  downleft: [1, -1],
  downright: [1, 1],
};

export const neighbourDirections = {
  left: [0, -1],
  right: [0, 1],
  up: [-1, 0],
  down: [1, 0],
};

export const flowerDirections = {
  left: [0, -1],
  right: [0, 1],
  up: [-1, 0],
  down: [1, 0],
  upleft: [-1, -1],
  downright: [1, 1],
};

export const surroundingDirections = {
  left: [0, -1],
  right: [0, 1],
  up: [-1, 0],
  down: [1, 0],
  upleft: [-1, -1],
  upright: [-1, 1],
  downleft: [1, -1],
  downright: [1, 1],
};

export const belowDirections = {
  down: [1, 0],
  downleft: [1, -1],
  downright: [1, 1],
};

export const nonBelowDirections = {
  left: [0, -1],
  right: [0, 1],
  up: [-1, 0],
  upleft: [-1, -1],
  upright: [-1, 1],
};

// Convert direction objects to arrays for easier iteration
export const nD = Object.values(neighbourDirections);
export const sD = Object.values(surroundingDirections);
export const fD = Object.values(flowerDirections);
export const nBD = Object.values(nonBelowDirections);
export const bD = Object.values(belowDirections);

export const textCellTypes = [TEXT_CELL_1, TEXT_CELL_2, TEXT_CELL_3];

// Utility functions
export function getRandomHue({ min, max }) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function coordToIdx(x, y, gridSize) {
  return y * gridSize + x;
}

export function getOtherRandomTextCell(textCell) {
  const otherCellTypes = textCellTypes.filter(
    (cellType) => cellType != textCell,
  );
  const randomIndex = Math.floor(Math.random() * otherCellTypes.length);
  return otherCellTypes[randomIndex];
}

// Grid manipulation functions
export function getCell(grid, x, y, gridSize) {
  if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) return EMPTY;
  return grid[coordToIdx(x, y, gridSize)];
}

export function setCell(grid, x, y, value, gridSize) {
  if (x >= 0 && y >= 0 && x < gridSize && y < gridSize) {
    grid[coordToIdx(x, y, gridSize)] = value;
  }
}

// Simulation helper functions factory
export function createSimulationHelpers(gridBuffer, gridSize) {
  return {
    isCellType(x, y, [dy, dx], type) {
      return getCell(gridBuffer, x + dx, y + dy, gridSize) === type;
    },

    updateGridAtOffset(newGrid, x, y, [dy, dx], type) {
      setCell(newGrid, x + dx, y + dy, type, gridSize);
    },

    replaceTypeOnMatch(newGrid, x, y, [dy, dx], typeBefore, typeAfter) {
      if (this.isCellType(x, y, [dy, dx], typeBefore)) {
        this.updateGridAtOffset(newGrid, x, y, [dy, dx], typeAfter);
        return true;
      }
      return false;
    },

    updateIf(
      newGrid,
      x,
      y,
      [dyCheck, dxCheck],
      checkType,
      [dyUpdate, dxUpdate],
      updateType,
      invert = false,
    ) {
      const match = this.isCellType(x, y, [dyCheck, dxCheck], checkType);
      if (invert ? !match : match) {
        this.updateGridAtOffset(
          newGrid,
          x,
          y,
          [dyUpdate, dxUpdate],
          updateType,
        );
        return true;
      }
      return false;
    },
  };
}

// Cluster detection using DFS
export function getClusterSize(x, y, type, gridBuffer, gridSize, growthLimit) {
  const visited = new Set();
  let size = 0;
  const stack = [{ x, y }];

  while (stack.length > 0) {
    const current = stack.pop();
    const cx = current.x;
    const cy = current.y;
    const key = cy * gridSize + cx;

    if (visited.has(key) || getCell(gridBuffer, cx, cy, gridSize) !== type) {
      continue;
    }

    visited.add(key);
    size++;

    if (size >= growthLimit) {
      return size;
    }

    if (cy + 1 < gridSize) stack.push({ x: cx, y: cy + 1 });
    if (cy - 1 >= 0) stack.push({ x: cx, y: cy - 1 });
    if (cx + 1 < gridSize) stack.push({ x: cx + 1, y: cy });
    if (cx - 1 >= 0) stack.push({ x: cx - 1, y: cy });
  }

  return size;
}

export function flowerGreenCells(x, y, grid, gridSize) {
  setCell(grid, x, y, YELLOW, gridSize);
  let spawned = 0;

  for (const [dx, dy] of fD) {
    const nx = x + dx;
    const ny = y + dy;
    if (getCell(grid, nx, ny, gridSize) === EMPTY) {
      setCell(grid, nx, ny, GREEN, gridSize);
      spawnCellNearby(nx, ny, grid, WATER, gridSize);
      spawned++;
      if (spawned >= 5) break;
    }
  }
}

export function spawnCellNearby(x, y, grid, cellType, gridSize) {
  for (const [dy, dx] of nD) {
    const nx = x + dx;
    const ny = y + dy;
    if (getCell(grid, nx, ny, gridSize) === EMPTY) {
      setCell(grid, nx, ny, cellType, gridSize);
      break;
    }
  }
}

// multi-lines are supported, but block and ascii-style text render poorly
export function generateTextPattern(gridSize) {
  const textLines = ["lifebox"];
  const textCanvas = new OffscreenCanvas(gridSize, gridSize);
  const textCtx = textCanvas.getContext("2d");

  textCtx.clearRect(0, 0, gridSize, gridSize);

  const fontFamily = "JetBrains Mono";

  // alignment - width & size (xaxis)
  const maxLineLength = Math.max(...textLines.map((line) => line.length));
  const textCanvasWidth = gridSize * 0.6;
  const monospaceCharWidth = 0.6;
  const fontSize = textCanvasWidth / (maxLineLength * monospaceCharWidth);

  textCtx.textAlign = "center";
  textCtx.textBaseline = "middle";
  textCtx.fillStyle = "#000";

  // alignment - height (yaxis)
  const lineHeight = fontSize * 1.2;
  const totalHeight = textLines.length * lineHeight;
  const yOffset = gridSize / 5; // moves the text off the center of the sim
  const startY = (gridSize - totalHeight) / 2 + yOffset;

  textCtx.font = `bold ${fontSize}px ${fontFamily}`;
  textCtx.strokeStyle = "#000";
  textCtx.lineWidth = 2;

  for (let i = 0; i < textLines.length; i++) {
    const y = startY + i * lineHeight;
    textCtx.fillText(textLines[i], gridSize / 2, y);
    textCtx.strokeText(textLines[i], gridSize / 2, y);
  }

  const imageData = textCtx.getImageData(0, 0, gridSize, gridSize);
  const textGridBuffer = new Uint8Array(gridSize * gridSize);

  let textPixelCount = 0;
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = (y * gridSize + x) * 4;
      if (imageData.data[idx + 3] > 0) {
        textGridBuffer[coordToIdx(x, y, gridSize)] = imageData.data[idx + 3];
        textPixelCount++;
      }
    }
  }

  return { textGridBuffer, textPixelCount };
}

export function applyTextCells(
  nextGrid,
  textGridBuffer,
  gridSize,
  updateCounter,
  textRevealCounter,
  revealedX,
) {
  if (updateCounter < 200)
    return { textRevealCounter, revealedX, textCellCount: 0 };

  textRevealCounter += 0.2;
  const revealSpeed = 50;
  const newRevealedX = Math.min(
    gridSize,
    Math.floor(textRevealCounter * revealSpeed),
  );

  if (newRevealedX <= revealedX)
    return { textRevealCounter, revealedX, textCellCount: 0 };

  let newCells = 0;
  const textTypesLength = textCellTypes.length;

  for (let x = revealedX; x < newRevealedX; x++) {
    for (let y = 0; y < gridSize; y++) {
      if (textGridBuffer[coordToIdx(x, y, gridSize)] > 0) {
        const randomIndex = Math.floor(Math.random() * textTypesLength);
        setCell(nextGrid, x, y, textCellTypes[randomIndex], gridSize);
        newCells++;
      }
    }
  }

  return {
    textRevealCounter,
    revealedX: newRevealedX,
    textCellCount: newCells,
  };
}
