//! Launch and supervise the monbooru server MooshieUI installed.
//!
//! monbooru is a Go binary that serves its own web UI and REST API on
//! `127.0.0.1:8455`. MooshieUI starts it from its install directory with
//! **`-desktop -no-browser`**:
//!
//! - `-desktop` is the profile the portable archives are built for (their
//!   binaries are stamped with `main.defaultDesktop=true`): it resolves
//!   `monbooru.toml` beside the executable and keeps the database, thumbnails
//!   and logs in that same folder, which is what "unpack it, and run it" means.
//! - `-no-browser` keeps monbooru from opening a browser tab on every app
//!   start; MooshieUI's "Open" is the deliberate way to reach its UI.
//!
//! No other flags are passed. `--help` is not usable as evidence on this
//! platform (the Windows artifacts are linked for the GUI subsystem and are
//! handed no console), so the flags come from monbooru's own source at the
//! installed tag (`cmd/monbooru/main.go`, v1.21.1): `-config`, `-desktop`,
//! `-no-browser`, `-version`, `-hash-password`. There is no flag for the bind
//! address; it comes from `server.bind_address` in the config, whose default is
//! already `127.0.0.1:8455`, and from the `MONBOORU_SERVER_BIND_ADDRESS`
//! environment variable, which the launcher sets to `127.0.0.1:8455` so a
//! stale config can never turn the managed instance into a public listener.
//!
//! Ownership follows the ComfyUI managed-process precedent
//! (`comfyui::managed_process`): a process is only ever killed after its
//! recorded start time and executable path still match, and a server that was
//! already running — ours from an earlier session, or the user's own — is never
//! claimed or killed just because it answers on the port.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// monbooru's default port, and the one the tab is configured against.
pub const DEFAULT_PORT: u16 = 8455;

/// The loopback bind the managed server is forced onto.
pub const LOOPBACK_BIND: &str = "127.0.0.1:8455";

/// How long the HTTP server may take to answer before startup is a failure.
pub const READINESS_TIMEOUT: Duration = Duration::from_secs(45);

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);

/// `http://127.0.0.1:8455` — the local server's base URL.
pub fn local_url() -> String {
    format!("http://127.0.0.1:{DEFAULT_PORT}")
}

/// `http://127.0.0.1:8455/api/v1/` — the readiness probe.
pub fn api_probe_url() -> String {
    format!("{}/api/v1/", local_url())
}

/// `http://127.0.0.1:8455/health` — monbooru's own identity answer, the same
/// one its second-launch probe reads. Needs no API token.
pub fn health_url() -> String {
    format!("{}/health", local_url())
}

/// The command line MooshieUI launches monbooru with. Pure and unit-tested.
pub fn launch_args() -> [&'static str; 2] {
    ["-desktop", "-no-browser"]
}

/// `<app_data>/monbooru/server.json` — the keep-alive record.
pub fn record_path(app_data: &Path) -> PathBuf {
    app_data.join("monbooru").join("server.json")
}

/// Where the managed server's own stdout/stderr is captured for diagnostics.
/// monbooru's desktop profile also writes its own log under its data folder.
pub fn log_path() -> PathBuf {
    std::env::temp_dir().join("monbooru-server-stderr.log")
}

/// Result of asking the local port who it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Probe {
    /// monbooru answered; its reported version, when it sent one.
    Ready(Option<String>),
    /// Something answered that is not monbooru (a stranger on the port).
    Foreign,
    /// Nothing answered at all.
    Down,
}

/// What the settings panel and the tab need to render the server row.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    /// MooshieUI manages a live monbooru process (spawned, or reclaimed from
    /// the keep-alive record of an earlier session).
    pub running: bool,
    pub pid: Option<u32>,
    /// Version the locally answered server reports, when it answers.
    pub version: Option<String>,
    /// Executable of the managed process, when there is one.
    pub executable: Option<String>,
    pub url: String,
    /// monbooru answered on the local URL (whoever started it).
    pub responding: bool,
}

