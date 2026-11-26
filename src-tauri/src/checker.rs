//! HTTP health checks and outbound alert delivery (Telegram / webhooks).
//! Running these in Rust sidesteps browser CORS entirely.

use serde::Serialize;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const USER_AGENT: &str = concat!("Pingrid/", env!("CARGO_PKG_VERSION"), " (uptime monitor; +https://syntrope.app)");

/// Client used for health checks: no idle pooling, so every check pays the
/// real DNS + TCP + TLS cost and the reported latency is honest.
fn check_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .pool_max_idle_per_host(0)
            .redirect(reqwest::redirect::Policy::limited(8))
            .build()
            .expect("failed to build HTTP client")
    })
}

/// Client for alert delivery: pooled, it is not timing-sensitive.
fn delivery_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(15))
            .build()
            .expect("failed to build HTTP client")
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpCheck {
    pub ok: bool,
    pub status: Option<u16>,
    pub latency_ms: u64,
    pub error: Option<String>,
    pub final_url: Option<String>,
}

/// Wrapper messages from hyper/reqwest that carry no information of their own.
fn is_generic(msg: &str) -> bool {
    msg.starts_with("client error") || msg.starts_with("error sending request") || msg.starts_with("error trying to connect")
}

/// Human-readable failure, most specific cause first.
///
/// reqwest's own message ("error sending request for url (…)") says nothing a
/// tile can use and repeats the URL; the cause ("invalid peer certificate:
/// Expired", "dns error: …", "Connection refused") sits at the end of the
/// source chain. Tiles truncate, so the cause has to come first.
fn describe(err: &reqwest::Error) -> String {
    let mut chain: Vec<String> = Vec::new();
    let mut src = std::error::Error::source(err);
    while let Some(s) = src {
        let part = s.to_string();
        if !part.is_empty() && !chain.iter().any(|c| c.contains(&part)) {
            chain.push(part);
        }
        src = s.source();
    }
    let cause = match chain.as_slice() {
        [] => err.to_string(),
        // The innermost cause, plus its immediate context when that adds
        // something ("dns error" + "failed to lookup address information").
        [.., ctx, last] if !last.contains(ctx.as_str()) && ctx.len() < 40 && !is_generic(ctx) => format!("{ctx}: {last}"),
        [.., last] => last.clone(),
    };
    if err.is_timeout() {
        format!("timeout: {cause}")
    } else {
        cause
    }
}

/// Diagnostics: with `PINGRID_LOG_CHECKS=1` every check is printed to stderr
/// with a wall-clock timestamp, to see how often checks really run (for
/// example while the window is minimised).
fn log_check(url: &str, result: &Result<reqwest::Response, reqwest::Error>, latency_ms: u64) {
    static ON: OnceLock<bool> = OnceLock::new();
    if !*ON.get_or_init(|| std::env::var_os("PINGRID_LOG_CHECKS").is_some()) {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let outcome = match result {
        Ok(r) => r.status().as_u16().to_string(),
        Err(_) => "error".into(),
    };
    eprintln!("[pingrid] check {now} {url} {outcome} {latency_ms}ms");
}

/// GET the URL and measure time-to-response-headers.
/// `ok` is true for any status below 400 (redirects are followed).
#[tauri::command]
pub async fn check_http(url: String, timeout_ms: Option<u64>) -> HttpCheck {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(10_000).clamp(1_000, 60_000));
    let started = Instant::now();
    let result = check_client()
        .get(&url)
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .timeout(timeout)
        .send()
        .await;
    let latency_ms = started.elapsed().as_millis() as u64;
    log_check(&url, &result, latency_ms);
    match result {
        Ok(resp) => {
            let status = resp.status();
            HttpCheck {
                ok: status.as_u16() < 400,
                status: Some(status.as_u16()),
                latency_ms,
                error: if status.as_u16() < 400 {
                    None
                } else {
                    Some(format!("HTTP {}", status))
                },
                final_url: Some(resp.url().to_string()),
            }
            // Body is dropped unread; we only care about reachability.
        }
        Err(e) => HttpCheck {
            ok: false,
            status: e.status().map(|s| s.as_u16()),
            latency_ms,
            error: Some(describe(&e)),
            final_url: None,
        },
    }
}

/// POST a JSON body (generic webhooks: Slack, Discord, custom).
#[tauri::command]
pub async fn post_json(url: String, body: serde_json::Value) -> Result<u16, String> {
    let resp = delivery_client()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| describe(&e))?;
    let status = resp.status();
    if status.is_success() {
        Ok(status.as_u16())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("HTTP {status}: {}", text.chars().take(300).collect::<String>()))
    }
}

/// POST an urlencoded form (Telegram Bot API `sendMessage`).
#[tauri::command]
pub async fn post_form(url: String, fields: Vec<(String, String)>) -> Result<u16, String> {
    let resp = delivery_client()
        .post(&url)
        .form(&fields)
        .send()
        .await
        .map_err(|e| describe(&e))?;
    let status = resp.status();
    if status.is_success() {
        Ok(status.as_u16())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("HTTP {status}: {}", text.chars().take(300).collect::<String>()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn online_and_offline() {
        let up = check_http("https://github.com".into(), Some(10_000)).await;
        assert!(up.ok, "{:?}", up.error);
        let down = check_http("https://pingrid-demo.invalid".into(), Some(5_000)).await;
        assert!(!down.ok);
        let err = down.error.unwrap();
        println!("dns failure  -> {err}");
        assert!(!err.starts_with("error sending request"), "{err}");
        let cert = check_http("https://expired.badssl.com".into(), Some(30_000)).await;
        let err = cert.error.unwrap();
        println!("expired cert -> {err}");
        assert!(err.to_lowercase().contains("expired"), "{err}");
    }
}
