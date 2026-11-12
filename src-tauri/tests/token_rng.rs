//! M5: the engine access token comes only from the OS secure random source.

#[path = "../src/token.rs"]
mod token;

use std::time::Duration;
use token::{generate_secure_token, generate_token_with, TOKEN_RNG_ATTEMPTS};

#[test]
fn token_is_64_hex_chars_and_unique() {
    let a = generate_secure_token().expect("OS random source");
    let b = generate_secure_token().expect("OS random source");
    assert_eq!(a.len(), 64);
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(a, b);
}

#[test]
fn retries_a_brief_failure() {
    let mut calls = 0;
    let token = generate_token_with(
        |buf| {
            calls += 1;
            buf.fill(7);
            calls >= 3
        },
        Duration::ZERO,
    );
    assert_eq!(calls, 3);
    assert_eq!(token.as_deref(), Some("07".repeat(32).as_str()));
}

#[test]
fn no_guessable_fallback_when_randomness_keeps_failing() {
    let mut calls = 0;
    let token = generate_token_with(
        |_| {
            calls += 1;
            false
        },
        Duration::ZERO,
    );
    assert_eq!(token, None);
    assert_eq!(calls, TOKEN_RNG_ATTEMPTS);
}
