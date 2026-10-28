//! Offline map data for OpenDroneCinematic. For a country (or any region) from Geofabrik's index:
//!
//! - cuts a vector basemap out of the daily Protomaps planet build with `pmtiles extract`,
//! - downloads the Geofabrik .osm.pbf and keeps only flight obstacles and airfields,
//! - serves both over HTTP on 127.0.0.1 so the app (or QGIS, MapLibre, ...) can use them offline.

mod download;
mod obstacles;
mod pmtiles;
mod regions;
mod server;

pub use obstacles::{Obstacle, ObstacleKind, ObstacleSet};
pub use regions::{region_key, BasemapMeta, GeofabrikRegion, ObstacleMeta, RegionMeta};

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    /// Geofabrik region id.
    pub id: String,
    pub basemap: bool,
    pub obstacles: bool,
    /// Highest basemap zoom level; 15 has full detail and building heights.
    pub max_zoom: u8,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Preparing,
    Basemap,
    Pbf,
    Obstacles,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub key: String,
    pub stage: Stage,
    /// 0..1 within the stage, when known.
    pub fraction: Option<f64>,
    pub message: String,
}

struct Job {
    cancel: AtomicBool,
    child: Arc<Mutex<Option<Child>>>,
}

pub struct LocalData {
    shared: Arc<server::Shared>,
    base_url: String,
    agent: ureq::Agent,
    index: Mutex<Option<Arc<regions::Index>>>,
    jobs: Arc<Mutex<HashMap<String, Arc<Job>>>>,
}

impl LocalData {
    /// Use `root` for all data and start the tile server.
    pub fn start(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("regions"))?;
        let shared = Arc::new(server::Shared::new(root));
        let base_url = server::start(shared.clone())?;
        Ok(Self {
            shared,
            base_url,
            agent: download::agent(),
            index: Mutex::default(),
            jobs: Arc::default(),
        })
    }

    /// e.g. http://127.0.0.1:47831
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn index(&self) -> Result<Arc<regions::Index>> {
        if let Some(i) = self.index.lock().unwrap().as_ref() {
            return Ok(i.clone());
        }
        let i = Arc::new(regions::load_index(&self.shared.root, &self.agent)?);
        *self.index.lock().unwrap() = Some(i.clone());
        Ok(i)
    }

    /// Every region in Geofabrik's index (continents, countries, states, ...).
    pub fn geofabrik_regions(&self) -> Result<Vec<GeofabrikRegion>> {
        Ok(self.index()?.regions.clone())
    }

    /// Size in bytes of a region's .osm.pbf, to show before downloading it.
    pub fn pbf_size(&self, id: &str) -> Result<Option<u64>> {
        let index = self.index()?;
        let r = index.get(id).ok_or_else(|| anyhow!("unknown region {id}"))?;
        download::remote_size(&self.agent, &r.pbf_url)
    }

    pub fn regions(&self) -> Vec<RegionMeta> {
        regions::list_meta(&self.shared.root)
    }

    pub fn is_downloading(&self, key: &str) -> bool {
        self.jobs.lock().unwrap().contains_key(key)
    }

    /// Start downloading in the background; `progress` is called from the worker thread.
    pub fn download(
        &self,
        req: DownloadRequest,
        progress: impl Fn(Progress) + Send + 'static,
    ) -> Result<()> {
        if !req.basemap && !req.obstacles {
            bail!("nothing to download");
        }
        let key = region_key(&req.id)?;
        let job = Arc::new(Job { cancel: AtomicBool::new(false), child: Arc::default() });
        {
            let mut jobs = self.jobs.lock().unwrap();
            if jobs.contains_key(&key) {
                bail!("{} is already downloading", req.id);
            }
            jobs.insert(key.clone(), job.clone());
        }
        let index = match self.index() {
            Ok(i) => i,
            Err(e) => {
                self.jobs.lock().unwrap().remove(&key);
                return Err(e);
            }
        };
        let (shared, agent, jobs) = (self.shared.clone(), self.agent.clone(), self.jobs.clone());
        std::thread::spawn(move || {
            let report = |stage, fraction, message: String| {
                progress(Progress { id: req.id.clone(), key: key.clone(), stage, fraction, message })
            };
            let result = run_job(&shared, &agent, &index, &req, &key, &job, &report);
            jobs.lock().unwrap().remove(&key);
            match result {
                Ok(()) => report(Stage::Done, Some(1.0), "Ready".into()),
                Err(_) if job.cancel.load(Ordering::Relaxed) => {
                    report(Stage::Cancelled, None, "Cancelled".into())
                }
                Err(e) => report(Stage::Error, None, format!("{e:#}")),
            }
        });
        Ok(())
    }

    pub fn cancel(&self, key: &str) {
        if let Some(job) = self.jobs.lock().unwrap().get(key) {
            job.cancel.store(true, Ordering::Relaxed);
            if let Some(c) = job.child.lock().unwrap().as_mut() {
                let _ = c.kill();
            }
        }
    }

    pub fn delete(&self, key: &str) -> Result<()> {
        if !regions::valid_key(key) {
            bail!("invalid region key");
        }
        if self.is_downloading(key) {
            bail!("cancel the download first");
        }
        self.shared.forget(key);
        let dir = regions::region_dir(&self.shared.root, key);
        if dir.exists() {
            fs::remove_dir_all(dir)?;
        }
        Ok(())
    }
}

