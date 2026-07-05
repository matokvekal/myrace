"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Point, Quad } from "./types";
import styles from "./imageCropper.module.css";

interface ImageCropperProps {
  imageUrl: string;
  imageWidth: number; // coordinate space of the returned quad
  imageHeight: number;
  initialQuad?: Quad | null;
  onConfirm: (quad: Quad) => void;
  onCancel: () => void;
}

type CornerKey = keyof Quad;
const CORNERS: CornerKey[] = ["tl", "tr", "br", "bl"];

function defaultQuad(w: number, h: number): Quad {
  const ix = w * 0.04;
  const iy = h * 0.04;
  return {
    tl: { x: ix, y: iy },
    tr: { x: w - ix, y: iy },
    br: { x: w - ix, y: h - iy },
    bl: { x: ix, y: h - iy },
  };
}

export default function ImageCropper({
  imageUrl,
  imageWidth,
  imageHeight,
  initialQuad,
  onConfirm,
  onCancel,
}: ImageCropperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [quad, setQuad] = useState<Quad>(() => initialQuad ?? defaultQuad(imageWidth, imageHeight));
  const activeCorner = useRef<CornerKey | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const maxW = container.clientWidth;
    const maxH = Math.max(240, window.innerHeight * 0.55);
    const scale = Math.min(maxW / imageWidth, maxH / imageHeight);
    setDisplaySize({ w: imageWidth * scale, h: imageHeight * scale });
  }, [imageWidth, imageHeight]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const scale = displaySize.w > 0 ? displaySize.w / imageWidth : 1;
  const toDisplay = (p: Point) => ({ x: p.x * scale, y: p.y * scale });

  const moveCorner = (e: React.PointerEvent<SVGSVGElement>) => {
    const corner = activeCorner.current;
    if (!corner) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(imageWidth, Math.max(0, (e.clientX - rect.left) / scale));
    const y = Math.min(imageHeight, Math.max(0, (e.clientY - rect.top) / scale));
    setQuad((prev) => ({ ...prev, [corner]: { x, y } }));
  };

  const points = CORNERS.map((c) => toDisplay(quad[c]));
  const polygon = points.map((p) => `${p.x},${p.y}`).join(" ");
  const maskPath =
    `M0 0 H${displaySize.w} V${displaySize.h} H0 Z ` +
    `M${points.map((p) => `${p.x} ${p.y}`).join(" L")} Z`;

  return (
    <div className={styles.cropper}>
      <p className={styles.hint}>Drag the corners to the edges of the start list</p>

      <div className={styles.stage} ref={containerRef}>
        {displaySize.w > 0 && (
          <div className={styles.frame} style={{ width: displaySize.w, height: displaySize.h }}>
            <img src={imageUrl} alt="" className={styles.image} draggable={false} />
            <svg
              className={styles.overlay}
              width={displaySize.w}
              height={displaySize.h}
              onPointerMove={moveCorner}
              onPointerUp={() => (activeCorner.current = null)}
              onPointerCancel={() => (activeCorner.current = null)}
            >
              <path d={maskPath} fillRule="evenodd" className={styles.mask} />
              <polygon points={polygon} className={styles.outline} />
              {CORNERS.map((corner) => {
                const p = toDisplay(quad[corner]);
                return (
                  <circle
                    key={corner}
                    cx={p.x}
                    cy={p.y}
                    r={14}
                    className={styles.handle}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      activeCorner.current = corner;
                      (e.currentTarget.closest("svg") as SVGSVGElement).setPointerCapture(e.pointerId);
                    }}
                  />
                );
              })}
            </svg>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.confirmBtn} onClick={() => onConfirm(quad)}>
          Apply Crop
        </button>
      </div>
    </div>
  );
}
