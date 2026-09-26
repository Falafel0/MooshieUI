//! Download and install the monbooru server from its GitHub releases.
//!
//! Mirrors the Patchy install flow: fetch the latest release, pick the portable
//! asset for this platform and flavor, verify its SHA-256 against the release's
//! `SHA256SUMS`, and unpack it under `{app_data}/monbooru/install/<tag>/` with
//! the archive's single wrapper directory stripped.
//!
//! monbooru publishes two shapes of portable archive, and the choice is the
//! user's:
//!
//! - **lite** ([`Flavor::Lite`], the default): a single self-contained binary.
//! - **bundled** ([`Flavor::Bundled`]): the same binary plus `ffmpeg` and ONNX
//!   Runtime beside it, which is what video thumbnails and local CPU
//!   auto-tagging need.
//!
//! Asset names are parsed generically (`monbooru_<version>_portable_<flavor>_
//! <os>_<arch>.<ext>`), so a version bump does not change the selection. The
//! `*_setup.exe` installers, the AppImage and the Flatpak are never selected:
//! they do not carry the `portable` marker or the platform extension.
//!
//! monbooru ships no macOS build at all; [`is_supported`] reports that so the
//! UI offers a manual install there instead.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use tokio::io::AsyncWriteExt;

const RELEASES_API: &str = "https://api.github.com/repos/monbooru/monbooru/releases/latest";
const RELEASE_DOWNLOAD: &str = "https://github.com/monbooru/monbooru/releases/download";
/// The checksum manifest the release ships. monbooru names it without an
/// extension (`SHA256SUMS`); the `.txt` spelling is tolerated as well.
const SUMS_ASSET: &str = "SHA256SUMS";
const SUMS_ASSET_TXT: &str = "SHA256SUMS.txt";
/// The GitHub API rejects requests that omit a User-Agent header.
const USER_AGENT: &str = "MooshieUI-Monbooru-Installer";

/// The platform a monbooru asset is selected for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Linux,
    Macos,
}

/// The platform this binary is running on.
pub fn current_platform() -> Platform {
    #[cfg(target_os = "windows")]
    {
        Platform::Windows
    }
    #[cfg(target_os = "linux")]
    {
        Platform::Linux
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Platform::Macos
    }
}

/// Which portable archive to install. Stored in config as `"lite"` or
/// `"bundled"`; anything unrecognized falls back to the lite build.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Flavor {
    /// Single self-contained binary (the default).
    #[default]
    Lite,
    /// Binary plus ffmpeg and ONNX Runtime beside it.
    Bundled,
}

impl Flavor {
    /// The token monbooru uses in its asset names and config.
    pub fn as_str(self) -> &'static str {
        match self {
            Flavor::Lite => "lite",
            Flavor::Bundled => "bundled",
        }
    }

    /// Parse a config value. Unknown values are the lite build, not an error:
    /// the installer keeps working across a config written by a newer build.
    pub fn from_config(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "bundled" => Flavor::Bundled,
            _ => Flavor::Lite,
        }
    }
}

/// The CPU architecture monbooru names in its assets.
fn host_arch() -> &'static str {
    #[cfg(target_arch = "aarch64")]
    {
        "arm64"
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        "amd64"
    }
}

/// Whether MooshieUI can install monbooru for a platform at all. False on
/// macOS, which monbooru publishes no build for.
pub fn platform_supported(platform: Platform) -> bool {
    matches!(platform, Platform::Windows | Platform::Linux)
}

/// False on macOS: monbooru ships no macOS artifact, so the UI offers a manual
/// install there instead.
pub fn is_supported() -> bool {
    platform_supported(current_platform())
}

/// A single downloadable file attached to a release.
#[derive(Debug, Clone)]
pub struct AssetRef {
    pub name: String,
    pub url: String,
    pub size: u64,
}

/// The subset of a GitHub release this installer needs.
#[derive(Debug, Clone)]
pub struct ReleaseRef {
    pub tag: String,
    pub assets: Vec<AssetRef>,
}

