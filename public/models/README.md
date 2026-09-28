# Local plate detector model

The exported ONNX plate-presence model is stored in this directory as:

```text
plate-detector.onnx
```

The frontend loads `/models/plate-detector.onnx` by default. Override it with:

```env
VITE_PLATE_DETECTOR_URL=/models/another-detector.onnx
VITE_PLATE_DETECTOR_THRESHOLD=0.30
```

The project model contract is fixed: it accepts a float32 RGB tensor shaped
`[1, 3, 640, 640]` and returns `[1, 300, 6]` rows shaped
`[x1, y1, x2, y2, confidence, class_id]`. Coordinates are relative to the
640x640 letterboxed input. Class `0` is `license_plate`; confidence `0.30`
is the model contract threshold and the live frontend default. The frontend
removes letterbox padding before exposing the local box to the camera overlay.

The detector runs one standard view per check. It does not wait for box
stabilization or run corrective rotations: any qualifying detection triggers
a fresh full-frame backend request immediately.

Until the model is present and loaded, the camera preview remains live but no
camera frames are sent to the backend. Photo uploads remain independent and
continue to call the backend immediately.
