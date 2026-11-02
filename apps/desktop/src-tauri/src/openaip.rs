use std::io::Read;
use std::time::Duration;

const MAX_BYTES: u64 = 10 * 1024 * 1024;

fn export_url(country: &str) -> Result<String, String> {
    if country.len() != 2 || !country.bytes().all(|c| c.is_ascii_alphabetic()) {
        return Err("Expected a two-letter country code.".into());
    }
    Ok(format!(
        "https://storage.openaip.net/openaip-system-exports/{}_asp.geojson",
        country.to_ascii_lowercase()
    ))
}

// Fixed origin/path, no credentials or redirects; not a general-purpose HTTP proxy.
#[tauri::command]
pub async fn download_openaip_airspace(country: String) -> Result<String, String> {
    let url = export_url(&country)?;
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(60))
            .redirects(0)
            .build();
        let response = agent.get(&url).call().map_err(|e| match e {
            ureq::Error::Status(404, _) => {
                "No OpenAIP airspace export is available for this country.".to_string()
            }
            ureq::Error::Status(429, _) => {
                "OpenAIP rate limit reached. Wait before trying again.".to_string()
            }
            _ => format!("OpenAIP download failed: {e}"),
        })?;
        if response.status() != 200 {
            return Err(format!(
                "Unexpected OpenAIP HTTP status: {}",
                response.status()
            ));
        }
        if response
            .header("Content-Length")
            .and_then(|v| v.parse::<u64>().ok())
            .is_some_and(|n| n > MAX_BYTES)
        {
            return Err("OpenAIP export exceeds the 10 MB limit.".into());
        }
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| format!("OpenAIP download failed: {e}"))?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("OpenAIP export exceeds the 10 MB limit.".into());
        }
        String::from_utf8(bytes).map_err(|_| "OpenAIP export is not UTF-8.".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::export_url;

    #[test]
    fn only_country_export_paths_are_allowed() {
        assert_eq!(
            export_url("AT").unwrap(),
            "https://storage.openaip.net/openaip-system-exports/at_asp.geojson"
        );
        for value in ["", "a", "aut", "../", "https://example.com", "é", "12"] {
            assert!(export_url(value).is_err());
        }
    }
}
