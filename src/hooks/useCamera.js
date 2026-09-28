import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Custom hook that owns the camera lifecycle.
 *
 * Requests getUserMedia with rear-facing camera preference,
 * exposes start/stop controls, and tears down the stream on unmount.
 */
export default function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraState, setCameraState] = useState("idle"); // idle | starting | live
  const [error, setError] = useState("");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState("idle");
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support camera access.");
      return false;
    }

    setError("");
    setCameraState("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraState("live");
      return true;
    } catch (cameraError) {
      stopCamera();
      setCameraState("idle");
      setError(
        cameraError.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access and try again."
          : "The camera could not be started. Check that another app is not using it.",
      );
      return false;
    }
  }, [stopCamera]);

  // Tear down on unmount
  useEffect(() => () => stopCamera(), [stopCamera]);

  return { videoRef, cameraState, startCamera, stopCamera, cameraError: error };
}
