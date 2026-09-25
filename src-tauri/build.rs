fn main() {
    // rust-embed requires `../dist/` to exist at compile time. In CI or a
    // fresh checkout we may build before `npm run build` has produced the
    // frontend bundle, so create an empty placeholder if it's missing.
    let dist = std::path::Path::new("../dist");
    if !dist.exists() {
        let _ = std::fs::create_dir_all(dist);
    }
    println!("cargo:rerun-if-changed=../dist");

    #[cfg(feature = "desktop")]
    {
        if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
            embed_app_manifest_on_windows();
        } else {
            tauri_build::build();
        }
    }
}

/// Embed `app.manifest` into **every** linked target on Windows/MSVC.
///
/// tauri-build's default puts the application manifest in the resource file it
/// links with `rustc-link-arg-bins`, which reaches the app binary only. The lib
/// unit-test harness links wry/tao, whose Windows backend imports comctl32 v6
/// symbols (`TaskDialogIndirect`, `SetWindowSubclass`, ...). Without a
/// common-controls v6 manifest the loader binds the legacy comctl32 5.82, which
/// does not export them, so every `cargo test` executable aborts before running
/// a single test with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139).
///
/// `rustc-link-arg-tests` does not help: cargo applies it to integration tests
/// under `tests/` only, never to the lib unit-test binary
/// (<https://github.com/rust-lang/cargo/issues/10937>). The catch-all
/// `rustc-link-arg` is the only instruction that reaches every link
/// invocation, so the manifest goes in through it and tauri-build is switched
/// to `new_without_app_manifest()` so the two embeds do not collide on a
/// duplicate RT_MANIFEST resource (LNK1123/CVT1100).
///
/// `app.manifest` is byte-identical to tauri-build's default
/// (`tauri-build/src/windows-app-manifest.xml`), so the app binary ships the
/// same manifest it did before.
#[cfg(feature = "desktop")]
fn embed_app_manifest_on_windows() {
    let manifest =
        std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("app.manifest");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
    )
    .expect("failed to run tauri-build");
}
