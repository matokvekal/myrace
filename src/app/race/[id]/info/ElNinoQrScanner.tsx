import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import jsQR from "jsqr";
import styles from "./info.module.css";
import { parseElNinoEventId } from "@/utils/elNino";

const SCAN_EVERY_MS = 200;
const SCAN_WIDTH = 640;

/** Camera view that reads QR codes until it finds an El Niño event. */
const ElNinoQrScanner: React.FC<{ onScan: (eventId: string) => void; onClose: () => void }> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState(false);
  const [wrongCode, setWrongCode] = useState(false);
  // The effect must not restart the camera when the parent re-renders.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const scan = () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && context && video.videoWidth > 0) {
        canvas.width = Math.min(SCAN_WIDTH, video.videoWidth);
        canvas.height = Math.round((video.videoHeight * canvas.width) / video.videoWidth);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const code = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (code?.data) {
          const id = parseElNinoEventId(code.data);
          if (id) {
            onScanRef.current(id);
            return;
          }
          setWrongCode(true);
        }
      }
      timer = setTimeout(scan, SCAN_EVERY_MS);
    };

    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = media;
        if (videoRef.current) {
          videoRef.current.srcObject = media;
          await videoRef.current.play();
        }
        scan();
      } catch {
        if (!stopped) setCameraError(true);
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className={styles.qrOverlay} onClick={onClose}>
      <div
        className={styles.qrModal}
        role="dialog"
        aria-modal="true"
        aria-label="Scan El Niño event QR"
        onClick={(e) => e.stopPropagation()}
        data-testid="el-nino-scanner"
      >
        <div className={styles.qrHead}>
          <span>Scan event QR</span>
          <button type="button" className={styles.rulesBtn} aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {cameraError ? (
          <p className={styles.rulesError} role="alert">Can’t open the camera. Allow camera access, or type the event ID.</p>
        ) : (
          <>
            <video ref={videoRef} className={styles.qrVideo} playsInline muted />
            {wrongCode && <p className={styles.rulesError} role="status">This QR is not an El Niño event.</p>}
          </>
        )}
      </div>
    </div>
  );
};

export default ElNinoQrScanner;
