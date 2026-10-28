//! Download a region and serve it, without the desktop app:
//! `cargo run -p odc-localdata --example serve -- <data dir> [geofabrik id]`

use odc_localdata::{DownloadRequest, LocalData, Stage};
use std::sync::mpsc;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let root = args.next().expect("usage: serve <data dir> [geofabrik id]");
    let data = LocalData::start(root.into())?;
    println!("serving on {}", data.base_url());
    if let Some(id) = args.next() {
        let (tx, rx) = mpsc::channel();
        data.download(DownloadRequest { id, basemap: true, obstacles: true, max_zoom: 15 }, move |p| {
            let _ = tx.send(p);
        })?;
        for p in rx {
            println!("[{:?}] {:?} {}", p.stage, p.fraction.map(|f| (f * 100.0).round()), p.message);
            if matches!(p.stage, Stage::Done | Stage::Error | Stage::Cancelled) {
                break;
            }
        }
    }
    println!("regions: {:?}", data.regions().iter().map(|r| &r.key).collect::<Vec<_>>());
    std::thread::park();
    Ok(())
}
