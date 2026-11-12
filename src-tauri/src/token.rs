//! Engine access token: 32 bytes from the OS secure random source (M5).
//! Kept free of Tauri so its tests run as a plain binary (tests/token_rng.rs).

use std::time::Duration;

/// How many times to ask the OS for random bytes before giving up (M5).
pub const TOKEN_RNG_ATTEMPTS: u32 = 4;

/// 32 random bytes from the operating system's secure random source, as hex.
///
/// Returns `None` if the source keeps failing. There is deliberately no weaker
/// fallback (the old one was time + process ID, which can be guessed): without
/// a secure token the engine must not start (M5).
pub fn generate_secure_token() -> Option<String> {
    generate_token_with(|buf| getrandom::fill(buf).is_ok(), Duration::from_millis(250))
}

pub fn generate_token_with<F: FnMut(&mut [u8]) -> bool>(mut fill: F, wait: Duration) -> Option<String> {
    for attempt in 0..TOKEN_RNG_ATTEMPTS {
        let mut buf = [0u8; 32];
        if fill(&mut buf) {
            return Some(buf.iter().map(|b| format!("{:02x}", b)).collect());
        }
        if attempt + 1 < TOKEN_RNG_ATTEMPTS {
            std::thread::sleep(wait);
        }
    }
    None
}
