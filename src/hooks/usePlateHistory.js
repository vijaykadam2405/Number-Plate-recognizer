import { useCallback, useEffect, useState } from "react";
import { detectionConfidence, ocrConfidence, isDisplayablePlate } from "../domain/status.js";

const STORAGE_KEY = "anpr_plate_history";
const MAX_ENTRIES = 200;
const DEDUP_WINDOW_MS = 10_000; // 10 seconds

/**
 * Manages the persistent, deduplicated plate detection history.
 *
 * - Loads from localStorage on mount
 * - Deduplicates: same plate_number within 10 seconds is ignored
 * - Caps at 200 entries, most recent first
 * - Saves to localStorage on every change
 */
export default function usePlateHistory() {
  const [history, setHistory] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Persist to localStorage whenever history changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // localStorage full or unavailable — silently ignore
    }
  }, [history]);

  /**
   * Adds new plates to the history, applying deduplication.
   * @param {Array} plates - Array of plate objects from the backend
   */
  const addPlates = useCallback((plates) => {
    if (!Array.isArray(plates) || plates.length === 0) return;

    const now = Date.now();

    setHistory((prev) => {
      let updated = [...prev];

      for (const plate of plates) {
        if (!isDisplayablePlate(plate)) continue;
        const plateText = plate.plate_number || plate.registration_text || "";
        if (!plateText) continue;

        // Deduplication: check if this exact plate was seen in the last 10 seconds
        const isDuplicate = updated.some(
          (entry) =>
            entry.plateNumber === plateText &&
            now - entry.detectedAt < DEDUP_WINDOW_MS,
        );

        if (isDuplicate) continue;

        // Add new entry at the top
        updated.unshift({
          plateNumber: plateText,
          confidence: ocrConfidence(plate),
          ocrConfidence: ocrConfidence(plate),
          detectionConfidence: detectionConfidence(plate),
          status: plate.status || null,
          statusReason: plate.status_reason || plate.reason || null,
          detectedAt: now,
          bbox: plate.bbox || null,
        });
      }

      // Cap at MAX_ENTRIES
      if (updated.length > MAX_ENTRIES) {
        updated = updated.slice(0, MAX_ENTRIES);
      }

      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { history, addPlates, clearHistory };
}
