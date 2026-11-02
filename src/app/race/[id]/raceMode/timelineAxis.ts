/** Visible range: 1 hour before the first start, 2 hours after the last one. */
export function timelineRange(starts: number[], ends: (number | null)[]) {
  const from = Math.max(0, Math.min(...starts) - 60);
  // A wave still running past the range keeps its end (and the now line) in view.
  const to = Math.min(1440, Math.max(Math.max(...starts) + 120, ...ends.map((e) => e ?? 0)));
  return { from, to };
}

/**
 * Time axis that stretches where it has to, so a wave's card always fits before
 * the next wave. `waves` is sorted by start. Hours just get more room there.
 */
export function buildTimelineAxis(
  waves: { start: number; height: number }[],
  range: { from: number; to: number },
  pxPerMin: number,
  gap: number
) {
  const anchors: { min: number; y: number }[] = [];
  waves.forEach((w, i) => {
    const prev = waves[i - 1];
    const y = prev
      ? Math.max(anchors[i - 1].y + (w.start - prev.start) * pxPerMin, anchors[i - 1].y + prev.height + gap)
      : (w.start - range.from) * pxPerMin;
    anchors.push({ min: w.start, y });
  });
  const tops = anchors.map((a) => a.y);
  const last = waves[waves.length - 1];
  if (last) {
    // The time after the last wave stays visible below its card
    const lastY = anchors[anchors.length - 1].y;
    const end = Math.max(lastY + (range.to - last.start) * pxPerMin, lastY + last.height + 60 * pxPerMin);
    if (range.to > last.start) anchors.push({ min: range.to, y: end });
  }

  const toY = (min: number) => {
    if (!anchors.length) return (min - range.from) * pxPerMin;
    const next = anchors.findIndex((a) => a.min >= min);
    if (next === 0) return anchors[0].y - (anchors[0].min - min) * pxPerMin;
    if (next === -1) {
      const end = anchors[anchors.length - 1];
      return end.y + (min - end.min) * pxPerMin;
    }
    const a = anchors[next - 1];
    const b = anchors[next];
    return a.y + ((min - a.min) / (b.min - a.min)) * (b.y - a.y);
  };

  return { tops, toY, height: toY(range.to) };
}
