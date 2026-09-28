# ANPR — Automatic Number Plate Recognition

Indian vehicle number plate recognition system with a Python ML pipeline (backend)
and a React review console (frontend).

## Quick start

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`. Upload a photo or start the live camera.

## Change the model server IP

Copy `.env.example` to `.env` at the root of the project:

```env
MODEL_SERVER=http://127.0.0.1:8000
VITE_ENABLE_LOCAL_DETECTOR=true
VITE_PLATE_DETECTOR_URL=/models/plate-detector.onnx
VITE_PLATE_DETECTOR_THRESHOLD=0.30
```

Change the IP and restart the dev server (`npm run dev`). That's it.

## Architecture

```text
  Browser (React)                        Vite Proxy                  Python Model
┌──────────────────────┐                                       ┌───────────────────────┐
│ Upload photo or      │  /api/predict   ┌──────────────┐      │ FastAPI server        │
│ camera JPEG frame    │ ──────────────► │ strips /api   │ ───► │ POST /predict         │
│                      │                 │ forwards to   │      │ YOLO → PARSeq → result│
│ Renders live boxes   │ ◄────────────── │ MODEL_SERVER  │ ◄─── │ { results: [...] }    │
│ and detection log    │
└──────────────────────┘  { plates }     └──────────────┘      └───────────────────────┘
```

## Request pipeline

```text
.env                    → local backend and detector settings
vite.config.js          → reads MODEL_SERVER, sets proxy target
Browser                 → calls /api/predict
Vite proxy              → strips /api, forwards to MODEL_SERVER/predict
Model server            → returns { "results": [...] }
src/api/client.js       → normalizes "results" → "plates"
src/hooks/useLocalPlateDetector.js → gates camera frames with ONNX
src/App.jsx             → coordinates camera, loop, overlay, and history
src/components/BoundingBoxOverlay.jsx → renders scaled OBB polygons and fallback boxes
src/components/HistoryPanel.jsx → displays registration, confidence, status, and time
src/domain/status.js    → provides label + tone for the status badge
```

## File structure

```text
Number Plate recognizer/
├── README.md                   This file
├── checksums.md5               MD5 manifest for source and deployment files
├── requirements.txt            Backend Python dependencies
├── .env.example                Environment variable template
├── index.html                  Entry point HTML
├── package.json                Dependencies (React 19, Vite 8)
├── vite.config.js              Dev proxy → reads MODEL_SERVER from .env
└── src/
    ├── main.jsx                React entry point
    ├── App.jsx                 Main layout, camera logic, photo upload
    ├── styles.css              All styles (vanilla CSS)
    ├── api/
    │   └── client.js           Fetch wrapper + response normalization
    ├── domain/
    │   └── status.js           Status metadata, confidence formatting
    ├── hooks/
    │   ├── useCamera.js         Camera lifecycle
    │   ├── useControlledANPRLoop.js
    │   ├── useLocalPlateDetector.js
    │   └── usePlateHistory.js
    └── components/
        ├── CameraFeed.jsx       Live preview and controls
        ├── BoundingBoxOverlay.jsx
        └── HistoryPanel.jsx     Persistent detection log
└── public/
    └── models/
        ├── plate-detector.onnx  Browser-side plate detector
        └── README.md            Model contract and setup
