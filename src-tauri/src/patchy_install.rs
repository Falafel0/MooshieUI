//! Download and install the Patchy image editor from its GitHub releases.
//!
//! Mirrors the ComfyUI install flow: fetch the latest release, pick the
//! portable asset for this platform, verify its SHA-256 against the release's
//! `SHA256SUMS.txt`, and unpack it under `{app_data}/patchy/install/<tag>/`.
//!
//! Windows ships a portable `.zip`, macOS a `.dmg`, and Linux a `.flatpak`.
//! The Flatpak bundle needs the Flatpak runtime, which this app cannot
//! provision, so Linux is reported as unsupported ([`is_supported`]) and the
//! UI offers a manual install there instead.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use tokio::io::AsyncWriteExt;

const RELEASES_API: &str = "https://api.github.com/repos/SethRobinson/Patchy/releases/latest";
const RELEASE_DOWNLOAD: &str = "https://github.com/SethRobinson/Patchy/releases/download";
const SUMS_ASSET: &str = "SHA256SUMS.txt";
/// The GitHub API rejects requests that omit a User-Agent header.
const USER_AGENT: &str = "MooshieUI-Patchy-Installer";

/// The platform a Patchy asset is selected for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Macos,
    Linux,
}

/// The platform this binary is running on.
pub fn current_platform() -> Platform {
    #[cfg(target_os = "windows")]
    {
        Platform::Windows
    }
    #[cfg(target_os = "macos")]
    {
        Platform::Macos
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Platform::Linux
    }
}

/// False on Linux: the flatpak asset needs the Flatpak runtime, which the app
/// cannot provision, so the UI offers a manual install there instead.
pub fn is_supported() -> bool {
    !matches!(current_platform(), Platform::Linux)
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

/// Pick the portable asset for the platform. Windows: the name containing
/// "WindowsNoInstaller" and ending in ".zip" (NOT the Installer .exe).
/// macOS: the name ending in ".dmg". Linux: the name ending in ".flatpak".
/// Never returns SHA256SUMS.txt. Pure and unit-tested.
pub fn select_asset(assets: &[AssetRef], platform: Platform) -> Option<AssetRef> {
    assets
        .iter()
        .find(|asset| {
            if asset.name == SUMS_ASSET {
                return false;
            }
            match platform {
                Platform::Windows => {
                    asset.name.contains("WindowsNoInstaller") && asset.name.ends_with(".zip")
                }
                Platform::Macos => asset.name.ends_with(".dmg"),
                Platform::Linux => asset.name.ends_with(".flatpak"),
            }
        })
        .cloned()
}

/// Parse a SHA256SUMS.txt body ("<hex>  <filename>" per line, possibly with a
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

/// <app_data>/patchy/install
pub fn managed_root(app_data: &Path) -> PathBuf {
    app_data.join("patchy").join("install")
}

/// The executable of the newest installed version under `root`, or None.
/// Version directories are sorted so `v0.99` beats `v0.9`; the platform exe
/// name inside them is patchy.exe / Patchy.app/Contents/MacOS/Patchy.
pub fn installed_executable(root: &Path) -> Option<PathBuf> {
    let mut versions: Vec<(semver::Version, PathBuf)> = Vec::new();
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(version) = parse_version(&name) else {
            continue;
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        versions.push((version, path));
    }
    // Newest first, so `v0.99` wins over `v0.9`.
    versions.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, dir) in versions {
        let exe = dir.join(executable_relative(current_platform()));
        if exe.is_file() {
            return Some(exe);
        }
    }
    None
}

/// Parse a version directory name such as `v0.99`, `v0.9`, or `1.2.3`.
/// Patchy tags are not full semver (`v0.99` has no patch component), so the
/// missing components default to zero.
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

