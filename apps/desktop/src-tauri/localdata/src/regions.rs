//! Geofabrik's region index (countries, states, ...) and the metadata of downloaded regions.

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const INDEX_URL: &str = "https://download.geofabrik.de/index-v1.json";
const INDEX_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeofabrikRegion {
    /// Geofabrik's id, e.g. "germany" or "us/california".
    pub id: String,
    pub parent: Option<String>,
    pub name: String,
    pub pbf_url: String,
    /// [west, south, east, north] in degrees.
    pub bbox: [f64; 4],
}

pub(crate) struct Index {
    pub regions: Vec<GeofabrikRegion>,
    geometries: HashMap<String, Value>,
}

impl Index {
    pub fn get(&self, id: &str) -> Option<&GeofabrikRegion> {
        self.regions.iter().find(|r| r.id == id)
    }

    /// The region outline as a GeoJSON Feature, for `pmtiles extract --region`.
    pub fn outline(&self, id: &str) -> Option<Value> {
        let geometry = self.geometries.get(id)?.clone();
        Some(serde_json::json!({ "type": "Feature", "properties": {}, "geometry": geometry }))
    }
}

/// Load the index, refreshing the cached copy weekly. Falls back to a stale copy when offline.
pub(crate) fn load_index(dir: &Path, agent: &ureq::Agent) -> Result<Index> {
    let cache = dir.join("geofabrik-index-v1.json");
    let fresh = fs::metadata(&cache)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < INDEX_MAX_AGE);
    if !fresh {
        let fetched = agent
            .get(INDEX_URL)
            .call()
            .map_err(|e| anyhow!("{e}"))
            .and_then(|r| {
                let mut s = String::new();
                r.into_reader().read_to_string(&mut s)?;
                Ok(s)
            });
        match fetched {
            Ok(text) => {
                let index = parse_index(&text)?;
                fs::create_dir_all(dir)?;
                fs::write(&cache, &text)?;
                return Ok(index);
            }
            Err(e) if !cache.exists() => return Err(e.context("downloading Geofabrik index")),
            Err(_) => {}
        }
    }
    parse_index(&fs::read_to_string(&cache)?)
}

fn parse_index(text: &str) -> Result<Index> {
    let json: Value = serde_json::from_str(text).context("parsing Geofabrik index")?;
    let features = json["features"].as_array().ok_or_else(|| anyhow!("index has no features"))?;
    let mut regions = Vec::with_capacity(features.len());
    let mut geometries = HashMap::new();
    for f in features {
        let p = &f["properties"];
        let (Some(id), Some(name), Some(pbf)) =
            (p["id"].as_str(), p["name"].as_str(), p["urls"]["pbf"].as_str())
        else {
            continue;
        };
        let mut bbox = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
        extend_bbox(&f["geometry"]["coordinates"], &mut bbox);
        if bbox[0] > bbox[2] {
            continue;
        }
        regions.push(GeofabrikRegion {
            id: id.to_string(),
            parent: p["parent"].as_str().map(str::to_string),
            name: name.to_string(),
            pbf_url: pbf.to_string(),
            bbox,
        });
        geometries.insert(id.to_string(), f["geometry"].clone());
    }
    regions.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Index { regions, geometries })
}

fn extend_bbox(coords: &Value, bbox: &mut [f64; 4]) {
    let Some(arr) = coords.as_array() else { return };
    if let (Some(lon), Some(lat)) = (arr.first().and_then(Value::as_f64), arr.get(1).and_then(Value::as_f64)) {
        bbox[0] = bbox[0].min(lon);
        bbox[1] = bbox[1].min(lat);
        bbox[2] = bbox[2].max(lon);
        bbox[3] = bbox[3].max(lat);
        return;
    }
    for c in arr {
        extend_bbox(c, bbox);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BasemapMeta {
    /// Protomaps daily build the basemap was cut from, e.g. "20261028".
    pub build: String,
    pub max_zoom: u8,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObstacleMeta {
    pub count: usize,
    pub bytes: u64,
}

/// What has been downloaded for one region, stored as region.json next to the data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionMeta {
    pub id: String,
    /// Filesystem- and URL-safe form of the id.
    pub key: String,
    pub name: String,
    pub bbox: [f64; 4],
    pub basemap: Option<BasemapMeta>,
    pub obstacles: Option<ObstacleMeta>,
    /// Unix seconds of the last completed download.
    pub updated: u64,
}

/// "us/california" -> "us__california". Geofabrik ids are lowercase ASCII with dashes.
pub fn region_key(id: &str) -> Result<String> {
    let key = id.replace('/', "__");
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        bail!("invalid region id {id:?}");
    }
    Ok(key)
}

pub(crate) fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn region_dir(root: &Path, key: &str) -> PathBuf {
    root.join("regions").join(key)
}

pub(crate) fn read_meta(root: &Path, key: &str) -> Option<RegionMeta> {
    let text = fs::read_to_string(region_dir(root, key).join("region.json")).ok()?;
    serde_json::from_str(&text).ok()
}

pub(crate) fn write_meta(root: &Path, meta: &RegionMeta) -> Result<()> {
    let dir = region_dir(root, &meta.key);
    fs::create_dir_all(&dir)?;
    fs::write(dir.join("region.json"), serde_json::to_vec_pretty(meta)?)?;
    Ok(())
}

pub(crate) fn list_meta(root: &Path) -> Vec<RegionMeta> {
    let Ok(entries) = fs::read_dir(root.join("regions")) else { return Vec::new() };
    let mut out: Vec<RegionMeta> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| read_meta(root, &e.file_name().to_string_lossy()))
        .filter(|m| m.basemap.is_some() || m.obstacles.is_some())
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_index_features() {
        let text = r#"{"features":[{"properties":{"id":"us/x","parent":"us","name":"X",
            "urls":{"pbf":"https://e/x.osm.pbf"}},
            "geometry":{"type":"MultiPolygon","coordinates":[[[[1,2],[3,4],[0,5],[1,2]]]]}}]}"#;
        let index = parse_index(text).unwrap();
        let r = index.get("us/x").unwrap();
        assert_eq!(r.bbox, [0.0, 2.0, 3.0, 5.0]);
        assert_eq!(r.parent.as_deref(), Some("us"));
        assert!(index.outline("us/x").is_some());
    }

    #[test]
    fn keys_are_safe() {
        assert_eq!(region_key("us/california").unwrap(), "us__california");
        assert!(region_key("../etc").is_err());
    }
}
