// Authentication module for Google Cloud service account token generation
//
// This module handles automatic token refresh using service account JSON key files.
// The key file is expected at ~/.gemini-workbench/vertex-key.json

use base64::{engine::general_purpose::URL_SAFE_NO_PAD as BASE64_URL, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// Service account JSON key structure
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct ServiceAccountKey {
    #[serde(rename = "type")]
    pub key_type: String,
    pub project_id: String,
    pub private_key_id: String,
    pub private_key: String,
    pub client_email: String,
    pub client_id: String,
    pub auth_uri: String,
    pub token_uri: String,
}

/// Cached access token with expiration
#[derive(Debug, Clone)]
struct CachedToken {
    token: String,
    expires_at: u64, // Unix timestamp
}

lazy_static::lazy_static! {
    static ref TOKEN_CACHE: RwLock<Option<CachedToken>> = RwLock::new(None);
}

const TOKEN_EXPIRY_BUFFER: u64 = 300; // 5 minutes buffer before actual expiry
const VERTEX_KEY_FILENAME: &str = "vertex-key.json";

/// Get the path to the service account key file
pub fn get_key_file_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".gemini-workbench")
        .join(VERTEX_KEY_FILENAME)
}

/// Check if a service account key file exists
pub fn has_service_account_key() -> bool {
    get_key_file_path().exists()
}

/// Load the service account key from the default location
pub fn load_service_account_key() -> Result<ServiceAccountKey, String> {
    let key_path = get_key_file_path();
    
    if !key_path.exists() {
        return Err(format!(
            "Service account key not found at {}. Run scripts/setup-vertex-sa.sh to create one.",
            key_path.display()
        ));
    }
    
    let key_content = std::fs::read_to_string(&key_path)
        .map_err(|e| format!("Failed to read key file: {}", e))?;
    
    let key: ServiceAccountKey = serde_json::from_str(&key_content)
        .map_err(|e| format!("Failed to parse key file: {}", e))?;
    
    if key.key_type != "service_account" {
        return Err("Invalid key file: expected type 'service_account'".to_string());
    }
    
    Ok(key)
}

/// Get a valid access token, refreshing if necessary
pub async fn get_access_token() -> Result<String, String> {
    // Check cache first
    {
        let cache = TOKEN_CACHE.read().map_err(|e| e.to_string())?;
        if let Some(ref cached) = *cache {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs();
            
            if cached.expires_at > now + TOKEN_EXPIRY_BUFFER {
                return Ok(cached.token.clone());
            }
        }
    }
    
    // Need to refresh token
    let key = load_service_account_key()?;
    let token = exchange_for_access_token(&key).await?;
    
    Ok(token)
}

/// JWT Header
#[derive(Serialize)]
struct JwtHeader {
    alg: String,
    typ: String,
}

/// JWT Claims for Google OAuth
#[derive(Serialize)]
struct JwtClaims {
    iss: String,
    scope: String,
    aud: String,
    iat: u64,
    exp: u64,
}

/// Token response from Google OAuth
#[derive(Deserialize)]
#[allow(dead_code)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    token_type: String,
}

/// Exchange service account credentials for an access token
async fn exchange_for_access_token(key: &ServiceAccountKey) -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    // Create JWT
    let header = JwtHeader {
        alg: "RS256".to_string(),
        typ: "JWT".to_string(),
    };
    
    let claims = JwtClaims {
        iss: key.client_email.clone(),
        scope: "https://www.googleapis.com/auth/cloud-platform".to_string(),
        aud: key.token_uri.clone(),
        iat: now,
        exp: now + 3600, // 1 hour
    };
    
    let header_b64 = BASE64_URL.encode(serde_json::to_string(&header).unwrap());
    let claims_b64 = BASE64_URL.encode(serde_json::to_string(&claims).unwrap());
    let signing_input = format!("{}.{}", header_b64, claims_b64);
    
    // Sign with RSA-SHA256
    let signature = sign_rs256(&signing_input, &key.private_key)?;
    let signature_b64 = BASE64_URL.encode(&signature);
    
    let jwt = format!("{}.{}", signing_input, signature_b64);
    
    // Exchange JWT for access token
    let client = Client::new();
    let response = client
        .post(&key.token_uri)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", &jwt),
        ])
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed ({}): {}", status, body));
    }
    
    let token_response: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;
    
    // Cache the token
    {
        let mut cache = TOKEN_CACHE.write().map_err(|e| e.to_string())?;
        *cache = Some(CachedToken {
            token: token_response.access_token.clone(),
            expires_at: now + token_response.expires_in,
        });
    }
    
    Ok(token_response.access_token)
}

/// Sign data using RS256 (RSA-SHA256)
fn sign_rs256(data: &str, private_key_pem: &str) -> Result<Vec<u8>, String> {
    // Parse the PEM private key
    let private_key_pem = private_key_pem
        .replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
        .replace("-----BEGIN RSA PRIVATE KEY-----", "")
        .replace("-----END RSA PRIVATE KEY-----", "")
        .replace('\n', "")
        .replace('\r', "")
        .replace(' ', "");
    
    let key_der = base64::engine::general_purpose::STANDARD
        .decode(&private_key_pem)
        .map_err(|e| format!("Failed to decode private key: {}", e))?;
    
    // Use ring for RSA signing
    use ring::signature::{RsaKeyPair, RSA_PKCS1_SHA256};
    use ring::rand::SystemRandom;
    
    let key_pair = RsaKeyPair::from_pkcs8(&key_der)
        .or_else(|_| RsaKeyPair::from_der(&key_der))
        .map_err(|e| format!("Failed to parse private key: {}", e))?;
    
    let rng = SystemRandom::new();
    let mut signature = vec![0u8; key_pair.public().modulus_len()];
    
    key_pair
        .sign(&RSA_PKCS1_SHA256, &rng, data.as_bytes(), &mut signature)
        .map_err(|e| format!("Failed to sign: {}", e))?;
    
    Ok(signature)
}

/// Get the project ID from the service account key
pub fn get_project_id_from_key() -> Option<String> {
    load_service_account_key().ok().map(|k| k.project_id)
}
