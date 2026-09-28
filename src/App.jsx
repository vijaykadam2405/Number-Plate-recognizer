import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeFrame, DEFAULT_API_URL } from "./api/client.js";
import useCamera from "./hooks/useCamera.js";
import useControlledANPRLoop from "./hooks/useControlledANPRLoop.js";
import usePlateHistory from "./hooks/usePlateHistory.js";
import CameraFeed from "./components/CameraFeed.jsx";
import BoundingBoxOverlay from "./components/BoundingBoxOverlay.jsx";
import HistoryPanel from "./components/HistoryPanel.jsx";

export default function App() {
  const photoInputRef = useRef(null);
  const [isUploadAnalyzing, setIsUploadAnalyzing] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // ── Hooks ─────────────────────────────────────────────────────────

  const { videoRef, cameraState, startCamera, stopCamera, cameraError } =
    useCamera();

  const {
    startLoop,
    stopLoop,
    isAnalyzing,
    detections,
    timing,
    frameCount,
    lastLatency,
    detectionError,
    detectorError,
    loopState,
  } = useControlledANPRLoop(videoRef, DEFAULT_API_URL);

  const { history, addPlates, clearHistory } = usePlateHistory();

  // Feed detected plates into the history (with dedup)
  useEffect(() => {
    if (detections.length > 0) {
      addPlates(detections);
    }
  }, [detections, addPlates]);

  // ── Camera start/stop wiring ──────────────────────────────────────

  const handleStartCamera = useCallback(async () => {
    const started = await startCamera();
    if (started) startLoop();
  }, [startCamera, startLoop]);

  const handleStopCamera = useCallback(() => {
    stopLoop();
    stopCamera();
  }, [stopLoop, stopCamera]);

  // ── Photo upload (one-shot, bypasses detection loop) ──────────────

  const analyzePhoto = async (event) => {
    const photo = event.target.files?.[0];
    event.target.value = "";
    if (!photo) return;

    const controller = new AbortController();
    setIsUploadAnalyzing(true);
    setUploadError("");

    try {
      const response = await analyzeFrame(photo, DEFAULT_API_URL, controller.signal);
      const plates = response.plates || [];
      addPlates(plates);
    } catch (err) {
      if (err.name !== "AbortError") setUploadError(err.message);
    } finally {
      setIsUploadAnalyzing(false);
    }
  };

  // ── Status indicator ──────────────────────────────────────────────

  const getStatusInfo = () => {
    if (cameraError) return { label: "Camera error", tone: "error" };
    if (cameraState === "idle") return { label: "Camera off", tone: "off" };
    if (cameraState === "starting") return { label: "Connecting…", tone: "connecting" };

    // Camera is live — show loop state
    switch (loopState) {
      case "sending":
        return { label: "Sending frame…", tone: "active" };
      case "motion":
        return { label: "Motion detected", tone: "active" };
      case "cooldown":
        return { label: "Cooldown", tone: "cooldown" };
      case "checking":
        return { label: "Checking frame…", tone: "watching" };
      case "watching":
        return { label: "Waiting for next frame", tone: "watching" };
      case "idle":
      default:
        return { label: "No motion", tone: "idle" };
    }
  };

  const status = getStatusInfo();

  // ── Render ────────────────────────────────────────────────────────

  const combinedError = cameraError || detectionError || detectorError || uploadError;
  const combinedAnalyzing = isAnalyzing || isUploadAnalyzing;

  return (
    <div className="split-layout">
      {/* LEFT SIDE: CAMERA + BBOX OVERLAY */}
      <main className="camera-pane">
        <header className="app-header">
          <div className="brand">
            <div className="brand-logo">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="8" width="18" height="8" rx="2" ry="2"/>
                <circle cx="7" cy="12" r="1"/>
                <circle cx="17" cy="12" r="1"/>
              </svg>
            </div>
            <div>
              <p className="eyebrow">AUTOMATIC NUMBER PLATE RECOGNITION</p>
              <h1>Review Console</h1>
            </div>
          </div>

          {/* Status indicator */}
          <div className={`status-indicator status-${status.tone}`}>
            <span className="status-dot"></span>
            <span className="status-label">{status.label}</span>
          </div>
        </header>

        <CameraFeed
          videoRef={videoRef}
          cameraState={cameraState}
          isAnalyzing={combinedAnalyzing}
          onStartCamera={handleStartCamera}
          onStopCamera={handleStopCamera}
          onPhotoUpload={analyzePhoto}
          photoInputRef={photoInputRef}
        >
          <BoundingBoxOverlay
            detections={detections}
            timing={timing}
            videoRef={videoRef}
          />
        </CameraFeed>
      </main>

      {/* RIGHT SIDE: HISTORY PANEL */}
      <HistoryPanel
        history={history}
        clearHistory={clearHistory}
        frameCount={frameCount}
        lastLatency={lastLatency}
        error={combinedError}
      />
    </div>
  );
}
