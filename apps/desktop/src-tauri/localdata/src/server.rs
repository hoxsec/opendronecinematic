//! Localhost HTTP server for downloaded regions. Endpoints:
//!
//! - `GET /regions`: downloaded regions (JSON)
//! - `GET /regions/{key}/tiles.json`: TileJSON for the basemap
//! - `GET /regions/{key}/{z}/{x}/{y}.mvt`: one vector tile (Protomaps basemap schema)
//! - `GET /regions/{key}/basemap.pmtiles`: the whole archive, with HTTP range support
//! - `GET /regions/{key}/obstacles?bbox=w,s,e,n`: obstacles in a box (JSON)

use crate::obstacles::ObstacleSet;
use crate::pmtiles::Archive;
use crate::regions::{list_meta, region_dir, valid_key};
use anyhow::Result;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Request, Response, Server};

/// Preferred port so URLs stay stable between launches; falls back to any free port.
const PORTS: std::ops::RangeInclusive<u16> = 47831..=47840;
const WORKERS: usize = 4;
const MAX_RANGE: u64 = 64 << 20;
const MAX_OBSTACLES: usize = 20_000;

pub(crate) struct Shared {
    pub root: PathBuf,
    archives: Mutex<HashMap<String, Arc<Archive>>>,
    obstacles: Mutex<HashMap<String, Arc<ObstacleSet>>>,
}

impl Shared {
    pub fn new(root: PathBuf) -> Self {
        Self { root, archives: Mutex::default(), obstacles: Mutex::default() }
    }

    /// Drop open files for a region before it is replaced or deleted.
    pub fn forget(&self, key: &str) {
        self.archives.lock().unwrap().remove(key);
        self.obstacles.lock().unwrap().remove(key);
    }

    fn archive(&self, key: &str) -> Option<Arc<Archive>> {
        if let Some(a) = self.archives.lock().unwrap().get(key) {
            return Some(a.clone());
        }
        let path = region_dir(&self.root, key).join("basemap.pmtiles");
        let a = Arc::new(Archive::open(&path).ok()?);
        self.archives.lock().unwrap().insert(key.to_string(), a.clone());
        Some(a)
    }

    fn obstacle_set(&self, key: &str) -> Option<Arc<ObstacleSet>> {
        if let Some(o) = self.obstacles.lock().unwrap().get(key) {
            return Some(o.clone());
        }
        let text = fs::read(region_dir(&self.root, key).join("obstacles.json")).ok()?;
        let set = Arc::new(serde_json::from_slice::<ObstacleSet>(&text).ok()?);
        self.obstacles.lock().unwrap().insert(key.to_string(), set.clone());
        Some(set)
    }
}

/// Bind the server and start its worker threads. Returns the base URL, e.g. http://127.0.0.1:47831.
pub(crate) fn start(shared: Arc<Shared>) -> Result<String> {
    let server = PORTS
        .clone()
        .find_map(|p| Server::http(("127.0.0.1", p)).ok())
        .map(Ok)
        .unwrap_or_else(|| Server::http(("127.0.0.1", 0)))
        .map_err(|e| anyhow::anyhow!("starting tile server: {e}"))?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or_default();
    let server = Arc::new(server);
    for _ in 0..WORKERS {
        let (server, shared) = (server.clone(), shared.clone());
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                handle(&shared, req);
            }
        });
    }
    Ok(format!("http://127.0.0.1:{port}"))
}

