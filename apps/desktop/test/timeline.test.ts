import { describe, expect, it } from 'vitest';
import { advancePlayback, rulerTicks, timeAtPointer, timelineMarkers } from '../src/timelineMath';

describe('custom timeline', () => {
  it('keeps large mission markers readable and always includes the active waypoint', () => {
    const timings = Array.from({ length: 2000 }, (_, i) => ({ arrive: i }));
    for (const active of [0, 1, 1000, 1999]) {
      const markers = timelineMarkers(timings, 1999, 600, active);
      expect(markers).toContain(active);
      expect(markers.length).toBeLessThanOrEqual(16);
      expect(
        markers.every(
          (i, n) =>
            n === 0 || ((timings[i]!.arrive - timings[markers[n - 1]!]!.arrive) / 1999) * 600 >= 40,
        ),
      ).toBe(true);
    }
    expect(timelineMarkers([], 0, 600)).toEqual([]);
    expect(timelineMarkers([{ arrive: 0 }, { arrive: 0 }], 0, 600, 1)).toEqual([0, 1]);
  });
  it('scrubs accurately and clamps drags outside the bar', () => {
    expect(timeAtPointer(150, 100, 200, 60)).toBe(15);
    expect(timeAtPointer(0, 100, 200, 60)).toBe(0);
    expect(timeAtPointer(500, 100, 200, 60)).toBe(60);
    expect(timeAtPointer(150, 100, 0, 60)).toBe(0);
    expect(timeAtPointer(150, 100, 200, 0)).toBe(0);
  });

  it.each([0.5, 1, 1.5, 2, 2.5, 3])('advances at %sx without overshooting the end', (rate) => {
    expect(advancePlayback(10, 1000, rate, 60)).toBe(10 + rate);
    expect(advancePlayback(59.9, 1000, rate, 60)).toBe(60);
  });

  it('keeps the ruler bounded with readable intervals on short and long missions', () => {
    expect(rulerTicks(0, 6)).toEqual([0]);
    for (const duration of [0.2, 60, 7200]) {
      const ticks = rulerTicks(duration, 6);
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)).toBe(duration);
      expect(ticks.length).toBeLessThanOrEqual(8);
      expect(ticks.every((t, i) => i === 0 || t > ticks[i - 1]!)).toBe(true);
    }
  });
});
