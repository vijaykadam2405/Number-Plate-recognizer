import { useEffect, useMemo, useRef, useState } from "react";
import { formatConfidence, ocrConfidence } from "../domain/status.js";

const HOLD_LAST_DETECTION_MS = 900;

/**
 * Renders camera-space plate geometry in an SVG overlay.
 *
 * Local ONNX detections update independently from backend OCR. Explicit
 * frame-level backend polygons remain supported when the API provides them.
 */
export default function BoundingBoxOverlay({
  detections = [],
  subscribeLocalDetections,
  videoRef,
}) {
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [localDetections, setLocalDetections] = useState([]);
  const [heldDetections, setHeldDetections] = useState([]);
  const clearTimerRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const updateSize = () => {
      setDisplaySize({ width: video.clientWidth, height: video.clientHeight });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(video);
    updateSize();
    return () => observer.disconnect();
  }, [videoRef]);

  useEffect(() => {
    if (typeof subscribeLocalDetections === "function") {
      return subscribeLocalDetections(setLocalDetections);
    }
    return undefined;
  }, [subscribeLocalDetections]);

  const currentDetections = useMemo(() => {
    // rows[].polygon is crop-local in the current backend response. Only use
    // backend geometry directly when it is explicitly frame-level. Otherwise
    // use the browser detector's frame-level box and attach backend metadata.
    const backendFrameDetections = detections.filter(hasFrameGeometry);
    if (backendFrameDetections.length > 0) {
      return backendFrameDetections.map((geometry, index) => ({
        ...(detections[index] || {}),
        ...geometryOnly(geometry),
      }));
    }

    // Keep the live overlay independent from the delayed OCR response. The
    // current API has no frame-level plate bbox, so attaching its text to a
    // later moving ONNX box could label a different plate.
    return localDetections.map((localDetection) => ({
      ...localDetection,
      polygon: localDetection.polygon,
      bbox: localDetection.bbox,
      isLocal: true,
    }));
  }, [detections, localDetections]);

  useEffect(() => {
    if (currentDetections.length > 0) {
      setHeldDetections(currentDetections);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
      return undefined;
    }

    if (heldDetections.length > 0 && !clearTimerRef.current) {
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        setHeldDetections([]);
      }, HOLD_LAST_DETECTION_MS);
    }

    return undefined;
  }, [currentDetections, heldDetections.length]);

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  }, []);

  const video = videoRef.current;
  if (!video || displaySize.width === 0 || heldDetections.length === 0) {
    return null;
  }

  const nativeW = video.videoWidth || 1;
  const nativeH = video.videoHeight || 1;
  const scale = Math.max(
    displaySize.width / nativeW,
    displaySize.height / nativeH,
  );
  const offsetX = (displaySize.width - nativeW * scale) / 2;
  const offsetY = (displaySize.height - nativeH * scale) / 2;

  return (
    <svg
      className="bbox-overlay"
      viewBox={`0 0 ${displaySize.width} ${displaySize.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {heldDetections.map((plate, index) => {
        const points = getObbPoints(plate);
        if (!points) return null;

        const displayPoints = points.map(([x, y]) => [
          x * scale + offsetX,
          y * scale + offsetY,
        ]);
        const labelPoint = displayPoints.reduce(
          (topLeft, point) =>
            point[1] < topLeft[1] ? point : topLeft,
          displayPoints[0],
        );
        const plateText =
          plate.plate_number || plate.registration_text || plate.text || "";
        const confidence = formatConfidence(ocrConfidence(plate));
        const labelText = plateText ? `${plateText}  ${confidence}` : confidence;
        const labelWidth = Math.max(58, labelText.length * 7.2 + 16);
        const labelX = Math.max(0, labelPoint[0]);
        const labelY = Math.max(18, labelPoint[1] - 6);

        return (
          <g key={`obb-${index}`} className={plate.isLocal ? "bbox-group-local" : "bbox-group"}>
            <polygon
              className="bbox-shape"
              points={displayPoints.map((point) => point.join(",")).join(" ")}
            />
            {plateText && (
              <g className="bbox-label-svg" transform={`translate(${labelX} ${labelY})`}>
                <rect width={labelWidth} height="18" rx="3" />
                <text x="8" y="13">{labelText}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function hasFrameGeometry(plate) {
  return Boolean(
    plate?.polygon ||
      plate?.bbox ||
      plate?.bounds ||
      (Array.isArray(plate?.rows) &&
        plate.rows[0] &&
        (plate.rows[0].bbox || plate.rows[0].bounds) &&
        plate.rows[0].polygon &&
        plate?.plate_bbox),
  );
}

function geometryOnly(plate) {
  return {
    angle: plate.angle,
    angle_degrees: plate.angle_degrees,
    angle_radians: plate.angle_radians,
    bbox: plate.bbox,
    plate_bbox: plate.plate_bbox,
    bounds: plate.bounds,
    polygon: plate.polygon,
  };
}

function getObbPoints(plate) {
  const polygon = getPolygon(plate);
  if (polygon) return polygon;

  const box = getAxisAlignedBox(plate);
  if (!box) return null;

  const angleRadians = getAngleRadians(plate);
  if (angleRadians == null || angleRadians === 0) {
    return [
      [box.x, box.y],
      [box.x + box.w, box.y],
      [box.x + box.w, box.y + box.h],
      [box.x, box.y + box.h],
    ];
  }

  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);

  return [
    [-box.w / 2, -box.h / 2],
    [box.w / 2, -box.h / 2],
    [box.w / 2, box.h / 2],
    [-box.w / 2, box.h / 2],
  ].map(([x, y]) => [
    centerX + x * cos - y * sin,
    centerY + x * sin + y * cos,
  ]);
}

function getPolygon(plate) {
  const row = Array.isArray(plate?.rows) ? plate.rows[0] : null;
  const polygon = plate?.polygon || row?.polygon;
  if (!Array.isArray(polygon) || polygon.length < 4) return null;

  const points = polygon.map((point) => {
    if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
    return [Number(point?.x), Number(point?.y)];
  });
  if (!points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
    return null;
  }

  // A row polygon is relative to the plate crop when the backend also sends
  // a plate-level bbox. Translate it back into camera-frame coordinates.
  if (row?.polygon && !plate?.polygon) {
    const plateBox = getPlateBox(plate);
    if (!plateBox) return null;
    return isCropLocal(points, plateBox)
      ? projectCropPolygon(points, plateBox)
      : points;
  }

  return points;
}

function getAngleRadians(plate) {
  const row = Array.isArray(plate?.rows) ? plate.rows[0] : null;
  const radians = row?.angle_radians ?? plate?.angle_radians;
  if (Number.isFinite(Number(radians))) return Number(radians);

  const degrees =
    row?.angle_degrees ?? plate?.angle_degrees ?? row?.angle ?? plate?.angle;
  const numericDegrees = Number(degrees);
  return Number.isFinite(numericDegrees)
    ? (numericDegrees * Math.PI) / 180
    : null;
}

function getAxisAlignedBox(plate) {
  const plateBox = getPlateBox(plate);
  if (plateBox) return plateBox;

  const row = Array.isArray(plate?.rows) ? plate.rows[0] : null;
  const bounds = row?.bounds || plate?.bounds;
  if (Array.isArray(bounds) && bounds.length >= 4) {
    const [x1, y1, x2, y2] = bounds.map(Number);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
  }

  return null;
}

function getPlateBox(plate) {
  const bbox = plate?.bbox || plate?.plate_bbox;
  if (bbox && typeof bbox.x === "number") {
    return {
      x: bbox.x,
      y: bbox.y,
      w: bbox.width,
      h: bbox.height,
    };
  }

  if (Array.isArray(bbox) && bbox.length >= 4) {
    const [x1, y1, x2, y2] = bbox.map(Number);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
  }

  return null;
}

function isCropLocal(points, plateBox) {
  const maxX = Math.max(...points.map(([x]) => x));
  const maxY = Math.max(...points.map(([, y]) => y));
  return maxX <= plateBox.w * 1.1 && maxY <= plateBox.h * 1.1;
}

function projectCropPolygon(points, plateBox) {
  const minX = Math.min(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxX = Math.max(...points.map(([x]) => x));
  const maxY = Math.max(...points.map(([, y]) => y));
  const sourceWidth = Math.max(1, maxX - minX);
  const sourceHeight = Math.max(1, maxY - minY);

  return points.map(([x, y]) => [
    plateBox.x + ((x - minX) / sourceWidth) * plateBox.w,
    plateBox.y + ((y - minY) / sourceHeight) * plateBox.h,
  ]);
}
