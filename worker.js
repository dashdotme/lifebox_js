// ===== Cellular Automata Simulation Worker =====
// Separate thread for simulation logic

import {
  EMPTY,
  GREEN,
  RED,
  BLACK,
  WATER,
  YELLOW,
  directions,
  nD,
  getCell,
  setCell,
  createSimulationHelpers,
  getClusterSize,
  flowerGreenCells,
  applyTextCells,
  TEXT_CELL_1,
  TEXT_CELL_2,
  TEXT_CELL_3,
} from "./automata-shared.js";

// Grid configuration
let fullGridSize = 1000;
let gridBuffer;
let textGridBuffer;
let newGridBuffer;
let simSkipRate = 3;
let updateCounter = 0;
let textRevealCounter = 0;
let greenGrowthLimit = 30;
let revealedX = 0;
let textCellCount = 0;

let currentViewOffsetX = 0;
let currentViewOffsetY = 0;
let currentGridSize = 80;

let helpers;

function updateGrid() {
  if (updateCounter % simSkipRate !== 0 && updateCounter < 500) {
    updateCounter++;
    return false;
  }

  newGridBuffer.set(gridBuffer);

  let activeCells = [];
  let edgeCells = 0;

  for (let y = 1; y < fullGridSize - 1; y++) {
    for (let x = 1; x < fullGridSize - 1; x++) {
      if (getCell(gridBuffer, x, y, fullGridSize) === EMPTY) continue;

      switch (getCell(gridBuffer, x, y, fullGridSize)) {
        case TEXT_CELL_1:
        case TEXT_CELL_2:
        case TEXT_CELL_3:
          for (const direction of nD) {
            if (
              helpers.isCellType(x, y, direction, TEXT_CELL_1) ||
              helpers.isCellType(x, y, direction, TEXT_CELL_2) ||
              helpers.isCellType(x, y, direction, TEXT_CELL_3) ||
              helpers.isCellType(x, y, direction, BLACK)
            ) {
              continue;
            }

            // use thicker black margin for readability
            helpers.updateGridAtOffset(newGridBuffer, x, y, direction, BLACK);
            helpers.updateGridAtOffset(
              newGridBuffer,
              x,
              y,
              [direction[0] * 2, direction[1] * 2],
              BLACK,
            );
            helpers.updateGridAtOffset(
              newGridBuffer,
              x,
              y,
              [direction[0] * 3, direction[1] * 3],
              BLACK,
            );
          }

          break;
        case BLACK:
          helpers.updateIf(
            newGridBuffer,
            x,
            y,
            directions.down,
            EMPTY,
            directions.down,
            WATER,
          );
          break;
        case GREEN: {
          let hasWaterNeighbour = false;
          for (const direction of nD) {
            if (helpers.isCellType(x, y, direction, WATER)) {
              hasWaterNeighbour = true;
              break;
            }
          }

          if (hasWaterNeighbour) {
            helpers.updateIf(
              newGridBuffer,
              x,
              y,
              directions.upleft,
              EMPTY,
              directions.upleft,
              GREEN,
            );
            helpers.updateIf(
              newGridBuffer,
              x,
              y,
              directions.upright,
              EMPTY,
              directions.upright,
              GREEN,
            );
          } else if (helpers.isCellType(x, y, directions.down, GREEN)) {
            helpers.updateGridAtOffset(
              newGridBuffer,
              x,
              y,
              directions.up,
              GREEN,
            );
          } else if (
            helpers.isCellType(x, y, directions.left, GREEN) ||
            helpers.isCellType(x, y, directions.right, GREEN)
          ) {
            helpers.updateIf(
              newGridBuffer,
              x,
              y,
              directions.right,
              EMPTY,
              directions.left,
              GREEN,
            );
            helpers.updateIf(
              newGridBuffer,
              x,
              y,
              directions.left,
              EMPTY,
              directions.right,
              GREEN,
            );
          }

          const greenClusterSize = getClusterSize(
            x,
            y,
            GREEN,
            gridBuffer,
            fullGridSize,
            greenGrowthLimit,
          );
          if (greenClusterSize >= greenGrowthLimit) {
            flowerGreenCells(x, y, newGridBuffer, fullGridSize);
          }
          break;
        }

        case RED: {
          let burned = false;
          for (const direction of nD) {
            if (
              helpers.replaceTypeOnMatch(
                newGridBuffer,
                x,
                y,
                direction,
                YELLOW,
                RED,
              )
            ) {
              burned = true;
              break;
            } else if (Math.random() < 0.5) {
              if (
                helpers.replaceTypeOnMatch(
                  newGridBuffer,
                  x,
                  y,
                  direction,
                  GREEN,
                  RED,
                )
              ) {
                helpers.updateGridAtOffset(
                  newGridBuffer,
                  x,
                  y,
                  directions.origin,
                  EMPTY,
                );
                burned = true;
                break;
              }
            } else {
              if (
                helpers.replaceTypeOnMatch(
                  newGridBuffer,
                  x,
                  y,
                  direction,
                  EMPTY,
                  RED,
                )
              ) {
                helpers.updateGridAtOffset(
                  newGridBuffer,
                  x,
                  y,
                  directions.origin,
                  EMPTY,
                );
                burned = true;
                break;
              }
            }
          }
          break;
        }

        case WATER:
          if (
            getCell(gridBuffer, x, y + 1, fullGridSize) === EMPTY ||
            getCell(gridBuffer, x, y + 1, fullGridSize) === RED
          ) {
            setCell(newGridBuffer, x, y + 1, WATER, fullGridSize);
            setCell(newGridBuffer, x, y, EMPTY, fullGridSize);
          } else if (y >= fullGridSize - 5) {
            setCell(newGridBuffer, x, y, EMPTY, fullGridSize);
            const newX = Math.floor(Math.random() * fullGridSize);
            setCell(newGridBuffer, newX, 0, WATER, fullGridSize);
          }
          break;
      }

      if (getCell(newGridBuffer, x, y, fullGridSize) !== EMPTY) {
        activeCells.push({ x, y });
      }

      // Bounds check for zoom out
      const pos1 = Math.floor(currentGridSize * 0.25);
      const pos2 = Math.floor(currentGridSize * 0.5);
      const pos3 = Math.floor(currentGridSize * 0.75);
      const inset = currentGridSize * 0.2;

      // Check top & bottom
      for (const x of [pos1, pos2, pos3]) {
        for (const y of [inset, currentGridSize - 1 - inset]) {
          const gridX = x + currentViewOffsetX;
          const gridY = y + currentViewOffsetY;
          if (
            gridX >= 0 &&
            gridX < fullGridSize &&
            gridY >= 0 &&
            gridY < fullGridSize
          ) {
            if (getCell(newGridBuffer, gridX, gridY, fullGridSize) !== EMPTY) {
              edgeCells++;
            }
          }
        }
      }

      // Check left & right
      for (const x of [inset, currentGridSize - 1 - inset]) {
        for (const y of [pos1, pos2, pos3]) {
          const gridX = x + currentViewOffsetX;
          const gridY = y + currentViewOffsetY;
          if (
            gridX >= 0 &&
            gridX < fullGridSize &&
            gridY >= 0 &&
            gridY < fullGridSize
          ) {
            if (getCell(newGridBuffer, gridX, gridY, fullGridSize) !== EMPTY) {
              edgeCells++;
            }
          }
        }
      }
    }
  }

  const textResult = applyTextCells(
    newGridBuffer,
    textGridBuffer,
    fullGridSize,
    updateCounter,
    textRevealCounter,
    revealedX,
  );
  textRevealCounter = textResult.textRevealCounter;
  revealedX = textResult.revealedX;
  textCellCount += textResult.textCellCount;

  if (updateCounter % 100 === 0) {
    const x = Math.floor(Math.random() * fullGridSize);
    setCell(newGridBuffer, x, 0, WATER, fullGridSize);
  }

  const temp = gridBuffer;
  gridBuffer = newGridBuffer;
  newGridBuffer = temp;

  updateCounter++;

  return { edgeCells, nonEmptyCells: activeCells.length };
}