impl ServerStatus {
    fn stopped() -> Self {
        Self {
            running: false,
            pid: None,
            version: None,
            executable: None,
            url: local_url(),
            responding: false,
        }
    }
}

/// The process this app spawned in this session, if it is still tracked.
static SPAWNED: Mutex<Option<Child>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// Process identity (mirrors comfyui::managed_process)
// ---------------------------------------------------------------------------

/// The identity that proves a PID is still the process we recorded: not just
/// the number, which the OS recycles, but its start time and executable.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct ProcessRecord {
    pid: u32,
    started: u64,
    executable: PathBuf,
    #[cfg(windows)]
    windows_created: u64,
}

impl ProcessRecord {
    fn from_process(process: &sysinfo::Process) -> Option<Self> {
        if process.start_time() == 0 || process.exe()?.as_os_str().is_empty() {
            return None;
        }
        Some(Self {
            pid: process.pid().as_u32(),
            started: process.start_time(),
            executable: process.exe()?.to_path_buf(),
            #[cfg(windows)]
            windows_created: windows_process::created(process.pid().as_u32()).ok()?,
        })
    }

    fn capture(pid: u32) -> Option<Self> {
        let pid = Pid::from_u32(pid);
        let system = process_snapshot(ProcessesToUpdate::Some(&[pid]));
        system.process(pid).and_then(Self::from_process)
    }

    fn matches(&self, process: &sysinfo::Process) -> bool {
        let matches = self.pid == process.pid().as_u32()
            && self.started != 0
            && self.started == process.start_time()
            && process.exe() == Some(self.executable.as_path());
        #[cfg(windows)]
        return matches && windows_process::created(self.pid).ok() == Some(self.windows_created);
        #[cfg(not(windows))]
        matches
    }

    fn terminate(&self, process: &sysinfo::Process) -> bool {
        #[cfg(windows)]
        {
            let _ = process;
            windows_process::terminate(self.pid, self.windows_created).unwrap_or(false)
        }
        #[cfg(not(windows))]
        process.kill()
    }
}

/// Validate and terminate through the same Windows process handle. This also
/// avoids sysinfo's Windows taskkill subprocess and its PID lookup race.
#[cfg(windows)]
mod windows_process {
    use std::io;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_TERMINATE,
    };

    fn open(pid: u32, terminate: bool) -> io::Result<OwnedHandle> {
        let access =
            PROCESS_QUERY_LIMITED_INFORMATION | if terminate { PROCESS_TERMINATE } else { 0 };
        // SAFETY: OpenProcess takes scalar arguments. The returned owned handle
        // is checked for null and closed by OwnedHandle on every return path.
        let handle = unsafe { OpenProcess(access, 0, pid) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
    }

    fn creation_time(handle: &OwnedHandle) -> io::Result<u64> {
        let mut created = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let mut exited = created;
        let mut kernel = created;
        let mut user = created;
        // SAFETY: handle is live and has query rights; all output pointers refer
        // to initialized FILETIME values for the duration of the call.
        if unsafe {
            GetProcessTimes(
                handle.as_raw_handle(),
                &mut created,
                &mut exited,
                &mut kernel,
                &mut user,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
    }

    pub fn created(pid: u32) -> io::Result<u64> {
        creation_time(&open(pid, false)?)
    }

    pub fn terminate(pid: u32, expected_creation: u64) -> io::Result<bool> {
        let handle = open(pid, true)?;
        if creation_time(&handle)? != expected_creation {
            return Ok(true); // PID was recycled: leave its new owner alone.
        }
        // SAFETY: this is the same live handle whose exact creation time was
        // just checked, and it was opened with PROCESS_TERMINATE rights.
        Ok(unsafe { TerminateProcess(handle.as_raw_handle(), 1) } != 0)
    }
}

fn process_snapshot(pids: ProcessesToUpdate<'_>) -> System {
    let mut system = System::new();
    system.refresh_processes_specifics(
        pids,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
    );
    system
}

// ---------------------------------------------------------------------------
// Record persistence
// ---------------------------------------------------------------------------

fn write_record(path: &Path, record: &ProcessRecord) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create the monbooru data directory: {e}"))?;
    }
    let body = serde_json::to_vec(record)
        .map_err(|e| format!("Could not encode the monbooru server record: {e}"))?;
    std::fs::write(path, body)
        .map_err(|e| format!("Could not write the monbooru server record: {e}"))
}