/// Pick the portable archive for the platform and flavor:
/// `monbooru_<version>_portable_<flavor>_<os>_<arch>.<zip|tar.gz>`.
///
/// The match is on tokens, not on a pinned version, so a new release — or a
/// re-shaped name that keeps the tokens — still selects. Never returns
/// `SHA256SUMS`, the `*_setup.exe` installers, the AppImage or the Flatpak.
/// Pure and unit-tested.
pub fn select_asset(assets: &[AssetRef], platform: Platform, flavor: Flavor) -> Option<AssetRef> {
    let (os_token, extension) = match platform {
        Platform::Windows => ("windows", ".zip"),
        Platform::Linux => ("linux", ".tar.gz"),
        // No monbooru artifact exists for macOS.
        Platform::Macos => return None,
    };
    let flavor_token = format!("_portable_{}_", flavor.as_str());
    let os_token = format!("_{os_token}_");
    let arch_token = format!("_{}", host_arch());
    assets
        .iter()
        .find(|asset| {
            if asset.name == SUMS_ASSET || asset.name == SUMS_ASSET_TXT {
                return false;
            }
            let name = asset.name.to_ascii_lowercase();
            name.starts_with("monbooru")
                && name.contains(&flavor_token)
                && name.contains(&os_token)
                && name.contains(&arch_token)
                && name.ends_with(extension)
                // The installers are named `monbooru_<version>_<flavor>_
                // windows_amd64_setup.exe`; they carry neither `portable` nor
                // the extension above, so this is belt and braces.
                && !name.contains("setup")
        })
        .cloned()
}

/// Parse a `SHA256SUMS` body ("<hex>  <filename>" per line, possibly with a
/// leading "*" before the filename) into filename -> lowercase hex. Pure.
pub fn parse_sha256sums(text: &str) -> HashMap<String, String> {
    let mut sums = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Split on the first run of whitespace: "<hex>  <filename>".
        let Some((hash, rest)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let hash = hash.trim();
        let filename = rest.trim().trim_start_matches('*');
        if hash.is_empty() || filename.is_empty() {
            continue;
        }
        sums.insert(filename.to_string(), hash.to_ascii_lowercase());
    }
    sums
}

/// <app_data>/monbooru/install
pub fn managed_root(app_data: &Path) -> PathBuf {
    app_data.join("monbooru").join("install")
}

/// The newest installed version: its directory name (`v1.21.1`) and the
/// executable inside it. Version directories are sorted so `v1.21.10` beats
/// `v1.21.9`; a directory without the executable is skipped.
pub fn installed_tree(root: &Path) -> Option<(String, PathBuf)> {
    let mut versions: Vec<(semver::Version, String, PathBuf)> = Vec::new();
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy().to_string();
        let Some(version) = parse_version(&name) else {
            continue;
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        versions.push((version, name, path));
    }
    // Newest first, so `v1.21.10` wins over `v1.21.9`.
    versions.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, name, dir) in versions {
        let exe = dir.join(executable_relative(current_platform()));
        if exe.is_file() {
            return Some((name, exe));
        }
    }
    None
}

/// The executable of the newest installed version under `root`, or None.
pub fn installed_executable(root: &Path) -> Option<PathBuf> {
    installed_tree(root).map(|(_, exe)| exe)
}

/// The version directory name (`v1.21.1`) of the newest installed version.
pub fn installed_version(root: &Path) -> Option<String> {
    installed_tree(root).map(|(name, _)| name)
}

/// Parse a version directory name such as `v1.21.1` or `1.2.3`. The leading
/// `v` is optional and missing components default to zero, so a tag like
/// `v2.0` still sorts as `2.0.0`.
fn parse_version(name: &str) -> Option<semver::Version> {
    let trimmed = name.trim_start_matches('v');
    if trimmed.is_empty() {
        return None;
    }
    let mut parts = trimmed.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some(semver::Version::new(major, minor, patch))
}

/// Path of the monbooru executable relative to its version directory.
fn executable_relative(platform: Platform) -> &'static str {
    match platform {
        Platform::Windows => "monbooru.exe",
        _ => "monbooru",
    }
}

/// Progress reported while installing. Emitted as a Tauri event payload, so it
/// is serialized with an internal tag the frontend switches on.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum InstallProgress {
    Downloading { downloaded: u64, total: u64 },
    Verifying,
    Extracting,
}

#[derive(Deserialize)]
struct ApiRelease {
    tag_name: String,
    #[serde(default)]
    assets: Vec<ApiAsset>,
}

#[derive(Deserialize)]
struct ApiAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

/// GET https://api.github.com/repos/monbooru/monbooru/releases/latest with a
/// User-Agent header (the API rejects requests without one).
pub async fn fetch_latest_release(client: &reqwest::Client) -> Result<ReleaseRef, String> {
    let response = client
        .get(RELEASES_API)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub for the monbooru release: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub returned an error for the monbooru release: {e}"))?;
    let release: ApiRelease = response
        .json()
        .await
        .map_err(|e| format!("Could not parse the monbooru release metadata: {e}"))?;
    Ok(ReleaseRef {
        tag: release.tag_name,
        assets: release
            .assets
            .into_iter()
            .map(|asset| AssetRef {
                name: asset.name,
                url: asset.browser_download_url,
                size: asset.size,
            })
            .collect(),
    })
}

