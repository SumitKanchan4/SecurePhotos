//! T1: the engine runs in a kill-on-close job, so it stops when the app ends.

#![cfg(windows)]

#[path = "../src/job.rs"]
mod job;

use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// A stand-in engine that would run for a minute, with a child of its own (like FFmpeg).
fn long_running() -> Child {
    Command::new("cmd")
        .args(["/C", "ping -n 60 127.0.0.1 >NUL"])
        .stdout(Stdio::null())
        .spawn()
        .expect("start cmd")
}

fn exits_within(child: &mut Child, limit: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < limit {
        if let Ok(Some(_)) = child.try_wait() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

#[test]
fn closing_the_job_stops_the_engine() {
    let job = job::EngineJob::new().expect("create job");
    let mut child = long_running();
    job.assign(&child).expect("assign to job");

    // While the app (the job's owner) lives, the engine keeps running.
    assert!(!exits_within(&mut child, Duration::from_millis(500)));

    // The app ends: its handle to the job is closed, as Windows does after a crash.
    drop(job);
    assert!(exits_within(&mut child, Duration::from_secs(3)), "the engine kept running");
}

#[test]
fn a_process_outside_the_job_is_not_touched() {
    let job = job::EngineJob::new().expect("create job");
    let mut outside = long_running();
    drop(job);
    assert!(!exits_within(&mut outside, Duration::from_millis(500)));
    let _ = outside.kill();
}