/// Path of the Patchy executable relative to its version directory.
fn executable_relative(platform: Platform) -> &'static str {
    match platform {
        Platform::Windows => "patchy.exe",
        Platform::Macos => "Patchy.app/Contents/MacOS/Patchy",
        Platform::Linux => "patchy",
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

/// GET https://api.github.com/repos/SethRobinson/Patchy/releases/latest with a
/// User-Agent header (the API rejects requests without one).
pub async fn fetch_latest_release(client: &reqwest::Client) -> Result<ReleaseRef, String> {
    let response = client
        .get(RELEASES_API)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub for the Patchy release: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub returned an error for the Patchy release: {e}"))?;
    let release: ApiRelease = response
        .json()
        .await
        .map_err(|e| format!("Could not parse the Patchy release metadata: {e}"))?;
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

/// Download the platform asset plus SHA256SUMS.txt, verify the checksum, and
/// extract into <root>/<tag>/. Returns the absolute executable path.
/// Linux: Err explaining that automatic installation is unsupported there.
pub async fn install_release(
    client: &reqwest::Client,
    release: &ReleaseRef,
    root: &Path,
    on_progress: &(dyn Fn(InstallProgress) + Send + Sync),
) -> Result<PathBuf, String> {
    if !is_supported() {
        return Err(
            "Automatic installation of Patchy is not supported on Linux: the release ships a \
             Flatpak bundle that requires the Flatpak runtime. Install Patchy manually from \
             https://github.com/SethRobinson/Patchy/releases"
                .to_string(),
        );
    }
    let platform = current_platform();
    let asset = select_asset(&release.assets, platform).ok_or_else(|| {
        format!(
            "Release {} has no Patchy build for this platform.",
            release.tag
        )
    })?;

    // Prefer the URL the API gave us for SHA256SUMS.txt; fall back to the
    // deterministic release-download URL.
    let sums_url = release
        .assets
        .iter()
        .find(|a| a.name == SUMS_ASSET)
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
        .map_err(|e| format!("Could not create the Patchy install directory: {e}"))?;
    // Stage under a dot-directory so a half-written download can never be
    // mistaken for an installed version by `installed_executable`.
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("Could not create the Patchy staging directory: {e}"))?;
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
        .map_err(|e| format!("Could not create the Patchy download file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    // `Response::chunk` streams the body without reqwest's `stream` feature,
    // which this crate does not enable.
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Patchy download interrupted: {e}"))?
    {
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Could not write the Patchy download: {e}"))?;
        on_progress(InstallProgress::Downloading {
            downloaded,
            total: asset.size,
        });
    }
    file.flush()
        .await
        .map_err(|e| format!("Could not flush the Patchy download: {e}"))?;
    drop(file);

    on_progress(InstallProgress::Verifying);
    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "Patchy download failed checksum verification (expected {expected}, got {actual})."
        ));
    }

    on_progress(InstallProgress::Extracting);
    let version_dir = root.join(tag);
    if version_dir.exists() {
        std::fs::remove_dir_all(&version_dir)
            .map_err(|e| format!("Could not clear the previous Patchy install: {e}"))?;
    }
    std::fs::create_dir_all(&version_dir)
        .map_err(|e| format!("Could not create the Patchy version directory: {e}"))?;

    match platform {
        Platform::Windows => extract_zip(download, &version_dir)?,
        #[cfg(target_os = "macos")]
        Platform::Macos => extract_dmg(download, &version_dir)?,
        #[cfg(not(target_os = "macos"))]
        Platform::Macos => {
            return Err("Patchy disk images can only be installed on macOS.".to_string())
        }
        Platform::Linux => {
            return Err("Automatic installation of Patchy is not supported on Linux.".to_string())
        }
    }

    let exe = version_dir.join(executable_relative(platform));
    if !exe.is_file() {
        return Err(format!(
            "The Patchy archive did not contain the expected executable ({}).",
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
                return Err(format!("Unsafe path in Patchy archive: {name}"));
            }
        }
    }
    Ok(out)
}

