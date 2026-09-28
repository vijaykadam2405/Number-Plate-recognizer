/**
 * ANPR API client.
 *
 * Sends images to the model server via the Vite dev proxy (/api/predict)
 * and normalizes the response so the rest of the app always sees data.plates.
 */

export const DEFAULT_API_URL = "/api/predict";

export class AnprApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnprApiError";
  }
}

/**
 * Sends an image blob to the ANPR model server.
 *
 * @param {Blob|File} imageBlob - JPEG frame or uploaded photo.
 * @param {string}    endpoint  - API URL (default: /api/predict).
 * @param {AbortSignal} signal  - Abort signal for cancellation.
 * @returns {Promise<Object>} Normalized response with a `plates` array.
 */
export async function analyzeFrame(imageBlob, endpoint, signal) {
  const formData = new FormData();
  formData.append("file", imageBlob, imageBlob.name || "camera-frame.jpg");

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: formData,
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new AnprApiError(
      "The model API could not be reached. Check that it is running and that CORS or the Vite proxy is configured.",
    );
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    throw new AnprApiError("The model API returned an invalid JSON response.");
  }

  if (!response.ok) {
    throw new AnprApiError(
      data.detail || data.message || data.error || "The model could not analyze this frame.",
    );
  }

  // The model server returns { results: [...] } but the frontend uses { plates: [...] }.
  // Normalize so the rest of the app always sees data.plates.
  if (!data.plates && Array.isArray(data.results)) {
    data.plates = data.results;
  }

  if (!Array.isArray(data.plates)) {
    throw new AnprApiError("The model response must contain a plates or results array.");
  }

  data.plates = data.plates.map(normalizePlate);
  return data;
}

function normalizePlate(plate) {
  if (!plate || typeof plate !== "object") return plate;

  // Keep the backend object intact, while exposing stable aliases for the UI.
  return {
    ...plate,
    plate_number:
      plate.plate_number ||
      plate.registration_text ||
      plate.full_text ||
      plate.text ||
      plate.normalized_text ||
      plate.final_result ||
      plate.raw_ocr_text ||
      "",
    ocr_confidence: firstNumeric(
      plate.ocr_confidence,
      plate.confidence_ocr,
      plate.ocrConfidence,
    ),
    detection_confidence: firstNumeric(
      plate.detection_confidence,
      plate.confidence_detection,
      plate.detectionConfidence,
    ),
  };
}

function firstNumeric(...values) {
  for (const value of values) {
    const numericValue =
      typeof value === "number" ? value : Number.parseFloat(value);
    if (Number.isFinite(numericValue)) return numericValue;
  }
  return null;
}