/// Download the platform asset plus `SHA256SUMS`, verify the checksum, and
/// extract into <root>/<tag>/. Returns the absolute executable path.
/// macOS: Err explaining that automatic installation is unsupported there.
pub async fn install_release(
    client: &reqwest::Client,
    release: &ReleaseRef,
    root: &Path,
    flavor: Flavor,
    on_progress: &(dyn Fn(InstallProgress) + Send + Sync),
) -> Result<PathBuf, String> {
    if !is_supported() {
        return Err(
            "Automatic installation of monbooru is not supported on this platform: monbooru \
             publishes no build for it. Install monbooru manually from \
             https://github.com/monbooru/monbooru/releases"
                .to_string(),
        );
    }
    let platform = current_platform();
    let asset = select_asset(&release.assets, platform, flavor).ok_or_else(|| {
        format!(
            "Release {} has no {} monbooru build for this platform.",
            release.tag,
            flavor.as_str()
        )
    })?;

    // Prefer the URL the API gave us for SHA256SUMS; fall back to the
    // deterministic release-download URL.
    let sums_url = release
        .assets
        .iter()
        .find(|a| a.name == SUMS_ASSET || a.name == SUMS_ASSET_TXT)
        .map(|a| a.url.clone())
        .unwrap_or_else(|| format!("{RELEASE_DOWNLOAD}/{}/{SUMS_ASSET}", release.tag));

    let sums_text = client
        .get(&sums_url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Could not download {SUMS_ASSET}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Could not download {SUMS_ASSET}: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Could not read {SUMS_ASSET}: {e}"))?;
    let sums = parse_sha256sums(&sums_text);
    let expected = sums.get(&asset.name).cloned().ok_or_else(|| {
        format!(
            "{SUMS_ASSET} does not list a checksum for {}. Refusing to install without \
             verification.",
            asset.name
        )
    })?;

    std::fs::create_dir_all(root)
        .map_err(|e| format!("Could not create the monbooru install directory: {e}"))?;
    // Stage under a dot-directory so a half-written download can never be
    // mistaken for an installed version by `installed_tree`.
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("Could not create the monbooru staging directory: {e}"))?;
    let download = staging.join("asset");

    let result = download_verify_extract(
        client,
        &asset,
        &expected,
        root,
        &download,
        platform,
        &release.tag,
        on_progress,
    )
    .await;
    // Always clear staging, success or failure.
    let _ = std::fs::remove_dir_all(&staging);
    result
}

#[allow(clippy::too_many_arguments)]
async fn download_verify_extract(
    client: &reqwest::Client,
    asset: &AssetRef,
    expected: &str,
    root: &Path,
    download: &Path,
    platform: Platform,
    tag: &str,
    on_progress: &(dyn Fn(InstallProgress) + Send + Sync),
) -> Result<PathBuf, String> {
    let mut response = client
        .get(&asset.url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Could not download {}: {e}", asset.name))?
        .error_for_status()
        .map_err(|e| format!("Could not download {}: {e}", asset.name))?;

    on_progress(InstallProgress::Downloading {
        downloaded: 0,
        total: asset.size,
    });
    let mut file = tokio::fs::File::create(download)
        .await
        .map_err(|e| format!("Could not create the monbooru download file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    // `Response::chunk` streams the body without reqwest's `stream` feature,
    // which this crate does not enable.
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("monbooru download interrupted: {e}"))?
    {
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Could not write the monbooru download: {e}"))?;
        on_progress(InstallProgress::Downloading {
            downloaded,
            total: asset.size,
        });
    }
    file.flush()
        .await
        .map_err(|e| format!("Could not flush the monbooru download: {e}"))?;
    drop(file);

    on_progress(InstallProgress::Verifying);
    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "monbooru download failed checksum verification (expected {expected}, got {actual})."
        ));
    }

    on_progress(InstallProgress::Extracting);
    let version_dir = root.join(tag);
    if version_dir.exists() {
        std::fs::remove_dir_all(&version_dir)
            .map_err(|e| format!("Could not clear the previous monbooru install: {e}"))?;
    }
    std::fs::create_dir_all(&version_dir)
        .map_err(|e| format!("Could not create the monbooru version directory: {e}"))?;

    match platform {
        Platform::Windows => extract_zip(download, &version_dir)?,
        #[cfg(not(target_os = "windows"))]
        Platform::Linux => extract_targz(download, &version_dir)?,
        #[cfg(target_os = "windows")]
        Platform::Linux => {
            return Err("monbooru's Linux archives can only be installed on Linux.".to_string())
        }
        Platform::Macos => return Err("monbooru publishes no macOS build to install.".to_string()),
    }

    let exe = version_dir.join(executable_relative(platform));
    if !exe.is_file() {
        return Err(format!(
            "The monbooru archive did not contain the expected executable ({}).",
            executable_relative(platform)
        ));
    }
    Ok(exe)
}

