import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

const READER_ID = "ewe-html5-qrcode-reader";

/**
 * Live QR scanner for ticket codes (expects payload like EWE-XXXXXXXX in the QR).
 * Keeps the reader div mounted while the parent panel is mounted so stop/cleanup stays reliable.
 */
export default function QrScannerPanel({ active, onScan, onCameraError }) {
  const instanceRef = useRef(null);

  useEffect(() => {
    if (!active) {
      const inst = instanceRef.current;
      instanceRef.current = null;
      if (inst) {
        inst
          .stop()
          .then(() => inst.clear())
          .catch(() => {});
      }
      return;
    }

    const html5 = new Html5Qrcode(READER_ID, { verbose: false });
    instanceRef.current = html5;

    const qrbox = Math.min(260, typeof window !== "undefined" ? window.innerWidth - 48 : 260);

    html5
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: qrbox, height: qrbox } },
        (decodedText) => {
          const match = String(decodedText).match(/EWE-[A-F0-9]{8}/i);
          const code = match ? match[0].toUpperCase() : String(decodedText).trim();
          if (code) onScan(code);
        },
        () => {}
      )
      .catch((err) => {
        onCameraError?.(err?.message || "Camera unavailable.");
        const inst = instanceRef.current;
        instanceRef.current = null;
        if (inst) {
          inst.stop().catch(() => {});
        }
      });

    return () => {
      const inst = instanceRef.current;
      instanceRef.current = null;
      if (inst) {
        inst
          .stop()
          .then(() => inst.clear())
          .catch(() => {});
      }
    };
  }, [active, onScan, onCameraError]);

  return (
    <div
      id={READER_ID}
      className="qr-scanner-viewport"
      style={{
        display: active ? "block" : "none",
        width: "100%",
        minHeight: active ? 280 : 0,
      }}
    />
  );
}
