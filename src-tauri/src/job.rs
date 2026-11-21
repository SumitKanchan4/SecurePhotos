//! Ties the engine's life to the app's (T1).
//!
//! The engine runs inside a Windows Job Object set to "kill on close". The app holds the only
//! handle to the job, so when the app ends for any reason (normal close, crash, Task Manager),
//! Windows closes the handle and stops every process in the job: the engine, the dev reloader's
//! worker and any FFmpeg the engine started. Without it a crashed app left the engine running,
//! holding files open on the drive so Windows wouldn't eject it.
//!
//! The engine also watches the app's process itself (`SECUREPHOTOS_PARENT_PID`), so it still
//! stops if the job can't be set up.

use std::process::Child;

#[cfg(windows)]
mod imp {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct Job(HANDLE);

    // The handle is only used through the thread-safe Win32 calls below.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn new() -> std::io::Result<Self> {
            // SAFETY: plain Win32 calls; every pointer passed is valid for the call.
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let job = Job(handle);
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(job)
            }
        }

        pub fn assign(&self, child: &Child) -> std::io::Result<()> {
            // SAFETY: both handles are open for the duration of the call.
            let ok = unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) };
            if ok == 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // Closing the last handle stops every process still in the job.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::process::Child;

    /// Other systems rely on the engine's own parent watch.
    pub struct Job;

    impl Job {
        pub fn new() -> std::io::Result<Self> {
            Ok(Job)
        }

        pub fn assign(&self, _child: &Child) -> std::io::Result<()> {
            Ok(())
        }
    }
}

/// A job that stops every process in it when it is dropped or when this process ends.
pub struct EngineJob(imp::Job);

impl EngineJob {
    /// Creates the job. Fails only if Windows refuses; the engine's parent watch still applies.
    pub fn new() -> std::io::Result<Self> {
        imp::Job::new().map(EngineJob)
    }

    /// Puts a just-started process into the job; the processes it starts later join it too.
    pub fn assign(&self, child: &Child) -> std::io::Result<()> {
        self.0.assign(child)
    }
}
