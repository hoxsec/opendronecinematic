//! HTTP downloads with progress, the go-pmtiles CLI, and cutting a region out of the Protomaps
//! planet build with it.

use anyhow::{anyhow, bail, Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const PMTILES_RELEASE: &str = "https://api.github.com/repos/protomaps/go-pmtiles/releases/latest";
const PROTOMAPS_BUILDS: &str = "https://build-metadata.protomaps.dev/builds.json";
const PROTOMAPS_BASE: &str = "https://build.protomaps.com";

pub(crate) fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .user_agent(concat!("OpenDroneCinematic/", env!("CARGO_PKG_VERSION")))
        .timeout_connect(Duration::from_secs(30))
        .timeout_read(Duration::from_secs(120))
        .build()
}

pub(crate) fn get_json(agent: &ureq::Agent, url: &str) -> Result<Value> {
    let resp = agent
        .get(url)
        .set("Accept", "application/json")
        .call()
        .map_err(|e| anyhow!("{url}: {e}"))?;
    let mut s = String::new();
    resp.into_reader().read_to_string(&mut s)?;
    Ok(serde_json::from_str(&s)?)
}

/// Size of a remote file from a HEAD request, if the server reports it.
pub(crate) fn remote_size(agent: &ureq::Agent, url: &str) -> Result<Option<u64>> {
    let resp = agent.head(url).call().map_err(|e| anyhow!("{url}: {e}"))?;
    Ok(resp.header("Content-Length").and_then(|v| v.parse().ok()))
}

/// Stream `url` to `dest` (via a .part file), reporting (bytes so far, total).
pub(crate) fn download_to(
    agent: &ureq::Agent,
    url: &str,
    dest: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, Option<u64>),
) -> Result<()> {
    let resp = agent.get(url).call().map_err(|e| anyhow!("{url}: {e}"))?;
    let total = resp.header("Content-Length").and_then(|v| v.parse().ok());
    let part = dest.with_extension("part");
    let mut out = File::create(&part)?;
    let mut reader = resp.into_reader();
    let mut buf = vec![0u8; 1 << 20];
    let mut done = 0u64;
    let result = (|| -> Result<()> {
        loop {
            if cancel.load(Ordering::Relaxed) {
                bail!("cancelled");
            }
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])?;
            done += n as u64;
            progress(done, total);
        }
        out.flush()?;
        Ok(())
    })();
    drop(out);
    if let Err(e) = result {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    if total.is_some_and(|t| t != done) {
        let _ = fs::remove_file(&part);
        bail!("download of {url} was cut short");
    }
    fs::rename(&part, dest)?;
    Ok(())
}

/// Path of the go-pmtiles CLI, downloading the latest release for this platform on first use.
pub(crate) fn ensure_pmtiles_cli(root: &Path, agent: &ureq::Agent) -> Result<PathBuf> {
    let exe = root.join("bin").join(if cfg!(windows) { "pmtiles.exe" } else { "pmtiles" });
    if exe.exists() {
        return Ok(exe);
    }
    let release = get_json(agent, PMTILES_RELEASE).context("looking up go-pmtiles release")?;
    let assets = release["assets"].as_array().ok_or_else(|| anyhow!("release has no assets"))?;
    let os = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "Darwin",
        "linux" => "Linux",
        other => bail!("no go-pmtiles build for {other}"),
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "arm64",
        other => bail!("no go-pmtiles build for {other}"),
    };
    let name_of = |a: &Value| a["name"].as_str().unwrap_or_default().to_string();
    let asset = assets
        .iter()
        .find(|a| {
            let n = name_of(a);
            n.contains(os) && n.contains(arch) && (n.ends_with(".zip") || n.ends_with(".tar.gz"))
        })
        .ok_or_else(|| anyhow!("no go-pmtiles download for {os} {arch}"))?;
    let name = name_of(asset);
    let url = asset["browser_download_url"].as_str().ok_or_else(|| anyhow!("asset has no url"))?;

    let mut archive = Vec::new();
    agent
        .get(url)
        .call()
        .map_err(|e| anyhow!("{url}: {e}"))?
        .into_reader()
        .read_to_end(&mut archive)?;

    // Releases publish a checksums file; refuse a binary that doesn't match it.
    if let Some(sums) = assets.iter().find(|a| name_of(a).contains("checksums")) {
        let sums_url = sums["browser_download_url"].as_str().unwrap_or_default();
        let text = agent
            .get(sums_url)
            .call()
            .map_err(|e| anyhow!("{sums_url}: {e}"))?
            .into_string()?;
        let expected = text
            .lines()
            .find_map(|l| {
                let (hash, file) = l.split_once(char::is_whitespace)?;
                (file.trim() == name).then(|| hash.to_lowercase())
            })
            .ok_or_else(|| anyhow!("{name} is missing from the release checksums"))?;
        let actual: String =
            Sha256::digest(&archive).iter().map(|b| format!("{b:02x}")).collect();
        if actual != expected {
            bail!("checksum mismatch for {name}");
        }
    }

    let wanted = exe.file_name().unwrap().to_string_lossy().to_string();
    let binary = if name.ends_with(".zip") {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&archive))?;
        let idx = (0..zip.len())
            .find(|&i| {
                zip.by_index(i).is_ok_and(|f| {
                    Path::new(f.name()).file_name().is_some_and(|n| n.to_string_lossy() == wanted)
                })
            })
            .ok_or_else(|| anyhow!("{wanted} not found in {name}"))?;
        let mut out = Vec::new();
        zip.by_index(idx)?.read_to_end(&mut out)?;
        out
    } else {
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(&archive[..]));
        let mut found = None;
        for entry in tar.entries()? {
            let mut entry = entry?;
            if entry.path()?.file_name().is_some_and(|n| n.to_string_lossy() == wanted) {
                let mut out = Vec::new();
                entry.read_to_end(&mut out)?;
                found = Some(out);
                break;
            }
        }
        found.ok_or_else(|| anyhow!("{wanted} not found in {name}"))?
    };

    fs::create_dir_all(exe.parent().unwrap())?;
    let tmp = exe.with_extension("download");
    fs::write(&tmp, binary)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
    }
    fs::rename(&tmp, &exe)?;
    Ok(exe)
}

