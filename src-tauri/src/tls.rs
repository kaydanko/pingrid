//! Direct TLS handshake inspection: reads the leaf certificate's validity
//! window and issuer without any external API.
//!
//! The handshake always completes (even for expired or self-signed certs) so
//! we can report *how* a certificate is broken. Real WebPKI validation still
//! runs; its verdict is recorded in `chain_valid` / `validation_error`.

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::crypto::{ring, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, Error as TlsError, RootCertStore, SignatureScheme};
use serde::Serialize;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_rustls::TlsConnector;
use x509_parser::extensions::GeneralName;
use x509_parser::prelude::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SslInfo {
    /// Unix milliseconds.
    pub not_before: i64,
    /// Unix milliseconds.
    pub not_after: i64,
    pub issuer: String,
    pub issuer_org: Option<String>,
    pub subject: String,
    pub sans: Vec<String>,
    pub serial: String,
    pub chain_valid: bool,
    pub validation_error: Option<String>,
    pub protocol: Option<String>,
}

fn provider() -> Arc<CryptoProvider> {
    static P: OnceLock<Arc<CryptoProvider>> = OnceLock::new();
    P.get_or_init(|| Arc::new(ring::default_provider())).clone()
}

fn webpki_verifier() -> Arc<WebPkiServerVerifier> {
    static V: OnceLock<Arc<WebPkiServerVerifier>> = OnceLock::new();
    V.get_or_init(|| {
        let roots = RootCertStore {
            roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
        };
        WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider())
            .build()
            .expect("failed to build WebPKI verifier")
    })
    .clone()
}

/// Runs real verification, records the outcome, then lets the handshake proceed.
#[derive(Debug)]
struct RecordingVerifier {
    inner: Arc<WebPkiServerVerifier>,
    verdict: Mutex<Option<Result<(), String>>>,
}

impl ServerCertVerifier for RecordingVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        let verdict = self
            .inner
            .verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
            .map(|_| ())
            .map_err(|e| e.to_string());
        *self.verdict.lock().unwrap() = Some(verdict);
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

fn first_attr<'a>(mut it: impl Iterator<Item = &'a AttributeTypeAndValue<'a>>) -> Option<String> {
    it.next().and_then(|a| a.as_str().ok()).map(str::to_owned)
}

#[tauri::command]
pub async fn inspect_tls(host: String, port: Option<u16>, timeout_ms: Option<u64>) -> Result<SslInfo, String> {
    let port = port.unwrap_or(443);
    let limit = Duration::from_millis(timeout_ms.unwrap_or(10_000).clamp(1_000, 60_000));
    let host = host.trim().trim_start_matches('[').trim_end_matches(']').to_owned();

    let verifier = Arc::new(RecordingVerifier {
        inner: webpki_verifier(),
        verdict: Mutex::new(None),
    });
    let config = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(verifier.clone())
        .with_no_client_auth();
    let connector = TlsConnector::from(Arc::new(config));
    let server_name = ServerName::try_from(host.clone()).map_err(|e| format!("invalid host: {e}"))?;

    let tcp = timeout(limit, TcpStream::connect((host.as_str(), port)))
        .await
        .map_err(|_| "TCP connect timeout".to_string())?
        .map_err(|e| format!("TCP connect failed: {e}"))?;
    let stream = timeout(limit, connector.connect(server_name, tcp))
        .await
        .map_err(|_| "TLS handshake timeout".to_string())?
        .map_err(|e| format!("TLS handshake failed: {e}"))?;

    let (_, conn) = stream.get_ref();
    let protocol = conn.protocol_version().map(|v| format!("{v:?}"));
    let leaf = conn
        .peer_certificates()
        .and_then(|c| c.first())
        .ok_or_else(|| "server sent no certificate".to_string())?;

    let (_, cert) = parse_x509_certificate(leaf.as_ref()).map_err(|e| format!("certificate parse error: {e}"))?;
    let validity = cert.validity();
    let issuer = cert.issuer();
    let subject = cert.subject();

    let issuer_cn = first_attr(issuer.iter_common_name());
    let issuer_org = first_attr(issuer.iter_organization());
    let subject_cn = first_attr(subject.iter_common_name()).unwrap_or_default();

    let sans = match cert.subject_alternative_name() {
        Ok(Some(ext)) => ext
            .value
            .general_names
            .iter()
            .filter_map(|n| match n {
                GeneralName::DNSName(d) => Some((*d).to_owned()),
                _ => None,
            })
            .take(50)
            .collect(),
        _ => Vec::new(),
    };

    let verdict = verifier.verdict.lock().unwrap().clone();
    let (chain_valid, validation_error) = match verdict {
        Some(Ok(())) => (true, None),
        Some(Err(e)) => (false, Some(e)),
        None => (false, Some("certificate was not verified".into())),
    };

    Ok(SslInfo {
        not_before: validity.not_before.timestamp() * 1000,
        not_after: validity.not_after.timestamp() * 1000,
        issuer: issuer_cn.clone().or_else(|| issuer_org.clone()).unwrap_or_else(|| issuer.to_string()),
        issuer_org,
        subject: subject_cn,
        sans,
        serial: cert.raw_serial_as_string(),
        chain_valid,
        validation_error,
        protocol,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Network tests: run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn reads_valid_certificate() {
        let info = inspect_tls("letsencrypt.org".into(), None, None).await.unwrap();
        assert!(info.chain_valid, "{:?}", info.validation_error);
        assert!(info.not_after > info.not_before);
        assert_eq!(info.issuer_org.as_deref(), Some("Let's Encrypt"));
    }

    #[tokio::test]
    #[ignore]
    async fn reports_expired_certificate_without_failing() {
        let info = inspect_tls("expired.badssl.com".into(), None, None).await.unwrap();
        assert!(!info.chain_valid);
        assert!(info.validation_error.unwrap_or_default().to_lowercase().contains("expired"));
        assert!(info.not_after < 1_700_000_000_000);
    }
}
