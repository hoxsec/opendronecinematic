export function timeAtPointer(x: number, left: number, width: number, duration: number) {
  if (width <= 0 || duration <= 0) return 0;
  return Math.min(duration, Math.max(0, ((x - left) / width) * duration));
}

export function advancePlayback(time: number, elapsedMs: number, rate: number, duration: number) {
  return Math.min(duration, Math.max(0, time + (Math.max(0, elapsedMs) * rate) / 1000));
}

export function rulerTicks(duration: number, count: number) {
  if (duration <= 0) return [0];
  const target = duration / Math.max(2, count);
  const base = 10 ** Math.floor(Math.log10(target));
  const step = ([1, 2, 5, 10].find((n) => n * base >= target) ?? 10) * base;
  const ticks = [0];
  for (let t = step; t < duration * 0.94; t += step) ticks.push(t);
  ticks.push(duration);
  return ticks;
}

/** Bound marker DOM and prevent overlapping labels, retaining the active waypoint at any scale. */
export function timelineMarkers(
  timings: readonly { arrive: number }[],
  duration: number,
  width: number,
  active = -1,
) {
  const activeX =
    active >= 0 && timings[active] && duration > 0
      ? (timings[active]!.arrive / duration) * width
      : undefined;
  const indices: number[] = [];
  let lastX = -Infinity;
  for (let i = 0; i < timings.length; i++) {
    const x = duration > 0 ? (timings[i]!.arrive / duration) * width : 0;
    if (
      i === active ||
      (x - lastX >= 40 && (activeX === undefined || Math.abs(x - activeX) >= 40))
    ) {
      indices.push(i);
      lastX = x;
    }
  }
  return indices;
}