/// Date key of the newest Protomaps daily planet build, e.g. "20261028".
pub(crate) fn latest_protomaps_build(agent: &ureq::Agent) -> Result<String> {
    let builds = get_json(agent, PROTOMAPS_BUILDS)?;
    builds
        .as_array()
        .and_then(|b| b.iter().filter_map(|b| b["key"].as_str()).max())
        .map(|k| k.trim_end_matches(".pmtiles").to_string())
        .ok_or_else(|| anyhow!("no Protomaps builds listed"))
}

/// Run `pmtiles extract` against the remote planet build, reporting percentage and status lines.
pub(crate) fn extract_basemap(
    cli: &Path,
    build: &str,
    region: &Path,
    out: &Path,
    max_zoom: u8,
    child_slot: &Arc<Mutex<Option<Child>>>,
    cancel: &AtomicBool,
    mut progress: impl FnMut(Option<f64>, &str),
) -> Result<()> {
    let mut cmd = Command::new(cli);
    cmd.arg("extract")
        .arg(format!("{PROTOMAPS_BASE}/{build}.pmtiles"))
        .arg(out)
        .arg(format!("--region={}", region.display()))
        .arg(format!("--maxzoom={max_zoom}"))
        .arg("--download-threads=4")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().context("starting pmtiles")?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    *child_slot.lock().unwrap() = Some(child);

    // go-pmtiles logs to stderr and draws progress bars with carriage returns.
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let tx2 = tx.clone();
    let pump = move |r: Box<dyn Read + Send>, tx: std::sync::mpsc::Sender<String>| {
        std::thread::spawn(move || {
            let mut r = BufReader::new(r);
            let mut line = Vec::new();
            loop {
                let buf = match r.fill_buf() {
                    Ok(b) if !b.is_empty() => b.to_vec(),
                    _ => break,
                };
                r.consume(buf.len());
                for byte in buf {
                    if byte == b'\r' || byte == b'\n' {
                        if !line.is_empty() {
                            let _ = tx.send(String::from_utf8_lossy(&line).trim().to_string());
                            line.clear();
                        }
                    } else {
                        line.push(byte);
                    }
                }
            }
        })
    };
    let t1 = pump(Box::new(stdout), tx);
    let t2 = pump(Box::new(stderr), tx2);

    let mut last_lines: Vec<String> = Vec::new();
    for line in rx {
        if cancel.load(Ordering::Relaxed) {
            if let Some(c) = child_slot.lock().unwrap().as_mut() {
                let _ = c.kill();
            }
        }
        progress(parse_percent(&line), &line);
        last_lines.push(line);
        if last_lines.len() > 8 {
            last_lines.remove(0);
        }
    }
    let _ = (t1.join(), t2.join());
    let status = child_slot.lock().unwrap().take().map(|mut c| c.wait()).transpose()?;
    if cancel.load(Ordering::Relaxed) {
        let _ = fs::remove_file(out);
        bail!("cancelled");
    }
    if !status.is_some_and(|s| s.success()) {
        let _ = fs::remove_file(out);
        bail!("pmtiles extract failed: {}", last_lines.join(" | "));
    }
    Ok(())
}

/// The last "NN%" in a progress bar line, as a fraction.
fn parse_percent(line: &str) -> Option<f64> {
    let i = line.rfind('%')?;
    let digits: String = line[..i]
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    digits.parse::<f64>().ok().map(|p| (p / 100.0).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::parse_percent;

    #[test]
    fn reads_progress_bars() {
        assert_eq!(parse_percent("fetching chunks  42% |████      | (1/2 MB)"), Some(0.42));
        assert_eq!(parse_percent("100%"), Some(1.0));
        assert_eq!(parse_percent("fetching 3 dirs"), None);
    }
}
