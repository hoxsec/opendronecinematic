import { AIRSPACE_MAX_BYTES, parseAirspaceGeoJson } from '@odc/core';
import { isTauri } from './platform';

export const OPENAIP_EXPORTS = 'https://www.openaip.net/data/exports';
export const OPENAIP_SOURCE = 'OpenAIP · https://www.openaip.net · CC BY-NC 4.0';

export function openAipCountry(country: string): string {
  const code = country.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) throw new Error('Enter a two-letter country code, e.g. AT or DE.');
  return code;
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid OpenAIP object.');
  return value as Record<string, unknown>;
};

function limit(value: unknown): string | undefined {
  if (value == null) return;
  const p = record(value);
  const unit = new Map([
    [0, 'm'],
    [1, 'ft'],
    [6, 'FL'],
  ]).get(p.unit as number);
  const datum = new Map([
    [0, 'GND'],
    [1, 'MSL'],
    [2, 'STD'],
  ]).get(p.referenceDatum as number);
  if (typeof p.value !== 'number' || !Number.isFinite(p.value) || !unit || !datum)
    throw new Error('Unsupported OpenAIP vertical limit.');
  return unit === 'FL' ? `FL ${p.value} (${datum})` : `${p.value} ${unit} ${datum}`;
}

/** Explicit provider adapter; never treats provider codes as our category strings. */
export function convertOpenAip(json: string, country?: string): string {
  if (new TextEncoder().encode(json).byteLength > AIRSPACE_MAX_BYTES)
    throw new Error('OpenAIP export exceeds the 10 MB limit.');
  const root = record(JSON.parse(json));
  if (root.type !== 'FeatureCollection' || !Array.isArray(root.features) || root.crs !== undefined)
    throw new Error('Expected an OpenAIP WGS84 GeoJSON FeatureCollection.');
  if (!root.features.length || root.features.length > 5000)
    throw new Error('OpenAIP export must contain 1–5,000 airspaces.');
  const normalized = JSON.stringify({
    type: 'FeatureCollection',
    source: `${OPENAIP_SOURCE}${country ? ` · ${openAipCountry(country).toUpperCase()}` : ''}`,
    features: root.features.map((value) => {
      const f = record(value);
      const p = record(f.properties);
      if (f.type !== 'Feature' || typeof p.name !== 'string' || !Number.isInteger(p.type))
        throw new Error('Invalid OpenAIP airspace feature.');
      if (country && p.country !== openAipCountry(country).toUpperCase())
        throw new Error('OpenAIP airspace country does not match the requested country.');
      const type = p.type as number;
      const restricted = [1, 2, 3, 8, 9, 19, 29].includes(type);
      const controlled =
        [4, 7, 26, 36].includes(type) ||
        (typeof p.icaoClass === 'number' && p.icaoClass >= 0 && p.icaoClass <= 4);
      const flags = [
        'byNotam',
        'onDemand',
        'onRequest',
        'specialAgreement',
        'requestCompliance',
      ].filter((key) => p[key] === true);
      return {
        type: 'Feature',
        id: p._id ?? f.id,
        geometry: f.geometry,
        properties: {
          name: p.name,
          category: restricted ? 'restricted' : controlled ? 'controlled' : 'advisory',
          lower: limit(p.lowerLimit),
          upper: limit(p.upperLimit),
          description: `OpenAIP type ${type}; ICAO class code ${p.icaoClass ?? 'unknown'}. Activation not evaluated.${flags.length ? ` Flags: ${flags.join(', ')}.` : ''}`,
        },
      };
    }),
  });
  // Reuse every existing geometry, text, uniqueness and resource limit check.
  parseAirspaceGeoJson(normalized);
  return normalized;
}

export async function downloadOpenAip(country: string): Promise<string> {
  const code = openAipCountry(country);
  if (!isTauri())
    throw new Error(
      'Direct downloads require the desktop app. Download GeoJSON from OpenAIP and use Import OpenAIP.',
    );
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('download_openaip_airspace', { country: code });
}
