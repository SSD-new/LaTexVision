
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageBlock extends BoundingBox {
  id: string;
  dataUrl: string;
}

export interface SegmentationConfig {
  minW: number;
  minH: number;
  padx: number;
  pady: number;
  kernelW: number;
  kernelH: number;
  yTolerance: number;
}

export interface LayoutData {
  symbols: BoundingBox[];
  blocks: ImageBlock[];
}

export interface ColumnSpecificCut {
  y: number;
  colIdx: number;
}

export const checkOpenCVReady = (): boolean => {
  // @ts-ignore
  return typeof window !== 'undefined' && !!window.cv && !!window.cv.imread;
};

function filterNestedBoxes(boxes: BoundingBox[]): BoundingBox[] {
  return boxes.filter((b1, i) => {
    const isInsideAnother = boxes.some((b2, j) => {
      if (i === j) return false;
      return (
        b1.x >= b2.x - 1 &&
        b1.y >= b2.y - 1 &&
        (b1.x + b1.width) <= (b2.x + b2.width) + 1 &&
        (b1.y + b1.height) <= (b2.y + b2.height) + 1
      );
    });
    return !isInsideAnother;
  });
}

function isBoxInMask(box: BoundingBox, masks: BoundingBox[]): boolean {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  
  return masks.some(mask => {
    return (
      centerX >= mask.x &&
      centerX <= mask.x + mask.width &&
      centerY >= mask.y &&
      centerY <= mask.y + mask.height
    );
  });
}