/// Join a relative archive entry name onto `dest`, rejecting absolute paths and
/// any `..` component so a malicious archive cannot escape the destination.
fn safe_join(dest: &Path, name: &str) -> Result<PathBuf, String> {
    let mut out = dest.to_path_buf();
    for component in Path::new(name).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Unsafe path in monbooru archive: {name}"));
            }
        }
    }
    Ok(out)
}

/// The single wrapper directory shared by every entry, if there is one.
///
/// The release archives store their payload under
/// `monbooru_<version>_portable_<flavor>_<os>_<arch>/`. Names are normalised
/// (backslashes to forward slashes) before anything else reads them. Returns
/// None for an archive whose files already sit at the top level, or one with
/// more than one root.
fn archive_root(names: &[String]) -> Option<String> {
    let mut root: Option<String> = None;
    for name in names {
        let normalised = name.replace('\\', "/");
        // A trailing separator marks a directory entry: it names a root but
        // proves nothing on its own.
        let is_directory = normalised.ends_with('/');
        let trimmed = normalised.trim_end_matches('/');
        if trimmed.is_empty() {
            continue;
        }
        let Some((first, rest)) = trimmed.split_once('/') else {
            if is_directory {
                continue;
            }
            // A file at the top level means there is no wrapper to strip.
            return None;
        };
        if rest.is_empty() {
            continue;
        }
        // A traversal or absolute component must never become a wrapper:
        // stripping it would walk straight past the escape check in `safe_join`.
        if first == "." || first == ".." || first.contains(':') {
            return None;
        }
        match &root {
            Some(existing) if existing != first => return None,
            None => root = Some(first.to_string()),
            Some(_) => {}
        }
    }
    root
}

/// Drop the wrapper directory from an entry name and normalise separators.
fn strip_archive_root(name: &str, wrapper: Option<&str>) -> String {
    let normalised = name.replace('\\', "/");
    let Some(wrapper) = wrapper else {
        return normalised;
    };
    let prefix = format!("{wrapper}/");
    match normalised.strip_prefix(&prefix) {
        Some(rest) => rest.to_string(),
        None => normalised,
    }
}

/// Extract a `.zip` into `dest`, rejecting entries that escape it.
fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive)
        .map_err(|e| format!("Could not open the monbooru archive: {e}"))?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| format!("Invalid monbooru ZIP archive: {e}"))?;
    let mut names = Vec::with_capacity(zip.len());
    for index in 0..zip.len() {
        let entry = zip
            .by_index(index)
            .map_err(|e| format!("Invalid monbooru ZIP entry: {e}"))?;
        names.push(entry.name().to_string());
    }
    // Flattening the wrapper keeps the executable where `executable_relative`
    // looks for it.
    let wrapper = archive_root(&names);
    for (index, raw_name) in names.iter().enumerate() {
        let mut entry = zip
            .by_index(index)
            .map_err(|e| format!("Invalid monbooru ZIP entry: {e}"))?;
        let name = strip_archive_root(raw_name, wrapper.as_deref());
        let out = safe_join(dest, &name)?;
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("Could not create {out:?}: {e}"))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create {parent:?}: {e}"))?;
        }
        let mut writer =
            std::fs::File::create(&out).map_err(|e| format!("Could not create {out:?}: {e}"))?;
        std::io::copy(&mut entry, &mut writer)
            .map_err(|e| format!("Could not extract {out:?}: {e}"))?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            if mode & 0o111 != 0 {
                let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(0o755));
            }
        }
    }
    Ok(())
}

/// Extract a `.tar.gz` into `dest`, rejecting entries that escape it, symlinks
/// and hard links. Linux/macOS only: the tar crate is a Unix-target dependency.
#[cfg(not(target_os = "windows"))]
fn extract_targz(archive: &Path, dest: &Path) -> Result<(), String> {
    let names = tar_entry_names(archive)?;
    let wrapper = archive_root(&names);

    let file = std::fs::File::open(archive)
        .map_err(|e| format!("Could not open the monbooru archive: {e}"))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    let entries = tar
        .entries()
        .map_err(|e| format!("Invalid monbooru TAR archive: {e}"))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Invalid monbooru TAR entry: {e}"))?;
        let raw_name = entry
            .path()
            .map_err(|e| format!("Invalid monbooru TAR entry: {e}"))?
            .to_string_lossy()
            .to_string();
        let entry_type = entry.header().entry_type();
        if entry_type.is_symlink() || entry_type.is_hard_link() {
            return Err(format!("Unsafe link entry in monbooru archive: {raw_name}"));
        }
        let name = strip_archive_root(&raw_name, wrapper.as_deref());
        let out = safe_join(dest, &name)?;
        if entry_type.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("Could not create {out:?}: {e}"))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create {parent:?}: {e}"))?;
        }
        let mut writer =
            std::fs::File::create(&out).map_err(|e| format!("Could not create {out:?}: {e}"))?;
        std::io::copy(&mut entry, &mut writer)
            .map_err(|e| format!("Could not extract {out:?}: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(mode) = entry.header().mode() {
                if mode & 0o111 != 0 {
                    let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(0o755));
                }
            }
        }
    }
    Ok(())
}

