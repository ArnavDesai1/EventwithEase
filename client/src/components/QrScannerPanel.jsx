import { useEffect, useId, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

function readHostWidth(host) {
  const rect = host.getBoundingClientRect?.();
  const w = rect?.width || host.clientWidth || 0;
  if (w > 0) return w;
  return Math.min(typeof window !== "undefined" ? window.innerWidth - 32 : 300, 400);
}

/** html5-qrcode sets video width from parent.clientWidth at init — if that is 0 (common on mobile before paint), the feed stays black. */
function patchScannerVideo(host) {
  const v = host.querySelector("video");
  if (!v) return;
  v.muted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "true");
  v.setAttribute("webkit-playsinline", "true");
  v.style.width = "100%";
  v.style.maxWidth = "100%";
  v.style.height = "auto";
  v.style.minHeight = "200px";
  v.style.objectFit = "cover";
}

function scheduleVideoPatches(host) {
  const delays = [0, 50, 150, 400, 800];
  const timers = delays.map((ms) => window.setTimeout(() => patchScannerVideo(host), ms));
  return () => timers.forEach((id) => clearTimeout(id));
}

async function resolveCameraConfig() {
  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras?.length) {
      return { facingMode: "environment" };
    }
    const back = cameras.find((c) => /back|rear|environment|wide|world/i.test(c.label));
    return back?.id || cameras[0].id;
  } catch {
    return { facingMode: "environment" };
  }
}

function waitNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

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
    let inst;
    let cancelPatches = () => {};

    async function run() {
      await waitNextPaint();
      if (cancelled) return;

      const host = document.getElementById(readerId);
      if (!host) {
        onCameraErrorRef.current?.("Scanner container not found. Try again.");
        return;
      }

      void host.offsetWidth;
      let hostWidth = readHostWidth(host);
      if (hostWidth < 200) {
        await waitNextPaint();
        hostWidth = Math.max(readHostWidth(host), Math.min(window.innerWidth - 32, 400), 200);
      }

      const cameraConfig = await resolveCameraConfig();
      const qrbox = Math.min(260, Math.max(hostWidth - 32, 160));

      const scanConfig = {
        fps: 10,
        qrbox: { width: qrbox, height: qrbox },
        aspectRatio: 1.777778,
      };

      const onDecoded = (decodedText) => {
        const match = String(decodedText).match(/EWE-[A-F0-9]{8}/i);
        const code = match ? match[0].toUpperCase() : String(decodedText).trim();
        if (code) onScanRef.current?.(code);
      };

      const tryStart = async (cam) => {
        const i = new Html5Qrcode(readerId, { verbose: false });
        inst = i;
        await i.start(cam, scanConfig, onDecoded, () => {});
      };

      async function cleanupFailedInstance() {
        if (!inst) return;
        try {
          await inst.stop();
        } catch {
          /* not scanning yet */
        }
        try {
          inst.clear();
        } catch {
          /* ignore */
        }
        inst = undefined;
      }

      try {
        await tryStart(cameraConfig);
      } catch (firstErr) {
        if (cancelled) return;
        await cleanupFailedInstance();
        if (typeof cameraConfig === "string") {
          try {
            await tryStart({ facingMode: "environment" });
          } catch (secondErr) {
            await cleanupFailedInstance();
            onCameraErrorRef.current?.(secondErr?.message || firstErr?.message || "Camera unavailable.");
            return;
          }
        } else {
          onCameraErrorRef.current?.(firstErr?.message || "Camera unavailable.");
          return;
        }
      }

      if (cancelled) {
        try {
          await inst.stop();
          inst.clear();
        } catch {
          /* ignore */
        }
        return;
      }

      cancelPatches = scheduleVideoPatches(host);
    }

    run().catch((err) => {
      if (!cancelled) onCameraErrorRef.current?.(err?.message || "Camera unavailable.");
    });

    return () => {
      cancelled = true;
      cancelPatches();
      if (!inst) return;
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
        minWidth: 200,
        minHeight: 280,
        marginTop: 12,
        boxSizing: "border-box",
      }}
    />
  );
}
