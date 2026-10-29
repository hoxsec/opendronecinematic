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