self.onmessage = (e) => {
  const data = e.data;

  if (!data) {
    console.error("Received undefined data in worker");
    return;
  }

  switch (data.type) {
    case "initialize": {
      fullGridSize = data.fullGridSize;
      greenGrowthLimit = data.greenGrowthLimit;
      simSkipRate = data.simSkipRate;

      gridBuffer = new Uint8Array(data.grid);
      newGridBuffer = new Uint8Array(fullGridSize * fullGridSize);
      textGridBuffer = new Uint8Array(data.textGrid);

      helpers = createSimulationHelpers(gridBuffer, fullGridSize);

      updateCounter = 0;
      textRevealCounter = 0;
      revealedX = 0;
      textCellCount = 0;

      console.log(
        `Worker initialized with grid size ${fullGridSize}x${fullGridSize}`,
      );

      self.postMessage({ type: "initialized" });
      break;
    }

    case "update": {
      if (data.grid) {
        gridBuffer = new Uint8Array(data.grid);
        helpers = createSimulationHelpers(gridBuffer, fullGridSize);
      }

      if (data.viewOffsetX !== undefined) currentViewOffsetX = data.viewOffsetX;
      if (data.viewOffsetY !== undefined) currentViewOffsetY = data.viewOffsetY;
      if (data.gridSize !== undefined) currentGridSize = data.gridSize;

      const result = updateGrid();
      const edgeCells = result ? result.edgeCells : 0;
      const nonEmptyCells = result ? result.nonEmptyCells : 0;

      const resultBuffer = new Uint8Array(gridBuffer.length);
      resultBuffer.set(gridBuffer);

      self.postMessage(
        {
          type: "updated",
          counter: updateCounter,
          textCounter: textRevealCounter,
          revealedX: revealedX,
          textCellCount: textCellCount,
          edgeCells: edgeCells,
          nonEmptyCells: nonEmptyCells,
          grid: resultBuffer.buffer,
        },
        [resultBuffer.buffer],
      );
      break;
    }

    default:
      console.error("Unknown worker command type:", data.type);
  }
};
