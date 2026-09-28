import * as ort from "onnxruntime-web";
import { useCallback, useEffect, useRef, useState } from "react";

const MODEL_URL =
  import.meta.env.VITE_PLATE_DETECTOR_URL || "/models/plate-detector.onnx";
const LOCAL_DETECTOR_ENABLED = import.meta.env.VITE_ENABLE_LOCAL_DETECTOR === "true";
const MODEL_INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = Number(
  import.meta.env.VITE_PLATE_DETECTOR_THRESHOLD || 0.30,
);
const RETRY_DELAY_MS = 100;

/**
 * Runs the browser-side plate detector. It only answers whether plates are
 * present and returns their boxes; OCR remains the backend's responsibility.
 */
export default function useLocalPlateDetector() {
  const sessionRef = useRef(null);
  const preprocessingCanvasRef = useRef(null);
  const inputBufferRef = useRef(
    new Float32Array(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE),
  );
  const [isModelReady, setIsModelReady] = useState(!LOCAL_DETECTOR_ENABLED);
  const [modelError, setModelError] = useState("");

  useEffect(() => {
    if (!LOCAL_DETECTOR_ENABLED) return undefined;

    let disposed = false;
    ort.env.wasm.numThreads = 1;

    ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
    })
      .then((session) => {
        if (disposed) return;
        sessionRef.current = session;
        setIsModelReady(true);
        setModelError("");
      })
      .catch((error) => {
        if (disposed) return;
        setModelError(
          `Local plate detector could not be loaded from ${MODEL_URL}.`,
        );
        console.error("ONNX plate detector failed to load:", error);
      });

    return () => {
      disposed = true;
      sessionRef.current = null;
    };
  }, []);

  const detectPlatePresence = useCallback(async (frame) => {
    const session = sessionRef.current;
    if (!session) return false;
    if (!preprocessingCanvasRef.current) {
      preprocessingCanvasRef.current = document.createElement("canvas");
      preprocessingCanvasRef.current.width = MODEL_INPUT_SIZE;
      preprocessingCanvasRef.current.height = MODEL_INPUT_SIZE;
    }
    try {
      return await runDetector(session, session.inputNames[0],
        preprocessingCanvasRef.current.getContext("2d", { willReadFrequently: true }),
        frame, inputBufferRef.current);
    } catch (error) {
      setModelError("Local plate presence detection failed.");
      throw error;
    }
  }, []);
  return { detectPlatePresence, isModelReady, modelError,
    localDetectorEnabled: LOCAL_DETECTOR_ENABLED };
}

async function runDetector(
  session,
  inputName,
  context,
  image,
  input,
) {
  drawLetterboxedFrame(context, image);
  const pixels = context.getImageData(
    0,
    0,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  ).data;
  const planeSize = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

  for (let index = 0; index < planeSize; index += 1) {
    input[index] = pixels[index * 4] / 255;
    input[planeSize + index] = pixels[index * 4 + 1] / 255;
    input[planeSize * 2 + index] = pixels[index * 4 + 2] / 255;
  }

  const tensor = new ort.Tensor("float32", input, [
    1,
    3,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  ]);
  try {
    const output = await session.run({ [inputName]: tensor });
    try { return hasPlate(firstTensor(output)); }
    finally { Object.values(output).forEach((value) => value.dispose?.()); }
  } finally { tensor.dispose(); }
}

function drawLetterboxedFrame(context, image) {
  const sourceWidth = image.videoWidth || image.naturalWidth || image.width;
  const sourceHeight = image.videoHeight || image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("The detector received an empty video frame.");
  }
  const scale = Math.min(
    MODEL_INPUT_SIZE / sourceWidth,
    MODEL_INPUT_SIZE / sourceHeight,
  );
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const paddingX = (MODEL_INPUT_SIZE - renderedWidth) / 2;
  const paddingY = (MODEL_INPUT_SIZE - renderedHeight) / 2;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "rgb(114, 114, 114)";
  context.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  context.drawImage(
    image,
    0,
    0,
    sourceWidth,
    sourceHeight,
    paddingX,
    paddingY,
    renderedWidth,
    renderedHeight,
  );

  return { scale, paddingX, paddingY, sourceWidth, sourceHeight };
}

function firstTensor(output) {
  const tensor = Object.values(output).find((value) => value?.data && value?.dims);
  if (!tensor) throw new Error("The ONNX model returned no tensor output.");
  return tensor;
}

function hasPlate({ data, dims }) {
  if (dims.length !== 3 || dims[0] !== 1 || dims[2] !== 6) {
    throw new Error("Expected ONNX detections shaped [1, N, 6].");
  }
  // Presence is enough. No bbox mapping, rotation, tracking or confirmation.
  for (let offset = 0; offset < dims[1] * 6; offset += 6) {
    if (data[offset + 5] === 0 && Number.isFinite(data[offset + 4]) &&
        data[offset + 4] >= CONFIDENCE_THRESHOLD) return true;
  }
  return false;
}
