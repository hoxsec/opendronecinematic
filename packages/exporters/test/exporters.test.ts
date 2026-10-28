import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { createMission, generateShot, type Mission } from '@odc/core';
import { buildWpml, exportDjiKmz, exportLitchiCsv, toExportPoints } from '../src';

const NOW = Date.UTC(2026, 0, 1);

function orbitMission(profile = 'dji-mavic-3e'): Mission {
  const m = createMission({ lat: 47.3769, lon: 8.5417, groundHeight: 450 }, profile);
  const shot = generateShot(m, 'orbit', {
    subject: { id: 'poi_tower', name: 'Tower', lat: 47.3772, lon: 8.5421, height: 480 },
    groundHeight: 450,
    radius: 50,
    height: 40,
    startBearing: 180,
    sweep: 180,
  });
  m.waypoints = shot.waypoints;
  m.waypoints[0]!.actions = [{ type: 'startRecording' }, { type: 'hover', seconds: 2 }];
  m.waypoints[m.waypoints.length - 1]!.actions = [{ type: 'stopRecording' }];
  m.pois = [shot.poi];
  return m;
}

describe('litchi csv', () => {
  it('matches the golden file', async () => {
    const { data, warnings } = exportLitchiCsv(orbitMission('dji-mini-4-pro'));
    expect(warnings).toEqual([]);
    await expect(data).toMatchFileSnapshot('./__snapshots__/orbit.litchi.csv');
  });

  it('has 46 columns per row and focuses the POI', () => {
    const { data } = exportLitchiCsv(orbitMission('dji-mini-4-pro'));
    const rows = data
      .trim()
      .split('\n')
      .map((r) => r.split(','));
    for (const r of rows) expect(r).toHaveLength(46);
    expect(rows[1]![6]).toBe('1'); // gimbalmode = focus POI
    expect(rows[1]![8]).toBe('2'); // first action = start recording
  });

  it('warns past 99 waypoints when densified finely', () => {
    const { warnings } = exportLitchiCsv(orbitMission('dji-mini-4-pro'), { densify: 1 });
    expect(warnings.some((w) => w.includes('99'))).toBe(true);
  });
});

describe('dji wpml', () => {
  it('matches the golden files', async () => {
    const { data, warnings } = buildWpml(orbitMission(), { now: NOW });
    expect(warnings).toEqual([]);
    await expect(data.templateKml).toMatchFileSnapshot('./__snapshots__/orbit.template.kml');
    await expect(data.waylinesWpml).toMatchFileSnapshot('./__snapshots__/orbit.waylines.wpml');
  });

  it('packs a kmz with the wpmz folder layout', () => {
    const { data } = exportDjiKmz(orbitMission(), { now: NOW });
    const files = unzipSync(data);
    expect(Object.keys(files).sort()).toEqual(['wpmz/template.kml', 'wpmz/waylines.wpml']);
    expect(strFromU8(files['wpmz/waylines.wpml']!)).toContain('towardPOI');
  });

  it('warns for profiles without verified enums', () => {
    const { warnings } = buildWpml(orbitMission('dji-air-3'), { now: NOW });
    expect(warnings[0]).toMatch(/no known DJI WPML drone enum/);
  });
});

describe('densify', () => {
  it('keeps every original waypoint and bakes fixed camera angles', () => {
    const m = orbitMission();
    const pts = toExportPoints(m, { densify: 5 });
    const wpIdx = pts.filter((p) => p.waypointIndex !== undefined).map((p) => p.waypointIndex);
    expect(wpIdx).toEqual(m.waypoints.map((_, i) => i));
    expect(pts.every((p) => p.headingMode === 'fixed')).toBe(true);
    expect(pts.length).toBeGreaterThan(m.waypoints.length * 3);
  });
});
