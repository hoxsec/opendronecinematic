//! Minimal reader for PMTiles v3 archives (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md):
//! enough to look up single tiles by z/x/y for the local tile server.

use anyhow::{bail, Context, Result};
use flate2::read::GzDecoder;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;

const HEADER_LEN: usize = 127;
const MAX_CACHED_LEAVES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Compression {
    Unknown,
    None,
    Gzip,
    Brotli,
    Zstd,
}

impl Compression {
    fn from_byte(b: u8) -> Self {
        match b {
            1 => Self::None,
            2 => Self::Gzip,
            3 => Self::Brotli,
            4 => Self::Zstd,
            _ => Self::Unknown,
        }
    }

    /// Value for an HTTP Content-Encoding header, if the tiles are stored compressed.
    pub fn content_encoding(self) -> Option<&'static str> {
        match self {
            Self::Gzip => Some("gzip"),
            Self::Brotli => Some("br"),
            Self::Zstd => Some("zstd"),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Header {
    pub root_offset: u64,
    pub root_length: u64,
    pub metadata_offset: u64,
    pub metadata_length: u64,
    pub leaf_offset: u64,
    pub tile_data_offset: u64,
    pub internal_compression: Compression,
    pub tile_compression: Compression,
    /// 1 = MVT, 2 = PNG, 3 = JPEG, 4 = WebP, 5 = AVIF.
    pub tile_type: u8,
    pub min_zoom: u8,
    pub max_zoom: u8,
    /// [west, south, east, north] in degrees.
    pub bounds: [f64; 4],
    pub center: [f64; 3],
}

#[derive(Debug, Clone, Copy)]
struct Entry {
    tile_id: u64,
    offset: u64,
    length: u32,
    run_length: u32,
}

pub struct Archive {
    file: Mutex<File>,
    pub header: Header,
    root: Vec<Entry>,
    leaves: Mutex<HashMap<u64, Vec<Entry>>>,
}

impl Archive {
    pub fn open(path: &Path) -> Result<Self> {
        let mut file = File::open(path).with_context(|| format!("opening {}", path.display()))?;
        let mut buf = [0u8; HEADER_LEN];
        file.read_exact(&mut buf).context("reading PMTiles header")?;
        let header = parse_header(&buf)?;
        let archive = Self {
            file: Mutex::new(file),
            root: Vec::new(),
            leaves: Mutex::new(HashMap::new()),
            header,
        };
        let root = archive.directory(archive.header.root_offset, archive.header.root_length)?;
        Ok(Self { root, ..archive })
    }

    /// The archive's JSON metadata (layer list, attribution, ...).
    pub fn metadata(&self) -> Result<String> {
        let raw = self.read(self.header.metadata_offset, self.header.metadata_length)?;
        let bytes = decompress(raw, self.header.internal_compression)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// The stored (possibly compressed) bytes of a tile, or None if the archive has no such tile.
    pub fn tile(&self, z: u8, x: u32, y: u32) -> Result<Option<Vec<u8>>> {
        if z < self.header.min_zoom || z > self.header.max_zoom || z > 31 {
            return Ok(None);
        }
        let n = 1u64 << z;
        if x as u64 >= n || y as u64 >= n {
            return Ok(None);
        }
        let id = zxy_to_tile_id(z, x, y);
        let mut dir_offset = None::<(u64, u32)>;
        // The spec allows at most three levels of leaf directories.
        for _ in 0..4 {
            let found = match dir_offset {
                None => find(&self.root, id),
                Some((off, len)) => {
                    let off = self.header.leaf_offset + off;
                    let mut cache = self.leaves.lock().unwrap();
                    if !cache.contains_key(&off) {
                        drop(cache);
                        let dir = self.directory(off, len as u64)?;
                        cache = self.leaves.lock().unwrap();
                        if cache.len() >= MAX_CACHED_LEAVES {
                            cache.clear();
                        }
                        cache.insert(off, dir);
                    }
                    find(&cache[&off], id)
                }
            };
            let Some(e) = found else { return Ok(None) };
            if e.run_length == 0 {
                dir_offset = Some((e.offset, e.length));
                continue;
            }
            let data = self.read(self.header.tile_data_offset + e.offset, e.length as u64)?;
            return Ok(Some(data));
        }
        bail!("PMTiles directory nesting too deep")
    }

    /// Raw bytes [start, start + len) of the archive file, for HTTP range requests.
    pub fn read(&self, start: u64, len: u64) -> Result<Vec<u8>> {
        let mut f = self.file.lock().unwrap();
        f.seek(SeekFrom::Start(start))?;
        let mut buf = vec![0u8; len as usize];
        f.read_exact(&mut buf)?;
        Ok(buf)
    }

    fn directory(&self, offset: u64, length: u64) -> Result<Vec<Entry>> {
        let raw = self.read(offset, length)?;
        parse_directory(&decompress(raw, self.header.internal_compression)?)
    }
}

fn parse_header(b: &[u8; HEADER_LEN]) -> Result<Header> {
    if &b[0..7] != b"PMTiles" {
        bail!("not a PMTiles archive");
    }
    if b[7] != 3 {
        bail!("unsupported PMTiles version {}", b[7]);
    }
    let u64_at = |i: usize| u64::from_le_bytes(b[i..i + 8].try_into().unwrap());
    let deg_at = |i: usize| i32::from_le_bytes(b[i..i + 4].try_into().unwrap()) as f64 / 1e7;
    Ok(Header {
        root_offset: u64_at(8),
        root_length: u64_at(16),
        metadata_offset: u64_at(24),
        metadata_length: u64_at(32),
        leaf_offset: u64_at(40),
        tile_data_offset: u64_at(56),
        internal_compression: Compression::from_byte(b[97]),
        tile_compression: Compression::from_byte(b[98]),
        tile_type: b[99],
        min_zoom: b[100],
        max_zoom: b[101],
        bounds: [deg_at(102), deg_at(106), deg_at(110), deg_at(114)],
        center: [deg_at(119), deg_at(123), b[118] as f64],
    })
}

fn decompress(raw: Vec<u8>, c: Compression) -> Result<Vec<u8>> {
    match c {
        Compression::None | Compression::Unknown => Ok(raw),
        Compression::Gzip => {
            let mut out = Vec::new();
            GzDecoder::new(&raw[..]).read_to_end(&mut out)?;
            Ok(out)
        }
        other => bail!("unsupported PMTiles internal compression {other:?}"),
    }
}

fn parse_directory(b: &[u8]) -> Result<Vec<Entry>> {
    let mut pos = 0usize;
    let mut next = || -> Result<u64> {
        let mut v = 0u64;
        let mut shift = 0;
        loop {
            let Some(&byte) = b.get(pos) else { bail!("truncated PMTiles directory") };
            pos += 1;
            v |= ((byte & 0x7f) as u64) << shift;
            if byte & 0x80 == 0 {
                return Ok(v);
            }
            shift += 7;
            if shift > 63 {
                bail!("bad varint in PMTiles directory");
            }
        }
    };
    let n = next()? as usize;
    let mut entries = vec![Entry { tile_id: 0, offset: 0, length: 0, run_length: 0 }; n];
    let mut last = 0u64;
    for e in entries.iter_mut() {
        last += next()?;
        e.tile_id = last;
    }
    for e in entries.iter_mut() {
        e.run_length = next()? as u32;
    }
    for e in entries.iter_mut() {
        e.length = next()? as u32;
    }
    for i in 0..n {
        let v = next()?;
        entries[i].offset = if v == 0 && i > 0 {
            entries[i - 1].offset + entries[i - 1].length as u64
        } else {
            v.saturating_sub(1)
        };
    }
    Ok(entries)
}

/// The entry covering `id`: the last one at or before it, if its run (or leaf) reaches it.
fn find(entries: &[Entry], id: u64) -> Option<Entry> {
    let i = entries.partition_point(|e| e.tile_id <= id);
    let e = *entries.get(i.checked_sub(1)?)?;
    if e.run_length == 0 || id < e.tile_id + e.run_length as u64 {
        Some(e)
    } else {
        None
    }
}

/// Position of a tile on the Hilbert curve, counting all tiles of lower zoom levels first.
pub fn zxy_to_tile_id(z: u8, x: u32, y: u32) -> u64 {
    let mut acc: u64 = ((1u64 << (2 * z as u64)) - 1) / 3;
    let (mut x, mut y) = (x as u64, y as u64);
    let mut s = if z == 0 { 0 } else { 1u64 << (z - 1) };
    while s > 0 {
        let rx = s & x;
        let ry = s & y;
        acc += ((3 * rx) ^ ry) * s;
        if ry == 0 {
            if rx != 0 {
                x = s.wrapping_sub(1).wrapping_sub(x);
                y = s.wrapping_sub(1).wrapping_sub(y);
            }
            std::mem::swap(&mut x, &mut y);
        }
        s >>= 1;
    }
    acc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hilbert_ids_match_the_spec() {
        assert_eq!(zxy_to_tile_id(0, 0, 0), 0);
        assert_eq!(zxy_to_tile_id(1, 0, 0), 1);
        assert_eq!(zxy_to_tile_id(1, 0, 1), 2);
        assert_eq!(zxy_to_tile_id(1, 1, 1), 3);
        assert_eq!(zxy_to_tile_id(1, 1, 0), 4);
        assert_eq!(zxy_to_tile_id(2, 0, 0), 5);
        // Value from the reference implementation's test suite.
        assert_eq!(zxy_to_tile_id(12, 3423, 1763), 19078479);
    }

    #[test]
    fn finds_runs_and_leaves() {
        let e = |tile_id, run_length| Entry { tile_id, offset: 0, length: 1, run_length };
        let dir = [e(0, 1), e(5, 3), e(20, 0)];
        assert_eq!(find(&dir, 0).unwrap().tile_id, 0);
        assert!(find(&dir, 1).is_none());
        assert_eq!(find(&dir, 7).unwrap().tile_id, 5);
        assert!(find(&dir, 8).is_none());
        assert_eq!(find(&dir, 999).unwrap().tile_id, 20);
    }
}
