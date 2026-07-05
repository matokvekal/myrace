/**
 * Pure-TS perspective correction (no opencv.js).
 *
 * Given the 4 document corners the user marked, warps the quad into an
 * upright rectangle via a homography: destination pixels are inverse-mapped
 * into the source image and bilinearly sampled.
 */

import type { Point, Quad } from './types';

const MAX_OUTPUT_EDGE = 2500; // keep canvases small for mobile / iOS Safari

function distance(a: Point, b: Point): number {
   return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Solves A·x = b (n×n) with Gaussian elimination and partial pivoting.
 * Mutates its inputs; returns x.
 */
function solveLinearSystem(a: number[][], b: number[]): number[] {
   const n = b.length;
   for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
         if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      }
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
      const div = a[col][col];
      if (Math.abs(div) < 1e-12) throw new Error('Degenerate quad');
      for (let row = col + 1; row < n; row++) {
         const factor = a[row][col] / div;
         for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k];
         b[row] -= factor * b[col];
      }
   }
   const x = new Array<number>(n);
   for (let row = n - 1; row >= 0; row--) {
      let sum = b[row];
      for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
      x[row] = sum / a[row][row];
   }
   return x;
}

/**
 * Homography h (row-major, h[8]=1) mapping destination rect corners
 * (0,0),(w,0),(w,h),(0,h) onto the source quad tl,tr,br,bl.
 */
export function computeHomography(quad: Quad, dstW: number, dstH: number): number[] {
   const src: Point[] = [
      { x: 0, y: 0 },
      { x: dstW, y: 0 },
      { x: dstW, y: dstH },
      { x: 0, y: dstH },
   ];
   const dst: Point[] = [quad.tl, quad.tr, quad.br, quad.bl];

   const a: number[][] = [];
   const b: number[] = [];
   for (let i = 0; i < 4; i++) {
      const { x, y } = src[i];
      const { x: u, y: v } = dst[i];
      a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
      b.push(u);
      a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
      b.push(v);
   }
   return [...solveLinearSystem(a, b), 1];
}

/** Warps the quad region of the source image into an upright rectangle. */
export function warpPerspective(
   source: HTMLCanvasElement,
   quad: Quad
): HTMLCanvasElement {
   const rawW = Math.max(distance(quad.tl, quad.tr), distance(quad.bl, quad.br));
   const rawH = Math.max(distance(quad.tl, quad.bl), distance(quad.tr, quad.br));
   const scale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(rawW, rawH));
   const dstW = Math.max(1, Math.round(rawW * scale));
   const dstH = Math.max(1, Math.round(rawH * scale));

   const h = computeHomography(quad, dstW, dstH);

   const srcCtx = source.getContext('2d')!;
   const srcData = srcCtx.getImageData(0, 0, source.width, source.height);
   const sPix = srcData.data;
   const sW = source.width;
   const sH = source.height;

   const out = document.createElement('canvas');
   out.width = dstW;
   out.height = dstH;
   const outCtx = out.getContext('2d')!;
   const outData = outCtx.createImageData(dstW, dstH);
   const oPix = outData.data;

   for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
         const w = h[6] * x + h[7] * y + 1;
         const sx = (h[0] * x + h[1] * y + h[2]) / w;
         const sy = (h[3] * x + h[4] * y + h[5]) / w;
         const oIdx = (y * dstW + x) * 4;

         if (sx < 0 || sy < 0 || sx > sW - 1 || sy > sH - 1) {
            oPix[oIdx] = oPix[oIdx + 1] = oPix[oIdx + 2] = 255;
            oPix[oIdx + 3] = 255;
            continue;
         }

         // Bilinear sample of the 4 neighboring source pixels
         const x0 = Math.floor(sx);
         const y0 = Math.floor(sy);
         const x1 = Math.min(x0 + 1, sW - 1);
         const y1 = Math.min(y0 + 1, sH - 1);
         const fx = sx - x0;
         const fy = sy - y0;
         const i00 = (y0 * sW + x0) * 4;
         const i10 = (y0 * sW + x1) * 4;
         const i01 = (y1 * sW + x0) * 4;
         const i11 = (y1 * sW + x1) * 4;
         for (let c = 0; c < 3; c++) {
            const top = sPix[i00 + c] * (1 - fx) + sPix[i10 + c] * fx;
            const bottom = sPix[i01 + c] * (1 - fx) + sPix[i11 + c] * fx;
            oPix[oIdx + c] = top * (1 - fy) + bottom * fy;
         }
         oPix[oIdx + 3] = 255;
      }
   }

   outCtx.putImageData(outData, 0, 0);
   return out;
}
