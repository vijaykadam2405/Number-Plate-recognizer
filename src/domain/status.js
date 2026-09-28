/**
 * Status metadata and formatting utilities for plate results.
 *
 * Single source of truth — no component should hardcode status strings.
 * Unknown statuses fall back to amber / "Needs review" instead of crashing,
 * because the backend's status vocabulary can grow.
 */

const STATUS_META = {
  ACCEPTED: { label: "Auto-accepted", tone: "success" },
  REVIEW_REQUIRED: { label: "Needs review", tone: "warning" },
  LOW_CONFIDENCE: { label: "Low confidence", tone: "warning" },
  PARTIAL_VISIBLE: { label: "Partially visible", tone: "warning" },
  REJECTED: { label: "Unreadable", tone: "neutral" },
};

/**
 * Returns { label, tone } for a given status string.
 * Falls back to warning/amber for any unknown status.
 */
export function statusMeta(status) {
  return STATUS_META[status] || { label: status || "Needs review", tone: "warning" };
}

/**
 * Formats a 0–1 confidence value as a percentage string.
 * Returns "—" for null/undefined — never coerces to "0%".
 */
export function formatConfidence(value) {
  const numericValue =
    typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(numericValue)
    ? `${(numericValue * 100).toFixed(1)}%`
    : "—";
}

function firstNumeric(...values) {
  for (const value of values) {
    const numericValue =
      typeof value === "number" ? value : Number.parseFloat(value);
    if (Number.isFinite(numericValue)) return numericValue;
  }
  return null;
}

/**
 * Returns the backend OCR confidence, with compatibility for current and
 * older response field names. The generic `confidence` is the final fallback.
 */
export function ocrConfidence(plate) {
  const row = Array.isArray(plate?.rows) ? plate.rows[0] : null;
  return firstNumeric(
    plate?.ocr_confidence,
    plate?.confidence_ocr,
    plate?.ocrConfidence,
    plate?.confidence,
    row?.confidence_ocr,
    row?.ocr_confidence,
  );
}

export function isDisplayablePlate(plate) {
  if (!plate || typeof plate !== "object") return false;
  const text = plate.plate_number || plate.registration_text || "";
  return typeof text === "string" && text.trim().length > 0 &&
    !["REJECTED", "UNREADABLE", "INVALID_FORMAT"].includes(plate.status) &&
    !["PLATE_UNREADABLE", "NO_PLATE_DETECTED"].includes(text);
}

/**
 * Returns detector confidence when the backend exposes it explicitly.
 */
export function detectionConfidence(plate) {
  return firstNumeric(
    plate?.detection_confidence,
    plate?.confidence_detection,
    plate?.detectionConfidence,
  );
}