fn run_job(
    shared: &server::Shared,
    agent: &ureq::Agent,
    index: &regions::Index,
    req: &DownloadRequest,
    key: &str,
    job: &Job,
    report: &dyn Fn(Stage, Option<f64>, String),
) -> Result<()> {
    let root = &shared.root;
    let region = index.get(&req.id).ok_or_else(|| anyhow!("unknown region {}", req.id))?;
    let dir = regions::region_dir(root, key);
    fs::create_dir_all(&dir)?;
    let mut meta = regions::read_meta(root, key).unwrap_or_else(|| RegionMeta {
        id: region.id.clone(),
        key: key.to_string(),
        name: region.name.clone(),
        bbox: region.bbox,
        basemap: None,
        obstacles: None,
        updated: 0,
    });
    let cancelled = || job.cancel.load(Ordering::Relaxed);

    if req.basemap {
        report(Stage::Preparing, None, "Fetching the pmtiles tool".into());
        let cli = download::ensure_pmtiles_cli(root, agent)?;
        let build = download::latest_protomaps_build(agent)?;
        let outline = dir.join("region.geojson");
        let geojson = index.outline(&req.id).ok_or_else(|| anyhow!("region has no outline"))?;
        fs::write(&outline, serde_json::to_vec(&geojson)?)?;
        if cancelled() {
            bail!("cancelled");
        }
        report(Stage::Basemap, Some(0.0), format!("Cutting basemap from Protomaps build {build}"));
        let part = dir.join("basemap.pmtiles.part");
        let max_zoom = req.max_zoom.clamp(6, 15);
        download::extract_basemap(
            &cli,
            &build,
            &outline,
            &part,
            max_zoom,
            &job.child,
            &job.cancel,
            throttled(|f, line| report(Stage::Basemap, f, line.to_string())),
        )?;
        shared.forget(key);
        let dest = dir.join("basemap.pmtiles");
        fs::rename(&part, &dest)?;
        meta.basemap = Some(BasemapMeta { build, max_zoom, bytes: fs::metadata(&dest)?.len() });
        meta.updated = now();
        regions::write_meta(root, &meta)?;
    }

    if req.obstacles {
        let pbf = dir.join("source.osm.pbf");
        report(Stage::Pbf, Some(0.0), format!("Downloading {}", region.pbf_url));
        let mut tick = throttled(|f, m: &str| report(Stage::Pbf, f, m.to_string()));
        download::download_to(agent, &region.pbf_url, &pbf, &job.cancel, |done, total| {
            let f = total.map(|t| done as f64 / t as f64);
            tick(f, &format!("Downloading OSM data: {} MB", done >> 20));
        })?;
        report(Stage::Obstacles, None, "Finding masts, towers, power lines and airfields".into());
        let result = obstacles::extract(&pbf, &job.cancel);
        let _ = fs::remove_file(&pbf);
        let set = result?;
        shared.forget(key);
        let out = dir.join("obstacles.json");
        fs::write(&out, serde_json::to_vec(&set)?)?;
        meta.obstacles = Some(ObstacleMeta { count: set.obstacles.len(), bytes: fs::metadata(&out)?.len() });
        meta.updated = now();
        regions::write_meta(root, &meta)?;
    }
    Ok(())
}

/// Wrap a progress callback so it fires at most a few times per second.
fn throttled<F: FnMut(Option<f64>, &str)>(mut f: F) -> impl FnMut(Option<f64>, &str) {
    let mut last = None::<Instant>;
    move |frac, msg| {
        if last.is_some_and(|t| t.elapsed().as_millis() < 250) {
            return;
        }
        last = Some(Instant::now());
        f(frac, msg)
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
