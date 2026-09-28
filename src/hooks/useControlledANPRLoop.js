import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeFrame } from "../api/client.js";
import { isDisplayablePlate } from "../domain/status.js";
import useLocalPlateDetector from "./useLocalPlateDetector.js";

export default function useControlledANPRLoop(videoRef, endpoint) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [detections, setDetections] = useState([]);
  const [frameCount, setFrameCount] = useState(0);
  const [lastLatency, setLastLatency] = useState(null);
  const [timing, setTiming] = useState(null);
  const [error, setError] = useState("");
  const [loopState, setLoopState] = useState("idle");
  const runRef = useRef(null);
  const inferenceBusyRef = useRef(false);
  
  // Stable Plate Tracking Refs
  const lastPlateTextRef = useRef(null);
  const consecutivePlateCountRef = useRef(0);
  const STABLE_PLATE_CONFIDENCE = 0.85;
  const STABLE_PLATE_COUNT = 2;
  const COOLDOWN_WAIT_MS = 4000;
  const SUCCESS_WAIT_MS = 1750;

  const { detectPlatePresence, isModelReady, modelError, localDetectorEnabled } = useLocalPlateDetector();
  const readyRef = useRef(isModelReady);
  useEffect(() => { readyRef.current = isModelReady; }, [isModelReady]);

  const stopLoop = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    if (run) {
      clearTimeout(run.timer);
      cancelAnimationFrame(run.raf);
      run.controller?.abort();
    }
    setIsAnalyzing(false);
    setDetections([]);
    setTiming(null);
    setLoopState("idle");
  }, []);

  const startLoop = useCallback(() => {
    if (runRef.current) return;
    const run = { canvas: document.createElement("canvas"), timer: null,
      raf: null, controller: null, mediaTime: -1, sequence: 0 };
    runRef.current = run;
    const active = () => runRef.current === run;
    const schedule = (delay = 0) => {
      if (!active()) return;
      run.timer = setTimeout(() => {
        if (active()) run.raf = requestAnimationFrame(checkFrame);
      }, delay);
    };
    async function checkFrame() {
      if (!active()) return;
      const video = videoRef.current;
      if (!readyRef.current || inferenceBusyRef.current ||
          !video || video.readyState < 2 || !video.videoWidth) {
        setLoopState("checking");
        schedule(80);
        return;
      }
      if (run.mediaTime === video.currentTime) { schedule(); return; }
      run.mediaTime = video.currentTime;
      const sample = { requestId: ++run.sequence,
        cameraFrameTimestamp: performance.now(), cameraMediaTime: video.currentTime,
        frameWidth: video.videoWidth, frameHeight: video.videoHeight };
      try {
        const canvas = run.canvas;
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
        // Preserve the full frame before async ONNX inference. A positive
        // result uploads these same pixels, never a newer frame or plate crop.
        canvas.getContext("2d").drawImage(video, 0, 0);
        sample.frameSnapshotTimestamp = performance.now();
        let present = true;
        if (localDetectorEnabled) {
          inferenceBusyRef.current = true;
          try { present = await detectPlatePresence(canvas); }
          finally { inferenceBusyRef.current = false; }
        }
        sample.onnxDetectionTimestamp = performance.now();
        if (!active()) return;
        if (!present) { setLoopState("watching"); schedule(); return; }
        sample.captureTimestamp = performance.now();
        const blobPromise = new Promise((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.92));
        setLoopState("sending");
        setIsAnalyzing(true);
        setError("");
        const blob = await blobPromise;
        if (!active()) return;
        if (!blob) throw new Error("The camera frame could not be encoded.");
        run.controller = new AbortController();
        sample.backendRequestTimestamp = performance.now();
        const responsePromise = analyzeFrame(blob, endpoint, run.controller.signal);
        setFrameCount((count) => count + 1);
        const response = await responsePromise;
        sample.backendResponseTimestamp = performance.now();
        if (!active()) return;
        run.controller = null;
        setLastLatency(Math.round(sample.backendResponseTimestamp - sample.backendRequestTimestamp));
        setTiming(sample);

        if (import.meta.env.DEV) {
          // Note: obbRenderTimestamp and Frontend render delay require tracking after React renders,
          // but we can log the latency up to this point.
          sample.obbRenderTimestamp = performance.now(); 
          console.debug("[ANPR submission]", {
            ...sample,
            "Detection delay": sample.onnxDetectionTimestamp - sample.cameraFrameTimestamp,
            "Capture delay": sample.captureTimestamp - sample.onnxDetectionTimestamp,
            "Request delay": sample.backendRequestTimestamp - sample.captureTimestamp,
            "Backend latency": sample.backendResponseTimestamp - sample.backendRequestTimestamp,
            "Frontend render delay": sample.obbRenderTimestamp - sample.backendResponseTimestamp,
            "Total latency": sample.obbRenderTimestamp - sample.cameraFrameTimestamp,
          });
        }
        const plates = response.plates || [];
        setDetections(plates.filter(isDisplayablePlate));
        setIsAnalyzing(false);

        // Stable plate cooldown logic
        let nextWaitTime = SUCCESS_WAIT_MS;
        if (plates.length > 0) {
          const topPlate = plates[0];
          const text = topPlate.plate_number || topPlate.registration_text || "";
          if (text && topPlate.confidence >= STABLE_PLATE_CONFIDENCE) {
            if (text === lastPlateTextRef.current) {
              consecutivePlateCountRef.current++;
              if (consecutivePlateCountRef.current >= STABLE_PLATE_COUNT) {
                nextWaitTime = COOLDOWN_WAIT_MS;
                consecutivePlateCountRef.current = 0; // reset
              }
            } else {
              lastPlateTextRef.current = text;
              consecutivePlateCountRef.current = 1;
            }
          } else {
            lastPlateTextRef.current = null;
            consecutivePlateCountRef.current = 0;
          }
        } else {
          lastPlateTextRef.current = null;
          consecutivePlateCountRef.current = 0;
        }

        if (nextWaitTime === COOLDOWN_WAIT_MS) {
          setLoopState("cooldown");
        } else {
          setLoopState("watching");
        }
        
        // Schedule next sample
        schedule(nextWaitTime);
      } catch (failure) {
        if (!active()) return;
        run.controller = null;
        setIsAnalyzing(false);
        setDetections([]);
        setLoopState("watching");
        setError(failure.message || "Frame analysis failed.");
        schedule(2750);
      }
    }
    setError("");
    setLoopState("watching");
    schedule();
  }, [videoRef, endpoint, detectPlatePresence, localDetectorEnabled]);

  useEffect(() => () => stopLoop(), [stopLoop]);
  return { startLoop, stopLoop, isAnalyzing, detections, frameCount, lastLatency,
    timing, detectionError: error, detectorError: modelError, loopState };
}