export const segmentImage = async (
  imageElement: HTMLImageElement,
  config: SegmentationConfig,
  masks: BoundingBox[] = [],
  hCuts: ColumnSpecificCut[] = [], // Горизонтальные разрезы с привязкой к колонке
  vCuts: number[] = []             // Вертикальные разрезы (колонки)
): Promise<LayoutData> => {
  // @ts-ignore
  const cv = window.cv;
  if (!cv || !cv.imread) throw new Error("Движок OpenCV еще загружается...");

  let src = cv.imread(imageElement);
  const rows = src.rows;
  const cols = src.cols;
  
  const white = new cv.Scalar(255, 255, 255, 255);
  for (const mask of masks) {
    const x1 = Math.max(0, Math.min(cols - 1, Math.round(mask.x)));
    const y1 = Math.max(0, Math.min(rows - 1, Math.round(mask.y)));
    const x2 = Math.max(0, Math.min(cols - 1, Math.round(mask.x + mask.width)));
    const y2 = Math.max(0, Math.min(rows - 1, Math.round(mask.y + mask.height)));
    
    if (x2 > x1 && y2 > y1) {
      cv.rectangle(src, new cv.Point(x1, y1), new cv.Point(x2, y2), white, -1);
    }
  }

  let gray = new cv.Mat();
  let thresh = new cv.Mat();
  let labels = new cv.Mat();
  let stats = new cv.Mat();
  let centroids = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

    const black = new cv.Scalar(0, 0, 0, 0);
    for (const mask of masks) {
      const x1 = Math.max(0, Math.min(cols - 1, Math.round(mask.x)));
      const y1 = Math.max(0, Math.min(rows - 1, Math.round(mask.y)));
      const x2 = Math.max(0, Math.min(cols - 1, Math.round(mask.x + mask.width)));
      const y2 = Math.max(0, Math.min(rows - 1, Math.round(mask.y + mask.height)));
      if (x2 > x1 && y2 > y1) {
        cv.rectangle(thresh, new cv.Point(x1, y1), new cv.Point(x2, y2), black, -1);
      }
    }

    let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(config.kernelW, config.kernelH));
    cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, kernel);
    cv.dilate(thresh, thresh, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    kernel.delete();

    cv.connectedComponentsWithStats(thresh, labels, stats, centroids, 8);

    const numLabels = stats.rows;
    let rawBoxes: BoundingBox[] = [];

    for (let i = 1; i < numLabels; i++) {
      const x = stats.data32S[i * 5 + 0];
      const y = stats.data32S[i * 5 + 1];
      const w = stats.data32S[i * 5 + 2];
      const h = stats.data32S[i * 5 + 3];

      if (w < config.minW || h < config.minH) continue;
      
      const box = { x, y, width: w, height: h };
      if (!isBoxInMask(box, masks)) {
        rawBoxes.push(box);
      }
    }

    let processedBoxes = filterNestedBoxes(rawBoxes);

    // СОРТИРОВКА ПО КОЛОНКАМ ДЛЯ ПРАВИЛЬНОГО ПРИМЕНЕНИЯ РАЗРЕЗОВ
    const sortedVCuts = [...vCuts].sort((a, b) => a - b);
    const getColIdx = (box: BoundingBox) => {
      const midX = box.x + box.width / 2;
      let idx = 0;
      for (const cutX of sortedVCuts) {
        if (midX > cutX) idx++;
      }
      return idx;
    };

    // ПРИМЕНЕНИЕ ВЕРТИКАЛЬНЫХ РАЗРЕЗОВ (КОЛОНКИ)
    if (vCuts.length > 0) {
      let finalSplitBoxes: BoundingBox[] = [];
      for (const box of processedBoxes) {
        let currentSegments: BoundingBox[] = [box];
        for (const cutX of vCuts) {
          let nextSegments: BoundingBox[] = [];
          for (const segment of currentSegments) {
            if (cutX > segment.x && cutX < segment.x + segment.width) {
              nextSegments.push({ ...segment, width: cutX - segment.x });
              nextSegments.push({ ...segment, x: cutX, width: (segment.x + segment.width) - cutX });
            } else {
              nextSegments.push(segment);
            }
          }
          currentSegments = nextSegments;
        }
        finalSplitBoxes.push(...currentSegments);
      }
      processedBoxes = finalSplitBoxes;
    }

    // ПРИМЕНЕНИЕ КОЛОНОЧНО-ЗАВИСИМЫХ ГОРИЗОНТАЛЬНЫХ РАЗРЕЗОВ (АБЗАЦЫ)
    if (hCuts.length > 0) {
      let finalSplitBoxes: BoundingBox[] = [];
      for (const box of processedBoxes) {
        let currentSegments: BoundingBox[] = [box];
        const boxCol = getColIdx(box);
        
        // Берем только разрезы для этой колонки
        const relevantCuts = hCuts.filter(c => c.colIdx === boxCol);

        for (const cut of relevantCuts) {
          let nextSegments: BoundingBox[] = [];
          for (const segment of currentSegments) {
            if (cut.y > segment.y && cut.y < segment.y + segment.height) {
              nextSegments.push({ ...segment, height: cut.y - segment.y });
              nextSegments.push({ ...segment, y: cut.y, height: (segment.y + segment.height) - cut.y });
            } else {
              nextSegments.push(segment);
            }
          }
          currentSegments = nextSegments;
        }
        finalSplitBoxes.push(...currentSegments);
      }
      processedBoxes = finalSplitBoxes;
    }

    const avgH = processedBoxes.length > 0 
      ? processedBoxes.reduce((acc, b) => acc + b.height, 0) / processedBoxes.length 
      : 25;

    // ИТОГОВАЯ СОРТИРОВКА
    processedBoxes.sort((a, b) => {
      const colA = getColIdx(a);
      const colB = getColIdx(b);
      if (colA !== colB) return colA - colB;

      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) < avgH * config.yTolerance) {
        return a.x - b.x;
      }
      return yDiff;
    });

    const finalBlocks: ImageBlock[] = processedBoxes.map((box, i) => {
      let finalX = Math.max(0, box.x - config.padx);
      let finalY = Math.max(0, box.y - config.pady);
      let finalW = Math.min(cols - finalX, box.width + 2 * config.padx);
      let finalH = Math.min(rows - finalY, box.height + 2 * config.pady);

      let rect = new cv.Rect(finalX, finalY, finalW, finalH);
      let roi = src.roi(rect);
      
      // --- POST-PROCESSING ДЛЯ ТОНКОГО ТЕКСТА ---
      // Создаем копию для обработки
      let processed = new cv.Mat();
      
      // 1. Конвертация в Ч/Б (Grayscale) - убирает цветовой шум
      cv.cvtColor(roi, processed, cv.COLOR_RGBA2GRAY);
      
      // 2. Утолщение текста (Erosion на черном тексте/белом фоне расширяет черное)
      // Используем ядро 2x2. Это добавит ~0.5-1px толщины к линиям.
      let thickenKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
      cv.erode(processed, processed, thickenKernel);
      thickenKernel.delete();
      
      // --- END POST-PROCESSING ---

      let tempCanvas = document.createElement('canvas');
      tempCanvas.width = finalW;
      tempCanvas.height = finalH;
      cv.imshow(tempCanvas, processed); // Рисуем обработанный блок
      
      processed.delete();
      roi.delete();

      return {
        x: finalX, y: finalY, width: finalW, height: finalH,
        id: `line-${i}-${Math.random().toString(36).substr(2, 5)}`,
        dataUrl: tempCanvas.toDataURL('image/png')
      };
    });

    return { symbols: rawBoxes, blocks: finalBlocks };
  } finally {
    src.delete(); gray.delete(); thresh.delete();
    labels.delete(); stats.delete(); centroids.delete();
  }
};