```

## Model server response

The model server returns `{ "results": [...] }`. The frontend normalizes this
to `{ "plates": [...] }` in `src/api/client.js`.

Each plate object contains:

| Field               | Type      | Description                                   |
|---------------------|-----------|-----------------------------------------------|
| `plate_number`      | string    | Recognized registration text                  |
| `registration_text` | string    | Same as `plate_number`                        |
| `header_text`       | string    | Independent header text (e.g. state name)     |
| `full_text`         | string    | Combined reading-order text                   |
| `confidence`        | number    | Backend final confidence (0–1), can be null   |
| `rows[].confidence_ocr` | number | OCR confidence (0–1), can be null        |
| `rows[].confidence` | number    | Crop-local text-row detector confidence (0–1) |
| `status`            | string    | One of the five statuses below                |
| `header_status`     | string    | `REVIEW_REQUIRED` or `NONE_OR_UNREADABLE`     |
| `rows`              | array     | Per-row details including `bounds` and polygons |

## Status values

| Status            | UI Label           | Tone    | Meaning                        |
|-------------------|--------------------|---------|--------------------------------|
| `ACCEPTED`        | Auto-accepted      | Green   | Pipeline auto-accepted (≠ verified) |
| `REVIEW_REQUIRED` | Needs review       | Amber   | Human review needed            |
| `LOW_CONFIDENCE`  | Low confidence     | Amber   | OCR confidence below threshold |
| `PARTIAL_VISIBLE` | Partially visible  | Amber   | Only part of plate is readable |
| `REJECTED`        | Unreadable         | Neutral | Cannot be read                 |

## Key rules

- **`ACCEPTED` ≠ verified** — it means the pipeline auto-accepted the result
- **Header text is independent** — it never modifies registration confidence or status
- **Recognized text is rendered verbatim** — no uppercase, no trimming, no transliteration
- **`plates: []` is normal** — no detections is a success with zero results, not an error
- **`confidence: null` → "—"** — never display as 0%
- **OCR and detector confidence are separate** — the current API exposes OCR confidence but does not expose whole-plate detector confidence; crop-local row confidence is not presented as plate detection confidence

## Checksum scope

`checksums.md5` covers source, configuration, documentation, dependencies, and
the browser ONNX model. It intentionally excludes `.env`, `node_modules/`,
`dist/`, and `.vercel/` because those are local secrets, installed packages, or
generated/deployment metadata.

## Live-camera request behavior

The camera preview remains continuous, but inference requests are controlled:

- Only one backend request can be active at a time.
- ONNX checks plate presence before any JPEG capture or backend request.
- A positive ONNX result starts the full-frame capture before the bounding-box overlay is notified.
- A positive presence result captures the newest full-resolution frame and sends it unchanged; the frontend does not crop or rectify it.
- Intermediate frames are skipped while the single backend request is active.
- Successful requests wait 250 ms before capturing the newest available frame.
- Failed requests use a 2.75-second retry backoff.
- Repeated high-confidence readings trigger a short 750 ms cooldown.
- Stopping the camera cancels timers, aborts the active request, and invalidates older loop work.
- The local detector uses ONNX Runtime in the browser and does not use a fake brightness or edge heuristic.
- Video frames go directly into a reusable ONNX preprocessing canvas; no JPEG or `ImageBitmap` conversion is used for local tracking.
- The browser runs one standard ONNX view at the contract threshold (`0.30`); it does not wait for box stabilization or corrective rotation passes.
- Backend `rows[].polygon` and row angles are crop-local metadata and are never used to position or rotate the camera overlay.
- The frame-level ONNX result supplies the live camera position; an explicit future backend frame-level bbox/polygon can replace it.
- Backend OCR text remains in the detection log instead of being attached to a later moving local box.
- When only `angle` plus rectangular bounds are returned, the frontend derives a rotated quad and supports both radians and degrees.
- The SVG overlay updates independently from history/OCR presentation and briefly holds the latest valid geometry across a missed frame.
- The first backend OCR response is displayed immediately because the backend already performs reconciliation, validation, and status assignment.
- Development builds log separate capture, local-detection, and backend-request timings in the browser console.
- Photo uploads continue to call the API immediately and do not use the live-camera schedule.

The live camera now waits for the ONNX plate-presence model before sending
camera frames. Place the model at `public/models/plate-detector.onnx`, or set
`VITE_PLATE_DETECTOR_URL` to its public URL. If the model is unavailable, the
preview remains live and camera inference is paused instead of sending every
frame blindly.
