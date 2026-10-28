//! Flight obstacles and airfields pulled out of a Geofabrik .osm.pbf extract.

use anyhow::{bail, Result};
use osmpbf::{Element, ElementReader};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObstacleKind {
    Mast,
    Tower,
    Chimney,
    PowerTower,
    PowerLine,
    WindTurbine,
    Crane,
    Aerodrome,
    Heliport,
}

impl ObstacleKind {
    /// Assumed height above ground when OSM has no height tag.
    fn default_height(self) -> f32 {
        match self {
            Self::Mast => 50.0,
            Self::Tower => 30.0,
            Self::Chimney => 40.0,
            Self::PowerTower => 40.0,
            Self::PowerLine => 30.0,
            Self::WindTurbine => 150.0,
            Self::Crane => 40.0,
            Self::Aerodrome | Self::Heliport => 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Obstacle {
    pub kind: ObstacleKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Height above ground in metres.
    pub height: f32,
    /// False when the height is a default for the kind rather than an OSM tag.
    pub height_tagged: bool,
    /// [lon, lat] pairs: one point, or the vertices of a power line.
    pub coords: Vec<[f64; 2]>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ObstacleSet {
    pub obstacles: Vec<Obstacle>,
}

impl ObstacleSet {
    /// Obstacles touching a [west, south, east, north] box, at most `limit` of them.
    pub fn query(&self, bbox: [f64; 4], limit: usize) -> Vec<&Obstacle> {
        let [w, s, e, n] = bbox;
        let inside = |c: &[f64; 2]| c[0] >= w && c[0] <= e && c[1] >= s && c[1] <= n;
        self.obstacles
            .iter()
            .filter(|o| {
                if o.coords.len() == 1 {
                    return inside(&o.coords[0]);
                }
                o.coords.windows(2).any(|seg| {
                    let (a, b) = (seg[0], seg[1]);
                    a[0].min(b[0]) <= e && a[0].max(b[0]) >= w && a[1].min(b[1]) <= n && a[1].max(b[1]) >= s
                })
            })
            .take(limit)
            .collect()
    }
}

struct Tagged {
    kind: ObstacleKind,
    name: Option<String>,
    height: Option<f32>,
    voltage: Option<f32>,
}

fn classify<'a>(tags: impl Iterator<Item = (&'a str, &'a str)>) -> Option<Tagged> {
    let tags: Vec<(&str, &str)> = tags.collect();
    let get = |k: &str| tags.iter().find(|(key, _)| *key == k).map(|(_, v)| *v);
    let kind = match (get("man_made"), get("power"), get("aeroway")) {
        (_, _, Some("aerodrome")) => ObstacleKind::Aerodrome,
        (_, _, Some("heliport" | "helipad")) => ObstacleKind::Heliport,
        (_, Some("line"), _) => ObstacleKind::PowerLine,
        (_, Some("tower"), _) => ObstacleKind::PowerTower,
        (_, Some("generator"), _)
            if get("generator:source") == Some("wind") || get("generator:method") == Some("wind_turbine") =>
        {
            ObstacleKind::WindTurbine
        }
        (Some("mast"), _, _) => ObstacleKind::Mast,
        (Some("tower" | "communications_tower"), _, _) => ObstacleKind::Tower,
        (Some("chimney"), _, _) => ObstacleKind::Chimney,
        (Some("crane"), _, _) => ObstacleKind::Crane,
        _ => return None,
    };
    let mut height = get("height").and_then(parse_height);
    if kind == ObstacleKind::WindTurbine && height.is_none() {
        // Tip height from hub height plus half the rotor.
        let hub = get("generator:height").or(get("hub_height")).and_then(parse_height);
        let rotor = get("rotor:diameter").and_then(parse_height).unwrap_or(0.0);
        height = hub.map(|h| h + rotor / 2.0);
    }
    Some(Tagged {
        kind,
        name: get("name").map(str::to_string),
        height,
        voltage: get("voltage").and_then(|v| v.split(';').next()?.trim().parse().ok()),
    })
}

/// "45", "45 m", "45.5m", "150 ft", "12'", "40;45" -> metres.
pub fn parse_height(s: &str) -> Option<f32> {
    let s = s.split(';').next()?.trim().to_lowercase();
    let num: String = s.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let v: f32 = num.parse().ok()?;
    let unit = s[num.len()..].trim();
    let m = match unit {
        "" | "m" | "meter" | "meters" | "metre" | "metres" => v,
        "ft" | "feet" | "'" => v * 0.3048,
        _ => return None,
    };
    (m > 0.0 && m < 1000.0).then_some(m)
}

fn power_line_height(voltage: Option<f32>) -> f32 {
    match voltage {
        Some(v) if v >= 220_000.0 => 50.0,
        Some(v) if v >= 110_000.0 => 35.0,
        _ => 25.0,
    }
}

enum Found {
    Node(i64, Obstacle),
    Way(Tagged, Vec<i64>),
}

/// Two passes over the file: find tagged nodes and ways, then resolve the ways' node positions.
pub fn extract(pbf: &Path, cancel: &AtomicBool) -> Result<ObstacleSet> {
    let node = |id: i64, lat: f64, lon: f64, t: Tagged| {
        let tagged = t.height.is_some();
        Found::Node(
            id,
            Obstacle {
                kind: t.kind,
                name: t.name,
                height: t.height.unwrap_or_else(|| t.kind.default_height()),
                height_tagged: tagged,
                coords: vec![[lon, lat]],
            },
        )
    };
    let found: Vec<Found> = ElementReader::from_path(pbf)?.par_map_reduce(
        |el| match el {
            Element::Node(n) => classify(n.tags())
                .filter(|t| t.kind != ObstacleKind::PowerLine)
                .map(|t| vec![node(n.id(), n.lat(), n.lon(), t)])
                .unwrap_or_default(),
            Element::DenseNode(n) => classify(n.tags())
                .filter(|t| t.kind != ObstacleKind::PowerLine)
                .map(|t| vec![node(n.id(), n.lat(), n.lon(), t)])
                .unwrap_or_default(),
            Element::Way(w) => classify(w.tags())
                .filter(|t| t.kind != ObstacleKind::PowerTower)
                .map(|t| vec![Found::Way(t, w.refs().collect())])
                .unwrap_or_default(),
            Element::Relation(_) => Vec::new(),
        },
        Vec::new,
        |mut a, mut b| {
            a.append(&mut b);
            a
        },
    )?;
    if cancel.load(Ordering::Relaxed) {
        bail!("cancelled");
    }

    let mut obstacles = Vec::new();
    let mut tower_heights: HashMap<i64, f32> = HashMap::new();
    let mut ways = Vec::new();
    for f in found {
        match f {
            Found::Node(id, o) => {
                if o.kind == ObstacleKind::PowerTower && o.height_tagged {
                    tower_heights.insert(id, o.height);
                }
                obstacles.push(o);
            }
            Found::Way(t, refs) => ways.push((t, refs)),
        }
    }

    let needed: HashSet<i64> = ways.iter().flat_map(|(_, r)| r.iter().copied()).collect();
    let positions: HashMap<i64, [f64; 2]> = if needed.is_empty() {
        HashMap::new()
    } else {
        ElementReader::from_path(pbf)?
            .par_map_reduce(
                |el| match el {
                    Element::Node(n) if needed.contains(&n.id()) => vec![(n.id(), [n.lon(), n.lat()])],
                    Element::DenseNode(n) if needed.contains(&n.id()) => vec![(n.id(), [n.lon(), n.lat()])],
                    _ => Vec::new(),
                },
                Vec::new,
                |mut a, mut b| {
                    a.append(&mut b);
                    a
                },
            )?
            .into_iter()
            .collect()
    };
    if cancel.load(Ordering::Relaxed) {
        bail!("cancelled");
    }

    for (t, refs) in ways {
        let coords: Vec<[f64; 2]> = refs.iter().filter_map(|r| positions.get(r).copied()).collect();
        if coords.is_empty() {
            continue;
        }
        let (height, tagged, coords) = if t.kind == ObstacleKind::PowerLine {
            if coords.len() < 2 {
                continue;
            }
            let towers = refs.iter().filter_map(|r| tower_heights.get(r)).copied().fold(None, |m: Option<f32>, h| {
                Some(m.map_or(h, |m| m.max(h)))
            });
            match (t.height, towers) {
                (Some(h), _) | (None, Some(h)) => (h, true, coords),
                (None, None) => (power_line_height(t.voltage), false, coords),
            }
        } else {
            // Areas (airfields, chimney footprints, ...) collapse to their centroid.
            let n = coords.len() as f64;
            let c = coords.iter().fold([0.0, 0.0], |a, p| [a[0] + p[0] / n, a[1] + p[1] / n]);
            (t.height.unwrap_or_else(|| t.kind.default_height()), t.height.is_some(), vec![c])
        };
        obstacles.push(Obstacle { kind: t.kind, name: t.name, height, height_tagged: tagged, coords });
    }
    Ok(ObstacleSet { obstacles })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_heights() {
        assert_eq!(parse_height("45"), Some(45.0));
        assert_eq!(parse_height("45.5 m"), Some(45.5));
        assert_eq!(parse_height("100 ft").map(|v| v.round()), Some(30.0));
        assert_eq!(parse_height("40;45"), Some(40.0));
        assert_eq!(parse_height("tall"), None);
    }

    #[test]
    fn classifies_tags() {
        let t = classify([("power", "generator"), ("generator:source", "wind"), ("generator:height", "100"), ("rotor:diameter", "80")].into_iter()).unwrap();
        assert_eq!(t.kind, ObstacleKind::WindTurbine);
        assert_eq!(t.height, Some(140.0));
        assert!(classify([("building", "yes")].into_iter()).is_none());
    }

    #[test]
    fn queries_lines_crossing_the_box() {
        let line = Obstacle {
            kind: ObstacleKind::PowerLine,
            name: None,
            height: 30.0,
            height_tagged: false,
            coords: vec![[0.0, 0.0], [2.0, 0.0]],
        };
        let set = ObstacleSet { obstacles: vec![line] };
        assert_eq!(set.query([0.9, -0.1, 1.1, 0.1], 10).len(), 1);
        assert_eq!(set.query([0.9, 0.5, 1.1, 0.6], 10).len(), 0);
    }
}