fn load_record(path: &Path) -> Option<ProcessRecord> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// The recorded process, if that exact process is still alive. A record whose
/// process is gone (or whose PID now belongs to something else) is cleared.
fn live_record(path: &Path) -> Option<ProcessRecord> {
    let record = load_record(path)?;
    let pid = Pid::from_u32(record.pid);
    let system = process_snapshot(ProcessesToUpdate::Some(&[pid]));
    let alive = system
        .process(pid)
        .is_some_and(|process| record.matches(process));
    if alive {
        Some(record)
    } else {
        let _ = std::fs::remove_file(path);
        None
    }
}

fn lock_spawned() -> std::sync::MutexGuard<'static, Option<Child>> {
    match SPAWNED.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// True when the process this session spawned has exited (and is reaped so the
/// handle is not consulted again).
fn spawned_exited() -> bool {
    let mut guard = lock_spawned();
    match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None;
                true
            }
            Ok(None) => false,
            Err(_) => false,
        },
        None => false,
    }
}

/// Stop only the process this session spawned, ignoring the record.
fn stop_spawned() {
    let child = lock_spawned().take();
    if let Some(mut child) = child {
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
}

/// Last `lines` lines of a captured log file, for a startup failure message.
fn read_tail(path: &Path, lines: usize) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(lines);
    let tail = all[start..].join("\n");
    if tail.trim().is_empty() {
        None
    } else {
        Some(tail)
    }
}

// ---------------------------------------------------------------------------
// Spawn / readiness / stop / status
// ---------------------------------------------------------------------------

/// Spawn the installed server from its own directory. Returns its PID.
///
/// The child's stdout/stderr is captured to `log_path` for diagnostics; the
/// child is stored so [`stop`] can reach it even if the record write failed.
pub fn spawn(executable: &Path, log_path: &Path, record_path: &Path) -> Result<u32, String> {
    let dir = executable
        .parent()
        .ok_or_else(|| "The monbooru executable has no parent directory".to_string())?;

    // Refuse to start a second copy while the one we track is alive.
    if let Some(child) = lock_spawned().as_mut() {
        if child.try_wait().ok().flatten().is_none() {
            return Err("The monbooru server is already running".to_string());
        }
    }
    *lock_spawned() = None;

    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let log_file = std::fs::File::create(log_path)
        .map_err(|e| format!("Could not create the monbooru log file: {e}"))?;
    let log_err = log_file
        .try_clone()
        .map_err(|e| format!("Could not open the monbooru log file: {e}"))?;

    let mut cmd = Command::new(executable);
    cmd.current_dir(dir)
        .args(launch_args())
        // The managed server is loopback-only, whatever a stale config says.
        .env("MONBOORU_SERVER_BIND_ADDRESS", LOOPBACK_BIND)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Could not start the monbooru server: {e}"))?;
    let pid = child.id();
    *lock_spawned() = Some(child);

    let result = ProcessRecord::capture(pid)
        .ok_or_else(|| "Could not identify the monbooru server process".to_string())
        .and_then(|record| write_record(record_path, &record));
    if let Err(error) = result {
        // Do not leave an untracked server behind on a failed launch.
        stop_spawned();
        return Err(error);
    }
    Ok(pid)
}

/// GET the local `/health` and classify who answered.
pub async fn probe(client: &reqwest::Client) -> Probe {
    let response = match client
        .get(health_url())
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return Probe::Down,
    };
    let Ok(body) = response.json::<serde_json::Value>().await else {
        return Probe::Foreign;
    };
    if body.get("app").and_then(|app| app.as_str()) != Some("monbooru") {
        return Probe::Foreign;
    }
    Probe::Ready(
        body.get("version")
            .and_then(|version| version.as_str())
            .map(str::to_string),
    )
}

