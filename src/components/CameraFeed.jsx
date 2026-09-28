/**
 * CameraFeed — renders the live video stream with placeholder,
 * LIVE badge, analyzing indicator, and floating control buttons.
 */
export default function CameraFeed({
  videoRef,
  cameraState,
  isAnalyzing,
  onStartCamera,
  onStopCamera,
  onPhotoUpload,
  photoInputRef,
  children, // BoundingBoxOverlay is passed as a child
}) {
  return (
    <div className="video-container">
      <div className="video-viewport">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className={cameraState === "live" ? "is-live" : ""}
        />

        {/* Bounding box overlay is rendered on top of the video */}
        {children}

        {cameraState !== "live" && (
          <div className="video-placeholder">
            <div className="placeholder-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
            <h3>Camera is resting</h3>
            <p>Start a live check or upload a photo to begin detection.</p>
          </div>
        )}

        {isAnalyzing && (
          <div className="analyzing-pill">
            <span className="spinner"></span>
            Analyzing frame…
          </div>
        )}

        {cameraState === "live" && (
          <div className="live-badge">
            <span className="pulse"></span> LIVE
          </div>
        )}
      </div>

      {/* Floating Controls */}
      <div className="floating-controls">
        {cameraState === "live" ? (
          <button className="btn-danger" onClick={onStopCamera}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            </svg>
            Stop Camera
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={onStartCamera}
            disabled={cameraState === "starting"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            {cameraState === "starting" ? "Starting…" : "Start Camera"}
          </button>
        )}

        <div className="divider"></div>

        <input
          ref={photoInputRef}
          className="hidden-input"
          type="file"
          accept="image/*,.bmp,.tif,.tiff,.webp"
          onChange={onPhotoUpload}
        />
        <button
          className="btn-secondary"
          onClick={() => photoInputRef.current?.click()}
          disabled={cameraState !== "idle" || isAnalyzing}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Upload Photo
        </button>
      </div>
    </div>
  );
}
