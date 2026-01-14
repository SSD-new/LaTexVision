
/**
 * Converts a single image to LaTeX by calling the server API.
 * Includes retry logic for 429 Rate Limit errors.
 * Supports switching to a custom local server URL.
 */

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const convertImageToLatex = async (
  base64Data: string,
  mimeType: string,
  retries = 3,
  customServerUrl?: string,
  timeoutMs?: number,
  signal?: AbortSignal
): Promise<string> => {
  // If custom URL is provided, use it. Otherwise use the Vercel serverless function.
  const endpoint = customServerUrl ? `${customServerUrl}/api/convert` : '/api/convert';
  
  const controller = new AbortController();
  
  // Link the passed signal to this internal controller
  if (signal) {
    if (signal.aborted) {
        controller.abort();
    } else {
        signal.addEventListener('abort', () => controller.abort());
    }
  }
  
  // Local models might take longer. Use provided timeout, or default to 300s (5min) for local, 60s for cloud
  const timeoutDuration = timeoutMs || (customServerUrl ? 300000 : 60000);
  const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        base64Data,
        mimeType
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      // Обработка 429 (Too Many Requests) - актуально только для облака
      if (!customServerUrl && response.status === 429 && retries > 0) {
        // Don't retry if aborted
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        console.warn(`Rate limit hit. Retrying... Attempts left: ${retries}`);
        await wait(20000 + Math.random() * 2000); 
        return convertImageToLatex(base64Data, mimeType, retries - 1, customServerUrl, timeoutMs, signal);
      }

      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    const data = await response.json();
    return data.text;

  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
       // If it was the timeout controller that aborted, and not the user signal
       if (!signal?.aborted && controller.signal.aborted) {
           console.error("Conversion timed out");
           throw new Error(`Превышено время ожидания (${timeoutDuration/1000}с).`);
       }
       // Otherwise it was a user cancel
       throw error;
    }

    console.error("Conversion Service Error:", error);
    
    // Friendly error for local connection failures
    if (customServerUrl && error.message.includes('Failed to fetch')) {
        throw new Error("Не удалось соединиться с локальным сервером. Проверьте IP и запущен ли сервер.");
    }

    throw new Error(error.message || "Ошибка соединения с сервером");
  }
};

export const refactorLatex = async (
  text: string,
  prompt?: string,
  customServerUrl?: string,
  timeoutMs?: number,
  signal?: AbortSignal
): Promise<string> => {
  const endpoint = customServerUrl ? `${customServerUrl}/api/refactor` : '/api/refactor';
  
  const controller = new AbortController();

  if (signal) {
    if (signal.aborted) {
        controller.abort();
    } else {
        signal.addEventListener('abort', () => controller.abort());
    }
  }

  const timeoutDuration = timeoutMs || (customServerUrl ? 300000 : 60000);
  const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, prompt }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    const data = await response.json();
    return data.text;

  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
       if (!signal?.aborted && controller.signal.aborted) {
          throw new Error(`Превышено время ожидания (${timeoutDuration/1000}с).`);
       }
       throw error;
    }

    console.error("Refactor Service Error:", error);
    
    if (customServerUrl && error.message.includes('Failed to fetch')) {
        throw new Error("Не удалось соединиться с локальным сервером. Проверьте настройки.");
    }

    throw new Error(error.message || "Ошибка соединения с сервером");
  }
};