fn header(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

fn cors<R: std::io::Read>(r: Response<R>) -> Response<R> {
    r.with_header(header("Access-Control-Allow-Origin", "*"))
        .with_header(header("Access-Control-Allow-Headers", "Range"))
        .with_header(header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Encoding"))
}

fn json(body: &impl serde::Serialize) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(serde_json::to_vec(body).unwrap_or_default())
        .with_header(header("Content-Type", "application/json"))
}

fn status(code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(Vec::new()).with_status_code(code)
}

fn handle(shared: &Shared, req: Request) {
    let url = req.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    if *req.method() == Method::Options {
        let _ = req.respond(cors(status(204)));
        return;
    }
    if *req.method() != Method::Get && *req.method() != Method::Head {
        let _ = req.respond(cors(status(405)));
        return;
    }
    let resp = match parts.as_slice() {
        ["regions"] => json(&list_meta(&shared.root)),
        ["regions", key, rest @ ..] if valid_key(key) => match rest {
            ["tiles.json"] => tilejson(shared, key, &req),
            ["obstacles"] => obstacles(shared, key, query),
            ["basemap.pmtiles"] => return range_file(shared, key, req),
            [z, x, y] => tile(shared, key, z, x, y),
            _ => status(404),
        },
        _ => status(404),
    };
    let _ = req.respond(cors(resp));
}

fn tile(shared: &Shared, key: &str, z: &str, x: &str, y: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let y = y.split('.').next().unwrap_or_default();
    let (Ok(z), Ok(x), Ok(y)) = (z.parse::<u8>(), x.parse::<u32>(), y.parse::<u32>()) else {
        return status(400);
    };
    let Some(a) = shared.archive(key) else { return status(404) };
    match a.tile(z, x, y) {
        Ok(Some(data)) => {
            let mut r = Response::from_data(data)
                .with_header(header("Content-Type", "application/vnd.mapbox-vector-tile"))
                .with_header(header("Cache-Control", "max-age=3600"));
            if let Some(enc) = a.header.tile_compression.content_encoding() {
                r = r.with_header(header("Content-Encoding", enc));
            }
            r
        }
        Ok(None) => status(204),
        Err(_) => status(500),
    }
}

fn tilejson(shared: &Shared, key: &str, req: &Request) -> Response<std::io::Cursor<Vec<u8>>> {
    let Some(a) = shared.archive(key) else { return status(404) };
    let host = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Host"))
        .map(|h| h.value.as_str().to_string())
        .unwrap_or_else(|| "127.0.0.1".into());
    let meta: serde_json::Value =
        a.metadata().ok().and_then(|m| serde_json::from_str(&m).ok()).unwrap_or_default();
    let h = &a.header;
    json(&serde_json::json!({
        "tilejson": "3.0.0",
        "format": match h.tile_type { 1 => "pbf", 2 => "png", 3 => "jpg", 4 => "webp", 5 => "avif", _ => "unknown" },
        "tiles": [format!("http://{host}/regions/{key}/{{z}}/{{x}}/{{y}}.mvt")],
        "minzoom": h.min_zoom,
        "maxzoom": h.max_zoom,
        "bounds": h.bounds,
        "center": h.center,
        "vector_layers": meta.get("vector_layers").cloned().unwrap_or_default(),
        "attribution": meta.get("attribution").cloned().unwrap_or_else(|| "© OpenStreetMap contributors".into()),
    }))
}

fn obstacles(shared: &Shared, key: &str, query: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let bbox: Option<[f64; 4]> = query
        .split('&')
        .find_map(|kv| kv.strip_prefix("bbox="))
        .and_then(|v| {
            let n: Vec<f64> = v.split(',').filter_map(|p| p.parse().ok()).collect();
            n.try_into().ok()
        });
    let Some(bbox) = bbox else { return status(400) };
    let Some(set) = shared.obstacle_set(key) else { return status(404) };
    json(&set.query(bbox, MAX_OBSTACLES))
}

/// Serve the raw archive so PMTiles-aware clients (MapLibre, QGIS) can read it directly.
fn range_file(shared: &Shared, key: &str, req: Request) {
    let Some(a) = shared.archive(key) else {
        let _ = req.respond(cors(status(404)));
        return;
    };
    let path = region_dir(&shared.root, key).join("basemap.pmtiles");
    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let range = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .and_then(|h| parse_range(h.value.as_str(), size));
    let resp = match range {
        Some((start, end)) if end - start + 1 <= MAX_RANGE => match a.read(start, end - start + 1) {
            Ok(data) => Response::from_data(data)
                .with_status_code(206)
                .with_header(header("Content-Range", &format!("bytes {start}-{end}/{size}"))),
            Err(_) => status(500),
        },
        Some(_) => status(416),
        None => match fs::File::open(&path) {
            Ok(f) => {
                let _ = req.respond(cors(Response::from_file(f).with_header(header("Accept-Ranges", "bytes"))));
                return;
            }
            Err(_) => status(404),
        },
    };
    let _ = req.respond(cors(resp.with_header(header("Accept-Ranges", "bytes"))));
}

/// "bytes=a-b", "bytes=a-" or "bytes=-n" -> inclusive (start, end).
fn parse_range(v: &str, size: u64) -> Option<(u64, u64)> {
    let spec = v.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.parse::<u64>().ok(), b.parse::<u64>().ok()) {
        (Some(a), Some(b)) => (a, b.min(size.checked_sub(1)?)),
        (Some(a), None) => (a, size.checked_sub(1)?),
        (None, Some(n)) => (size.saturating_sub(n), size.checked_sub(1)?),
        (None, None) => return None,
    };
    (start <= end).then_some((start, end))
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn parses_ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=0-5000", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=2000-", 1000), None);
    }
}
