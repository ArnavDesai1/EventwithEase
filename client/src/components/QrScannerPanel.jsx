import { useEffect, useId, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

/**
 * Live QR scanner for ticket codes (payload like EWE-XXXXXXXX).
 * Mount only while the camera should run. Uses a unique element id so React Strict Mode
 * remounts do not collide with html5-qrcode's internal state.
 */
export default function QrScannerPanel({ onScan, onCameraError }) {
  const onScanRef = useRef(onScan);
  const onCameraErrorRef = useRef(onCameraError);
  const readerId = `ewe-html5-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    onScanRef.current = onScan;
    onCameraErrorRef.current = onCameraError;
  });

  useEffect(() => {
    let cancelled = false;
    const host = document.getElementById(readerId);
    if (!host) {
      onCameraErrorRef.current?.("Scanner container not found. Try again.");
      return undefined;
    }

    const inst = new Html5Qrcode(readerId, { verbose: false });
    const qrbox = Math.min(260, typeof window !== "undefined" ? window.innerWidth - 48 : 260);

    inst
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: qrbox, height: qrbox } },
        (decodedText) => {
          const match = String(decodedText).match(/EWE-[A-F0-9]{8}/i);
          const code = match ? match[0].toUpperCase() : String(decodedText).trim();
          if (code) onScanRef.current?.(code);
        },
        () => {}
      )
      .catch((err) => {
        if (!cancelled) {
          onCameraErrorRef.current?.(err?.message || "Camera unavailable.");
        }
      });

    return () => {
      cancelled = true;
      inst
        .stop()
        .then(() => inst.clear())
        .catch(() => {});
    };
  }, [readerId]);

  return (
    <div
      id={readerId}
      className="qr-scanner-viewport"
      style={{
        width: "100%",
        minHeight: 280,
        marginTop: 12,
      }}
    />
  );
}