/// The single wrapper directory shared by every entry, if there is one.
///
/// Patchy's Windows archive stores its payload under `Patchy\` and separates
/// names with backslashes, so names are normalised before anything else reads
/// them. Returns None for an archive whose files already sit at the top level,
/// or one with more than one root.
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
        .map_err(|e| format!("Could not open the Patchy archive: {e}"))?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| format!("Invalid Patchy ZIP archive: {e}"))?;
    let mut names = Vec::with_capacity(zip.len());
    for index in 0..zip.len() {
        let entry = zip
            .by_index(index)
            .map_err(|e| format!("Invalid Patchy ZIP entry: {e}"))?;
        names.push(entry.name().to_string());
    }
    // Flattening the wrapper keeps the executable where `executable_relative`
    // looks for it.
    let wrapper = archive_root(&names);
    for (index, raw_name) in names.iter().enumerate() {
        let mut entry = zip
            .by_index(index)
            .map_err(|e| format!("Invalid Patchy ZIP entry: {e}"))?;
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

/// Mount the `.dmg`, copy the `.app` bundle out, and always detach the mount.
#[cfg(target_os = "macos")]
fn extract_dmg(archive: &Path, dest: &Path) -> Result<(), String> {
    use std::process::Command;

    let mount = std::env::temp_dir().join(format!("patchy-mount-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&mount).map_err(|e| format!("Could not create mount point: {e}"))?;
    let mount_str = mount.to_string_lossy().to_string();

    let attach = Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-readonly", "-mountpoint"])
        .arg(&mount_str)
        .arg(archive)
        .status()
        .map_err(|e| format!("Could not run hdiutil attach: {e}"))?;
    if !attach.success() {
        let _ = std::fs::remove_dir(&mount);
        return Err("hdiutil attach failed for the Patchy disk image.".to_string());
    }

    // Always detach, even if the copy below fails.
    let copied = copy_app_from(&mount, dest);
    let detach = Command::new("hdiutil")
        .args(["detach", &mount_str])
        .status();
    if detach.map(|s| !s.success()).unwrap_or(true) {
        log::warn!("hdiutil detach failed for {mount_str}");
    }
    let _ = std::fs::remove_dir(&mount);
    copied
}

/// Find the `.app` bundle inside a mounted image and copy it into `dest`.
#[cfg(target_os = "macos")]
fn copy_app_from(mount: &Path, dest: &Path) -> Result<(), String> {
    let bundle = std::fs::read_dir(mount)
        .map_err(|e| format!("Could not read the mounted Patchy image: {e}"))?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .ok_or_else(|| "The Patchy disk image did not contain an .app bundle.".to_string())?;
    let target = dest.join(
        bundle
            .file_name()
            .ok_or_else(|| "Invalid Patchy bundle name.".to_string())?,
    );
    copy_dir_all(&bundle, &target)?;
    Ok(())
}

/// Recursively copy a directory tree.
#[cfg(target_os = "macos")]
fn copy_dir_all(source: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("Could not create {dest:?}: {e}"))?;
    for entry in std::fs::read_dir(source).map_err(|e| format!("Could not read {source:?}: {e}"))? {
        let entry = entry.map_err(|e| format!("Could not read an entry in {source:?}: {e}"))?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| format!("Could not copy {from:?}: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The five real assets from the `v0.99` release.
    fn fixture() -> Vec<AssetRef> {
        [
            ("PatchyWindowsInstaller.exe", 61_600_000u64),
            ("PatchyWindowsNoInstaller.zip", 61_500_000),
            ("PatchyMacOS.dmg", 66_700_000),
            ("PatchyLinux.flatpak", 32_500_000),
            ("SHA256SUMS.txt", 300),
        ]
        .into_iter()
        .map(|(name, size)| AssetRef {
            name: name.to_string(),
            url: format!("https://github.com/SethRobinson/Patchy/releases/download/v0.99/{name}"),
            size,
        })
        .collect()
    }

    #[test]
    fn select_asset_picks_the_portable_build_per_platform() {
        let assets = fixture();
        assert_eq!(
            select_asset(&assets, Platform::Windows).unwrap().name,
            "PatchyWindowsNoInstaller.zip"
        );
        assert_eq!(
            select_asset(&assets, Platform::Macos).unwrap().name,
            "PatchyMacOS.dmg"
        );
        assert_eq!(
            select_asset(&assets, Platform::Linux).unwrap().name,
            "PatchyLinux.flatpak"
        );
    }

    #[test]
    fn select_asset_never_returns_installer_or_sums() {
        for platform in [Platform::Windows, Platform::Macos, Platform::Linux] {
            let picked = select_asset(&fixture(), platform).unwrap();
            assert_ne!(picked.name, "PatchyWindowsInstaller.exe");
            assert_ne!(picked.name, SUMS_ASSET);
        }
        assert!(select_asset(&[], Platform::Windows).is_none());
    }

    #[test]
    fn parse_sha256sums_handles_real_format_and_star_prefix() {
        let body = "\
d1e2f3  PatchyWindowsNoInstaller.zip
aabbccdd  *PatchyMacOS.dmg

# comment
notahashline
0011  PatchyLinux.flatpak
";
        let sums = parse_sha256sums(body);
        assert_eq!(
            sums.get("PatchyWindowsNoInstaller.zip").map(String::as_str),
            Some("d1e2f3")
        );
        assert_eq!(
            sums.get("PatchyMacOS.dmg").map(String::as_str),
            Some("aabbccdd")
        );
        assert_eq!(
            sums.get("PatchyLinux.flatpak").map(String::as_str),
            Some("0011")
        );
        assert!(!sums.contains_key("notahashline"));
        assert_eq!(sums.len(), 3);
    }

    /// The `SHA256SUMS.txt` body the `v0.99` release publishes, verbatim. It is
    /// what the installer downloads and parses before unpacking anything, so its
    /// shape and the names in it are a real interface, not an assumption.
    const RELEASE_V099_SUMS: &str = "\
2a8ed963cb5a4af6dc1079b476874a9880b6881d5b4c4a68d240ce841e3bcf94  PatchyWindowsInstaller.exe
bcb5b184444f46b47276f4b56bb538737dce3906b1ccd6b9da06314d80cc293b  PatchyWindowsNoInstaller.zip
d06ca7a0f96998ba04828068102cdb80eeb201b8520eb4958007f4641056335a  PatchyMacOS.dmg
507d79a2192df570b94e342ce30f5b18486501c45bebbb14f18e1f0bc27f42a5  PatchyLinux.flatpak
";

    #[test]
    fn the_published_release_sums_parse_with_every_asset_covered() {
        let sums = parse_sha256sums(RELEASE_V099_SUMS);
        assert_eq!(sums.len(), 4, "every published line is a checksum");
        assert_eq!(
            sums.get("PatchyWindowsNoInstaller.zip").map(String::as_str),
            Some("bcb5b184444f46b47276f4b56bb538737dce3906b1ccd6b9da06314d80cc293b"),
            "the checksum the portable Windows build is verified against"
        );
        // A missing entry makes the installer refuse that platform outright.
        for name in [
            "PatchyWindowsInstaller.exe",
            "PatchyWindowsNoInstaller.zip",
            "PatchyMacOS.dmg",
            "PatchyLinux.flatpak",
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
        let sums = parse_sha256sums(RELEASE_V099_SUMS);
        for platform in [Platform::Windows, Platform::Macos] {
            let picked = select_asset(&assets, platform).expect("a portable asset per platform");
            assert!(
                sums.contains_key(&picked.name),
                "{} is downloaded but not listed in the published sums",
                picked.name
            );
        }
    }

    #[test]
    fn installed_executable_prefers_newest_version() {
        let scratch = std::env::temp_dir().join(format!("patchy-test-{}", uuid::Uuid::new_v4()));
        let exe = executable_relative(current_platform());
        for tag in ["v0.9", "v0.99"] {
            let dir = scratch.join(tag).join(exe);
            std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
            std::fs::write(&dir, b"binary").unwrap();
        }
        // A newer directory without the executable must be skipped.
        std::fs::create_dir_all(scratch.join("v1.0")).unwrap();

        let found = installed_executable(&scratch).unwrap();
        assert!(found.starts_with(scratch.join("v0.99")));
        let _ = std::fs::remove_dir_all(&scratch);

        let empty = std::env::temp_dir().join(format!("patchy-empty-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&empty).unwrap();
        assert!(installed_executable(&empty).is_none());
        let _ = std::fs::remove_dir_all(&empty);
    }

    #[test]
    fn is_supported_is_false_only_on_linux() {
        assert_eq!(
            is_supported(),
            !matches!(current_platform(), Platform::Linux)
        );
    }

    #[test]
    fn extract_zip_rejects_path_traversal() {
        use std::io::Write;
        let scratch = std::env::temp_dir().join(format!("patchy-zip-{}", uuid::Uuid::new_v4()));
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
        assert_eq!(archive_root(&["patchy.exe".to_string()]), None);
        assert_eq!(
            archive_root(&[
                "Patchy\\".to_string(),
                "Patchy\\patchy.exe".to_string(),
                "Patchy\\ai\\model.onnx".to_string(),
            ]),
            Some("Patchy".to_string())
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
    fn extract_zip_flattens_the_wrapper_and_backslash_names() {
        use std::io::Write;
        let scratch = std::env::temp_dir().join(format!("patchy-zip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&scratch).unwrap();
        let archive = scratch.join("patchy.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        // This is the shape of the real PatchyWindowsNoInstaller.zip: a
        // `Patchy` wrapper directory and backslash separators.
        for (name, body) in [
            ("Patchy\\", ""),
            ("Patchy\\patchy.exe", "binary"),
            ("Patchy\\ai\\model.onnx", "weights"),
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
            dest.join("patchy.exe").is_file(),
            "the executable must land where executable_relative looks for it"
        );
        assert!(dest.join("ai").join("model.onnx").is_file());
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// Opt-in check against the real artifact: point PATCHY_TEST_ARCHIVE at a
    /// downloaded `PatchyWindowsNoInstaller.zip` and run
    /// `cargo test -- --ignored`. The fixture above encodes the same layout, but
    /// only the real archive proves it.
    #[test]
    #[ignore]
    fn extracts_a_real_windows_archive_when_provided() {
        if current_platform() != Platform::Windows {
            return;
        }
        let Ok(archive) = std::env::var("PATCHY_TEST_ARCHIVE") else {
            eprintln!("PATCHY_TEST_ARCHIVE is not set; nothing to check");
            return;
        };
        let root = std::env::temp_dir().join(format!("patchy-real-{}", uuid::Uuid::new_v4()));
        let version_dir = root.join("v0.99");
        std::fs::create_dir_all(&version_dir).unwrap();

        extract_zip(std::path::Path::new(&archive), &version_dir).unwrap();
        // Guards against passing vacuously if the archive were never extracted.
        // The count is recursive: flattening the wrapper leaves about 43
        // top-level entries holding the rest of the ~140 files.
        fn count_files(dir: &std::path::Path) -> usize {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return 0;
            };
            entries
                .flatten()
                .map(|entry| {
                    let path = entry.path();
                    if path.is_dir() {
                        count_files(&path)
                    } else {
                        1
                    }
                })
                .sum()
        }
        let extracted = count_files(&version_dir);
        assert!(
            extracted > 100,
            "only {extracted} files came out of {archive}"
        );
        assert!(version_dir.join("patchy.exe").is_file());
        assert!(version_dir.join("patchy-mcp.exe").is_file());
        assert_eq!(
            installed_executable(&root),
            Some(version_dir.join("patchy.exe"))
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
        let root = std::env::temp_dir().join(format!("patchy-e2e-{}", uuid::Uuid::new_v4()));
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .unwrap();
        let release = fetch_latest_release(&client).await.unwrap();
        let installed = install_release(&client, &release, &root, &|_| {})
            .await
            .unwrap();

        assert!(installed.is_file(), "{installed:?} must exist");
        assert_eq!(installed_executable(&root), Some(installed));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The glue the resolver relies on: an app data directory holding a managed
    /// install must resolve to the executable inside it.
    #[test]
    fn a_managed_install_resolves_from_the_app_data_directory() {
        let app_data = std::env::temp_dir().join(format!("patchy-data-{}", uuid::Uuid::new_v4()));
        let root = managed_root(&app_data);
        let version_dir = root.join("v0.99");
        std::fs::create_dir_all(&version_dir).unwrap();
        let exe = version_dir.join(executable_relative(current_platform()));
        // On macOS the relative path nests into Patchy.app/Contents/MacOS, and
        // `write` does not create parents.
        if let Some(parent) = exe.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&exe, b"stub").unwrap();

        assert_eq!(installed_executable(&root), Some(exe));
        let _ = std::fs::remove_dir_all(&app_data);
    }
}