/// Poll `http://127.0.0.1:8455/api/v1/` until it answers, or the timeout
/// expires. Any HTTP status counts as an answer — a real monbooru answers 401
/// or 503 there until an API token exists — but the answer is then confirmed
/// against `/health`, so a stranger on the port is reported instead of
/// mistaken for the server.
///
/// Returns the version monbooru reported.
pub async fn wait_for_ready(
    client: &reqwest::Client,
    timeout: Duration,
    log_path: &Path,
) -> Result<Option<String>, String> {
    let deadline = Instant::now() + timeout;
    loop {
        // The API namespace answering at all is the readiness signal. 401/503
        // are real answers: the API is disabled until the user creates a token.
        if client
            .get(api_probe_url())
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .is_ok()
        {
            match probe(client).await {
                Probe::Ready(version) => return Ok(version),
                Probe::Foreign => {
                    return Err(format!(
                        "Another program is answering on {}. Free the port (or change \
                         monbooru's server.bind_address) and try again.",
                        local_url().trim_start_matches("http://")
                    ))
                }
                // The API answered but /health did not: a server mid-startup.
                Probe::Down => {}
            }
        }

        // Checked after the probe so a second instance reporting "already
        // running" (monbooru exits 0 in that case) is still recognised as
        // ready when the other instance answers.
        if spawned_exited() {
            let detail = read_tail(log_path, 30)
                .map(|tail| format!("\n--- monbooru output ---\n{tail}"))
                .unwrap_or_default();
            return Err(format!(
                "The monbooru server exited during startup.{detail}"
            ));
        }

        if Instant::now() >= deadline {
            let detail = read_tail(log_path, 30)
                .map(|tail| format!("\n--- monbooru output ---\n{tail}"))
                .unwrap_or_default();
            return Err(format!(
                "monbooru did not answer on {} within {} seconds.{detail}",
                api_probe_url(),
                timeout.as_secs()
            ));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Stop the monbooru server MooshieUI owns: the process spawned this session,
/// and the one recorded by a keep-alive session before it. Never touches a
/// process whose identity does not match, and never searches by port.
pub fn stop(record_path: &Path) -> Result<(), String> {
    stop_spawned();

    if let Some(record) = load_record(record_path) {
        let pid = Pid::from_u32(record.pid);
        let system = process_snapshot(ProcessesToUpdate::Some(&[pid]));
        if let Some(process) = system
            .process(pid)
            .filter(|process| record.matches(process))
        {
            if !record.terminate(process) {
                let recheck = process_snapshot(ProcessesToUpdate::Some(&[pid]));
                if recheck
                    .process(pid)
                    .is_some_and(|process| record.matches(process))
                {
                    return Err(format!(
                        "Could not stop the monbooru server (pid {})",
                        record.pid
                    ));
                }
            }
        }
        let _ = std::fs::remove_file(record_path);
    }
    Ok(())
}

/// Running/pid/executable as the OS reports them right now. `version` and
/// `responding` are filled in by the caller from a `/health` probe.
pub fn status(record: &Path) -> ServerStatus {
    let mut status = ServerStatus::stopped();
    if let Some(record) = live_record(record) {
        status.running = true;
        status.pid = Some(record.pid);
        status.executable = Some(record.executable.to_string_lossy().to_string());
    }
    status
}

/// Fill in `responding`/`version` from a live probe, treating "monbooru
/// answers" as a running server in the UI's eyes even when it was started
/// outside MooshieUI.
pub async fn enrich(client: &reqwest::Client, mut status: ServerStatus) -> ServerStatus {
    if let Probe::Ready(version) = probe(client).await {
        status.responding = true;
        status.version = version;
    }
    status
}

/// Whether the process spawned this session is still alive (for tests and the
/// exit path).
pub fn spawned_is_running() -> bool {
    !spawned_exited() && lock_spawned().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("monbooru-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The argv contract: the two documented flags, no invented ones, and a
    /// loopback bind that no stale config can widen.
    #[test]
    fn launch_args_are_the_documented_flags() {
        let args = launch_args();
        assert_eq!(args, ["-desktop", "-no-browser"]);
        assert_eq!(LOOPBACK_BIND, "127.0.0.1:8455");
        assert_eq!(local_url(), "http://127.0.0.1:8455");
        assert_eq!(api_probe_url(), "http://127.0.0.1:8455/api/v1/");
        assert_eq!(health_url(), "http://127.0.0.1:8455/health");
        for arg in args {
            assert!(
                !arg.contains("help"),
                "{arg} is not a monbooru flag (its Windows builds have no console to print one)"
            );
        }
    }

    #[test]
    fn recycled_pid_or_different_executable_does_not_match() {
        let pid = Pid::from_u32(std::process::id());
        let system = process_snapshot(ProcessesToUpdate::Some(&[pid]));
        let process = system.process(pid).unwrap();
        let identity = ProcessRecord::from_process(process).unwrap();
        assert!(identity.matches(process));
        let mut recycled = identity.clone();
        recycled.started += 1;
        assert!(!recycled.matches(process));
        let mut unrelated = identity;
        unrelated.executable = PathBuf::from("not-the-same-executable");
        assert!(!unrelated.matches(process));
    }

    #[test]
    fn status_is_stopped_without_a_record() {
        let dir = scratch_dir("status");
        let record = record_path(&dir);
        let status = status(&record);
        assert!(!status.running);
        assert!(status.pid.is_none());
        assert_eq!(status.url, "http://127.0.0.1:8455");
        assert!(!status.responding);
        // Stopping nothing is a no-op, not an error.
        stop(&record).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    struct TestChild(std::process::Child);

    impl TestChild {
        fn spawn() -> Self {
            #[cfg(windows)]
            let mut command = std::process::Command::new("powershell");
            #[cfg(windows)]
            command.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ]);
            #[cfg(not(windows))]
            let mut command = std::process::Command::new("sleep");
            #[cfg(not(windows))]
            command.arg("30");
            Self(command.spawn().unwrap())
        }
    }

    impl Drop for TestChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    /// The keep-alive reclaim contract, on a stand-in process: a record whose
    /// identity still matches resolves as running, a stale one does not, and
    /// `stop` kills exactly the recorded process and nothing else.
    #[test]
    fn keep_alive_record_reclaims_only_the_exact_owned_process() {
        let dir = scratch_dir("ownership");
        let record = record_path(&dir);
        let mut owned_child = TestChild::spawn();
        let mut external_child = TestChild::spawn();

        let owned = ProcessRecord::capture(owned_child.0.id()).unwrap();
        write_record(&record, &owned).unwrap();
        let managed = status(&record);
        assert!(managed.running);
        assert_eq!(managed.pid, Some(owned_child.0.id()));

        // A record whose start time no longer matches is not the same process.
        let mut stale = owned.clone();
        stale.started += 1;
        write_record(&record, &stale).unwrap();
        assert!(!status(&record).running);
        stop(&record).unwrap();
        assert!(
            owned_child.0.try_wait().unwrap().is_none(),
            "a stale record must not kill the process it names"
        );

        #[cfg(windows)]
        {
            let mut recycled = owned.clone();
            recycled.windows_created += 1;
            write_record(&record, &recycled).unwrap();
            assert!(!status(&record).running);
            stop(&record).unwrap();
            assert!(owned_child.0.try_wait().unwrap().is_none());
        }

        write_record(&record, &owned).unwrap();
        stop(&record).unwrap();
        owned_child.0.wait().unwrap();
        assert!(
            external_child.0.try_wait().unwrap().is_none(),
            "a process we never recorded is left alone"
        );
        assert!(load_record(&record).is_none(), "the record is cleared");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
