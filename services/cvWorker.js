
// cvWorker.js
// Загружаем OpenCV внутри воркера
// Используем importScripts для классического воркера или динамический импорт, если поддерживается.
// Для надежности используем CDN версию, совместимую с воркерами.

self.importScripts('https://docs.opencv.org/4.5.0/opencv.js');

function waitForOpencv(callbackFn, waitTimeMs = 30000, stepTimeMs = 100) {
  if (self.cv && self.cv.Mat) callbackFn(true);
  let timeSpentMs = 0;
  const interval = setInterval(() => {
    const limitReached = timeSpentMs > waitTimeMs;
    if (self.cv && self.cv.Mat || limitReached) {
      clearInterval(interval);
      return callbackFn(!limitReached);
    } else {
      timeSpentMs += stepTimeMs;
    }
  }, stepTimeMs);
}

// Хелперы геометрии (копии из layoutService, так как воркер изолирован)
function filterNestedBoxes(boxes) {
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

function isBoxInMask(box, masks) {
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

// Преобразование Blob в Base64 (DataURL) внутри воркера
function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

self.onmessage = async (e) => {
  const { msg, payload } = e.data;

  if (msg === 'init') {
    waitForOpencv((success) => {
      self.postMessage({ msg: 'initComplete', success });
    });
    return;
  }

  if (msg === 'segment') {
    if (!self.cv || !self.cv.Mat) {
        console.error("OpenCV not ready in worker");
        return;
    }

    try {
      const { imageData, config, masks, hCuts, vCuts } = payload;
      
      // 1. Создаем Mat из ImageData (приходит с главного потока)
      let src = self.cv.matFromImageData(imageData);
      
      // --- OPTIMIZATION: Detect on Small ---
      const TARGET_WIDTH = 1500;
      let scale = 1.0;
      let workSrc = new self.cv.Mat();

      if (src.cols > TARGET_WIDTH) {
        scale = TARGET_WIDTH / src.cols;
        let dsize = new self.cv.Size(src.cols * scale, src.rows * scale);
        self.cv.resize(src, workSrc, dsize, 0, 0, self.cv.INTER_AREA);
      } else {
        scale = 1.0;
        src.copyTo(workSrc);
      }

      const rows = workSrc.rows;
      const cols = workSrc.cols;
      
      const scaledConfig = {
        ...config,
        minW: config.minW * scale,
        minH: config.minH * scale,
        kernelW: Math.max(1, config.kernelW * scale),
        kernelH: Math.max(1, config.kernelH * scale),
      };

      // Рисуем маски на рабочей копии
      const white = new self.cv.Scalar(255, 255, 255, 255);
      for (const mask of masks) {
        const x1 = Math.max(0, Math.min(cols - 1, Math.round(mask.x * scale)));
        const y1 = Math.max(0, Math.min(rows - 1, Math.round(mask.y * scale)));
        const x2 = Math.max(0, Math.min(cols - 1, Math.round((mask.x + mask.width) * scale)));
        const y2 = Math.max(0, Math.min(rows - 1, Math.round((mask.y + mask.height) * scale)));
        
        if (x2 > x1 && y2 > y1) {
          self.cv.rectangle(workSrc, new self.cv.Point(x1, y1), new self.cv.Point(x2, y2), white, -1);
        }
      }

      // Обработка
      let gray = new self.cv.Mat();
      let thresh = new self.cv.Mat();
      let labels = new self.cv.Mat();
      let stats = new self.cv.Mat();
      let centroids = new self.cv.Mat();

      self.cv.cvtColor(workSrc, gray, self.cv.COLOR_RGBA2GRAY, 0);
      self.cv.threshold(gray, thresh, 0, 255, self.cv.THRESH_BINARY_INV + self.cv.THRESH_OTSU);

      // Маски на бинарном
      const black = new self.cv.Scalar(0, 0, 0, 0);
      for (const mask of masks) {
        const x1 = Math.max(0, Math.min(cols - 1, Math.round(mask.x * scale)));
        const y1 = Math.max(0, Math.min(rows - 1, Math.round(mask.y * scale)));
        const x2 = Math.max(0, Math.min(cols - 1, Math.round((mask.x + mask.width) * scale)));
        const y2 = Math.max(0, Math.min(rows - 1, Math.round((mask.y + mask.height) * scale)));
        if (x2 > x1 && y2 > y1) {
          self.cv.rectangle(thresh, new self.cv.Point(x1, y1), new self.cv.Point(x2, y2), black, -1);
        }
      }

      let kernel = self.cv.getStructuringElement(self.cv.MORPH_RECT, new self.cv.Size(scaledConfig.kernelW, scaledConfig.kernelH));
      self.cv.morphologyEx(thresh, thresh, self.cv.MORPH_CLOSE, kernel);
      self.cv.dilate(thresh, thresh, kernel, new self.cv.Point(-1, -1), 1, self.cv.BORDER_CONSTANT, self.cv.morphologyDefaultBorderValue());
      
      self.cv.connectedComponentsWithStats(thresh, labels, stats, centroids, 8);

      const numLabels = stats.rows;
      let rawBoxes = [];

      for (let i = 1; i < numLabels; i++) {
        const x = stats.data32S[i * 5 + 0];
        const y = stats.data32S[i * 5 + 1];
        const w = stats.data32S[i * 5 + 2];
        const h = stats.data32S[i * 5 + 3];

        if (w < scaledConfig.minW || h < scaledConfig.minH) continue;
        
        // Upscaling coordinates
        const originalBox = { 
            x: x / scale, 
            y: y / scale, 
            width: w / scale, 
            height: h / scale 
        };

        if (!isBoxInMask(originalBox, masks)) {
          rawBoxes.push(originalBox);
        }
      }

      let processedBoxes = filterNestedBoxes(rawBoxes);

      // Сортировка и разрезы (логика идентична)
      const sortedVCuts = [...vCuts].sort((a, b) => a - b);
      const getColIdx = (box) => {
        const midX = box.x + box.width / 2;
        let idx = 0;
        for (const cutX of sortedVCuts) {
          if (midX > cutX) idx++;
        }
        return idx;
      };

      if (vCuts.length > 0) {
        let finalSplitBoxes = [];
        for (const box of processedBoxes) {
          let currentSegments = [box];
          for (const cutX of vCuts) {
            let nextSegments = [];
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

      if (hCuts.length > 0) {
        let finalSplitBoxes = [];
        for (const box of processedBoxes) {
          let currentSegments = [box];
          const boxCol = getColIdx(box);
          const relevantCuts = hCuts.filter(c => c.colIdx === boxCol);

          for (const cut of relevantCuts) {
            let nextSegments = [];
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

      // --- Extract Images using OffscreenCanvas ---
      const finalBlocks = [];
      
      for(let i=0; i<processedBoxes.length; i++) {
          const box = processedBoxes[i];
          let finalX = Math.max(0, box.x - config.padx);
          let finalY = Math.max(0, box.y - config.pady);
          let finalW = Math.min(src.cols - finalX, box.width + 2 * config.padx);
          let finalH = Math.min(src.rows - finalY, box.height + 2 * config.pady);

          let rect = new self.cv.Rect(finalX, finalY, finalW, finalH);
          let roi = src.roi(rect);
          
          // Создаем OffscreenCanvas для конкретного блока
          const offscreen = new OffscreenCanvas(finalW, finalH);
          self.cv.imshow(offscreen, roi); // Отрисовываем Mat на канвас
          
          // Конвертируем в Blob -> Base64
          const blob = await offscreen.convertToBlob({ type: 'image/png' });
          const dataUrl = await blobToDataURL(blob);

          finalBlocks.push({
            x: finalX, y: finalY, width: finalW, height: finalH,
            id: `line-${i}-${Math.random().toString(36).substr(2, 5)}`,
            dataUrl: dataUrl
          });
          
          roi.delete();
      }

      // Cleanup
      src.delete(); workSrc.delete(); gray.delete(); thresh.delete();
      labels.delete(); stats.delete(); centroids.delete(); kernel.delete();

      self.postMessage({ msg: 'segmentComplete', result: { symbols: rawBoxes, blocks: finalBlocks } });

    } catch (err) {
      console.error(err);
      self.postMessage({ msg: 'error', error: err.message });
    }
  }
};