/// Entry names of a `.tar.gz`, for wrapper detection. Reads the stream twice
/// (once for names, once to extract) because tar entries borrow the archive.
#[cfg(not(target_os = "windows"))]
fn tar_entry_names(archive: &Path) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(archive)
        .map_err(|e| format!("Could not open the monbooru archive: {e}"))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    let entries = tar
        .entries()
        .map_err(|e| format!("Invalid monbooru TAR archive: {e}"))?;
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Invalid monbooru TAR entry: {e}"))?;
        let name = entry
            .path()
            .map_err(|e| format!("Invalid monbooru TAR entry: {e}"))?
            .to_string_lossy()
            .to_string();
        names.push(name);
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The twelve real assets from the `v1.21.1` release.
    fn fixture() -> Vec<AssetRef> {
        [
            "monbooru_1.21.1_aarch64.AppImage",
            "monbooru_1.21.1_bundled_windows_amd64_setup.exe",
            "monbooru_1.21.1_lite_windows_amd64_setup.exe",
            "monbooru_1.21.1_portable_bundled_linux_amd64.tar.gz",
            "monbooru_1.21.1_portable_bundled_linux_arm64.tar.gz",
            "monbooru_1.21.1_portable_bundled_windows_amd64.zip",
            "monbooru_1.21.1_portable_lite_linux_amd64.tar.gz",
            "monbooru_1.21.1_portable_lite_linux_arm64.tar.gz",
            "monbooru_1.21.1_portable_lite_windows_amd64.zip",
            "monbooru_1.21.1_x86_64.AppImage",
            "monbooru_1.21.1_x86_64.flatpak",
            SUMS_ASSET,
        ]
        .into_iter()
        .map(|name| AssetRef {
            name: name.to_string(),
            url: format!("https://github.com/monbooru/monbooru/releases/download/v1.21.1/{name}"),
            size: 8_406_240,
        })
        .collect()
    }

    /// The same asset list with a later version, to prove selection parses the
    /// name generically instead of pinning `1.21.1`.
    fn version_bumped_fixture() -> Vec<AssetRef> {
        fixture()
            .into_iter()
            .map(|mut asset| {
                asset.name = asset.name.replace("1.21.1", "9.9.9");
                asset.url = format!(
                    "https://github.com/monbooru/monbooru/releases/download/v9.9.9/{}",
                    asset.name
                );
                asset
            })
            .collect()
    }

    #[test]
    fn select_asset_picks_the_portable_build_per_platform_and_flavor() {
        let assets = fixture();
        assert_eq!(
            select_asset(&assets, Platform::Windows, Flavor::Lite)
                .unwrap()
                .name,
            "monbooru_1.21.1_portable_lite_windows_amd64.zip"
        );
        assert_eq!(
            select_asset(&assets, Platform::Windows, Flavor::Bundled)
                .unwrap()
                .name,
            "monbooru_1.21.1_portable_bundled_windows_amd64.zip"
        );
        assert_eq!(
            select_asset(&assets, Platform::Linux, Flavor::Lite)
                .unwrap()
                .name,
            format!("monbooru_1.21.1_portable_lite_linux_{}.tar.gz", host_arch())
        );
        assert_eq!(
            select_asset(&assets, Platform::Linux, Flavor::Bundled)
                .unwrap()
                .name,
            format!(
                "monbooru_1.21.1_portable_bundled_linux_{}.tar.gz",
                host_arch()
            )
        );
        // monbooru has no macOS build at all.
        assert!(select_asset(&assets, Platform::Macos, Flavor::Lite).is_none());
    }

    #[test]
    fn select_asset_never_returns_installer_appimage_flatpak_or_sums() {
        for flavor in [Flavor::Lite, Flavor::Bundled] {
            for platform in [Platform::Windows, Platform::Linux] {
                let picked = select_asset(&fixture(), platform, flavor).unwrap();
                assert!(!picked.name.contains("setup"), "{}", picked.name);
                assert!(!picked.name.ends_with(".AppImage"), "{}", picked.name);
                assert!(!picked.name.ends_with(".flatpak"), "{}", picked.name);
                assert_ne!(picked.name, SUMS_ASSET);
            }
        }
        assert!(select_asset(&[], Platform::Windows, Flavor::Lite).is_none());
    }

    #[test]
    fn select_asset_survives_a_version_bump() {
        let assets = version_bumped_fixture();
        assert_eq!(
            select_asset(&assets, Platform::Windows, Flavor::Lite)
                .unwrap()
                .name,
            "monbooru_9.9.9_portable_lite_windows_amd64.zip"
        );
        assert_eq!(
            select_asset(&assets, Platform::Windows, Flavor::Bundled)
                .unwrap()
                .name,
            "monbooru_9.9.9_portable_bundled_windows_amd64.zip"
        );
    }

    #[test]
    fn flavor_from_config_defaults_to_lite() {
        assert_eq!(Flavor::from_config("bundled"), Flavor::Bundled);
        assert_eq!(Flavor::from_config("Bundled"), Flavor::Bundled);
        assert_eq!(Flavor::from_config("bundled "), Flavor::Bundled);
        assert_eq!(Flavor::from_config("lite"), Flavor::Lite);
        assert_eq!(Flavor::from_config(""), Flavor::Lite);
        assert_eq!(Flavor::from_config("everything"), Flavor::Lite);
        assert_eq!(Flavor::default(), Flavor::Lite);
        assert_eq!(Flavor::Bundled.as_str(), "bundled");
    }

    #[test]
    fn parse_sha256sums_handles_real_format_and_star_prefix() {
        let body = "\
d1e2f3  monbooru_1.21.1_portable_lite_windows_amd64.zip
aabbccdd  *monbooru_1.21.1_portable_bundled_windows_amd64.zip

# comment
notahashline
0011  monbooru_1.21.1_portable_lite_linux_amd64.tar.gz
";
        let sums = parse_sha256sums(body);
        assert_eq!(
            sums.get("monbooru_1.21.1_portable_lite_windows_amd64.zip")
                .map(String::as_str),
            Some("d1e2f3")
        );
        assert_eq!(
            sums.get("monbooru_1.21.1_portable_bundled_windows_amd64.zip")
                .map(String::as_str),
            Some("aabbccdd")
        );
        assert_eq!(
            sums.get("monbooru_1.21.1_portable_lite_linux_amd64.tar.gz")
                .map(String::as_str),
            Some("0011")
        );
        assert!(!sums.contains_key("notahashline"));
        assert_eq!(sums.len(), 3);
    }

    /// The `SHA256SUMS` body the `v1.21.1` release publishes, verbatim. It is
    /// what the installer downloads and parses before unpacking anything, so its
    /// shape and the names in it are a real interface, not an assumption.
    const RELEASE_V1211_SUMS: &str = "\
8ee7d258bf62b10764137fa89a7f52bd7dd3749e3100307cbea56e8aa0f68e3e  monbooru_1.21.1_aarch64.AppImage
549c3f01a8ee9cc0c3bb3b720dc339fc9ea9774683e2cc21c7458453c5a2dfdf  monbooru_1.21.1_bundled_windows_amd64_setup.exe
ca9428591a9d46b5800f89136bd97740e7fad0103b8e403eb5edb6734fef2ff2  monbooru_1.21.1_lite_windows_amd64_setup.exe
1711c59d21c35bbf0de373cdb098bd5c350077024035083d40a5f5e64a27847b  monbooru_1.21.1_portable_bundled_linux_amd64.tar.gz
6c178286812340a13f4d53d9a09ff160c0f2485cc914ff1e7f68dfd8b1b75e12  monbooru_1.21.1_portable_bundled_linux_arm64.tar.gz
68465e5541a78a357d7d7ad34d0054e91d972b859d4f88d45b4d1c15fb9948f7  monbooru_1.21.1_portable_bundled_windows_amd64.zip
e31e2c74a9f3435b1f3f4fc183f31cadb5e537a32fba59627c7a9c59550677a9  monbooru_1.21.1_portable_lite_linux_amd64.tar.gz
a2ee0bab436e2513c986a0396297c06cae69b770e19502682b89aee6fa842c3f  monbooru_1.21.1_portable_lite_linux_arm64.tar.gz
ed1214e8ccd810b85e6c80c81a9031f0f88af8326243b63fb8ca76836c25b244  monbooru_1.21.1_portable_lite_windows_amd64.zip
ba69df924c6b682d02ac0c9cebea0e8e7df17fb68669fb061de1e54ae9bf55bc  monbooru_1.21.1_x86_64.AppImage
9b4753462e7699a1a5f42a4e8c5cf5a344164acc8a311e0b338b2d616a528ebe  monbooru_1.21.1_x86_64.flatpak
";

    #[test]
    fn the_published_release_sums_parse_with_every_asset_covered() {
        let sums = parse_sha256sums(RELEASE_V1211_SUMS);
        assert_eq!(sums.len(), 11, "every published line is a checksum");
        assert_eq!(
            sums.get("monbooru_1.21.1_portable_lite_windows_amd64.zip")
                .map(String::as_str),
            Some("ed1214e8ccd810b85e6c80c81a9031f0f88af8326243b63fb8ca76836c25b244"),
            "the checksum the portable lite Windows build is verified against"
        );
        // A missing entry makes the installer refuse that platform outright.
        for name in [
            "monbooru_1.21.1_portable_lite_windows_amd64.zip",
            "monbooru_1.21.1_portable_bundled_windows_amd64.zip",
            "monbooru_1.21.1_portable_lite_linux_amd64.tar.gz",
            "monbooru_1.21.1_portable_bundled_linux_amd64.tar.gz",
        ] {
            assert!(
                sums.contains_key(name),
                "{name} is published without a checksum"
            );
        }
    }

    #[test]
    fn every_platform_downloads_an_asset_the_published_sums_cover() {
        // The whole install path hangs on these two agreeing: what `select_asset`
        // picks from the real asset list has to be a name `parse_sha256sums`
        // finds a checksum for, or the download is refused after it was made.
        let assets = fixture();
        let sums = parse_sha256sums(RELEASE_V1211_SUMS);
        for platform in [Platform::Windows, Platform::Linux] {
            for flavor in [Flavor::Lite, Flavor::Bundled] {
                let picked = select_asset(&assets, platform, flavor)
                    .expect("a portable asset per platform and flavor");
                assert!(
                    sums.contains_key(&picked.name),
                    "{} is downloaded but not listed in the published sums",
                    picked.name
                );
            }
        }
    }

    #[test]
    fn installed_tree_prefers_newest_version_and_reports_its_name() {
        let scratch = std::env::temp_dir().join(format!("monbooru-test-{}", uuid::Uuid::new_v4()));
        let exe = executable_relative(current_platform());
        for tag in ["v1.21.9", "v1.21.10", "v1.9.0"] {
            let dir = scratch.join(tag).join(exe);
            std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
            std::fs::write(&dir, b"binary").unwrap();
        }
        // A newer directory without the executable must be skipped.
        std::fs::create_dir_all(scratch.join("v2.0.0")).unwrap();

        let (name, found) = installed_tree(&scratch).unwrap();
        assert_eq!(name, "v1.21.10", "semver order, not string order");
        assert_eq!(found, scratch.join("v1.21.10").join(exe));
        assert_eq!(installed_version(&scratch), Some("v1.21.10".to_string()));
        assert_eq!(installed_executable(&scratch), Some(found));
        let _ = std::fs::remove_dir_all(&scratch);

        let empty = std::env::temp_dir().join(format!("monbooru-empty-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&empty).unwrap();
        assert!(installed_executable(&empty).is_none());
        assert!(installed_version(&empty).is_none());
        let _ = std::fs::remove_dir_all(&empty);
    }

    #[test]
    fn parse_version_accepts_a_short_tag() {
        assert_eq!(parse_version("v2.0"), Some(semver::Version::new(2, 0, 0)));
        assert_eq!(parse_version("1.2.3"), Some(semver::Version::new(1, 2, 3)));
        assert_eq!(parse_version("v"), None);
        assert_eq!(parse_version(".staging-1234"), None);
    }

    #[test]
    fn is_supported_matches_the_published_platforms() {
        assert!(platform_supported(Platform::Windows));
        assert!(platform_supported(Platform::Linux));
        assert!(!platform_supported(Platform::Macos));
        assert_eq!(is_supported(), platform_supported(current_platform()));
    }

    #[test]
    fn extract_zip_rejects_path_traversal() {
        use std::io::Write;
        let scratch = std::env::temp_dir().join(format!("monbooru-zip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&scratch).unwrap();
        let archive = scratch.join("bad.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        zip.start_file("../escape", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"nope").unwrap();
        zip.finish().unwrap();

        let dest = scratch.join("out");
        std::fs::create_dir_all(&dest).unwrap();
        assert!(extract_zip(&archive, &dest).is_err());
        assert!(!scratch.join("escape").exists());
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn archive_root_only_flattens_a_single_wrapper() {
        assert_eq!(archive_root(&["monbooru.exe".to_string()]), None);
        assert_eq!(
            archive_root(&[
                "monbooru_1.21.1_portable_lite_windows_amd64/".to_string(),
                "monbooru_1.21.1_portable_lite_windows_amd64/monbooru.exe".to_string(),
                "monbooru_1.21.1_portable_lite_windows_amd64/monbooru.toml".to_string(),
            ]),
            Some("monbooru_1.21.1_portable_lite_windows_amd64".to_string())
        );
        assert_eq!(
            archive_root(&["a\\x".to_string(), "b\\y".to_string()]),
            None,
            "two roots must not be flattened into each other"
        );
        assert_eq!(
            archive_root(&["..\\escape".to_string()]),
            None,
            "a traversal component must never become a wrapper"
        );
    }

    #[test]
    fn extract_zip_flattens_the_wrapper_like_the_real_archive() {
        use std::io::Write;
        let scratch = std::env::temp_dir().join(format!("monbooru-zip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&scratch).unwrap();
        let archive = scratch.join("monbooru.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        // The shape of the real monbooru_1.21.1_portable_lite_windows_amd64.zip:
        // one wrapper directory holding the payload.
        let wrapper = "monbooru_1.21.1_portable_lite_windows_amd64";
        for (name, body) in [
            (format!("{wrapper}/"), ""),
            (format!("{wrapper}/monbooru.exe"), "binary"),
            (format!("{wrapper}/monbooru.toml"), ""),
            (format!("{wrapper}/README.md"), "readme"),
            (format!("{wrapper}/LICENSE"), "licence"),
            (format!("{wrapper}/monbooru.ico"), "icon"),
        ] {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        }
        zip.finish().unwrap();

        let dest = scratch.join("out");
        std::fs::create_dir_all(&dest).unwrap();
        extract_zip(&archive, &dest).unwrap();
        assert!(
            dest.join("monbooru.exe").is_file(),
            "the executable must land where executable_relative looks for it"
        );
        assert!(dest.join("monbooru.toml").is_file());
        assert!(dest.join("README.md").is_file());
        assert!(!dest.join(wrapper).exists(), "the wrapper must be stripped");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// The glue the resolver relies on: an app data directory holding a managed
    /// install must resolve to the executable inside it.
    #[test]
    fn a_managed_install_resolves_from_the_app_data_directory() {
        let app_data = std::env::temp_dir().join(format!("monbooru-data-{}", uuid::Uuid::new_v4()));
        let root = managed_root(&app_data);
        let version_dir = root.join("v1.21.1");
        std::fs::create_dir_all(&version_dir).unwrap();
        let exe = version_dir.join(executable_relative(current_platform()));
        std::fs::write(&exe, b"stub").unwrap();

        assert_eq!(installed_executable(&root), Some(exe));
        assert_eq!(installed_version(&root), Some("v1.21.1".to_string()));
        let _ = std::fs::remove_dir_all(&app_data);
    }

    /// Opt-in check against the real artifact: point MONBOORU_TEST_ARCHIVE at a
    /// downloaded `monbooru_*_portable_lite_windows_amd64.zip` and run
    /// `cargo test -- --ignored`. The fixture above encodes the same layout, but
    /// only the real archive proves it.
    #[test]
    #[ignore]
    fn extracts_a_real_windows_archive_when_provided() {
        if current_platform() != Platform::Windows {
            return;
        }
        let Ok(archive) = std::env::var("MONBOORU_TEST_ARCHIVE") else {
            eprintln!("MONBOORU_TEST_ARCHIVE is not set; nothing to check");
            return;
        };
        let root = std::env::temp_dir().join(format!("monbooru-real-{}", uuid::Uuid::new_v4()));
        let version_dir = root.join("v1.21.1");
        std::fs::create_dir_all(&version_dir).unwrap();

        extract_zip(std::path::Path::new(&archive), &version_dir).unwrap();
        assert!(version_dir.join("monbooru.exe").is_file());
        assert!(version_dir.join("monbooru.toml").is_file());
        assert_eq!(
            installed_executable(&root),
            Some(version_dir.join("monbooru.exe"))
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Opt-in end-to-end install against GitHub: latest release lookup, asset
    /// selection, download, checksum verification, extraction and resolution.
    /// Run with `cargo test -- --ignored installs_the_latest_release`.
    #[tokio::test]
    #[ignore]
    async fn installs_the_latest_release_end_to_end() {
        if !is_supported() {
            return;
        }
        let root = std::env::temp_dir().join(format!("monbooru-e2e-{}", uuid::Uuid::new_v4()));
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .unwrap();
        let release = fetch_latest_release(&client).await.unwrap();
        let installed = install_release(&client, &release, &root, Flavor::Lite, &|_| {})
            .await
            .unwrap();

        assert!(installed.is_file(), "{installed:?} must exist");
        assert_eq!(installed_executable(&root), Some(installed));
        assert_eq!(installed_version(&root), Some(release.tag.clone()));
        let _ = std::fs::remove_dir_all(&root);
    }
}
