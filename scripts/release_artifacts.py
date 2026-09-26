#!/usr/bin/env python3
"""Collect the Windows installer and generate a complete, signed-platform updater manifest.

The fork releases for one platform only: `windows-x86_64`, built as an NSIS
installer by the `build` job in .github/workflows/release.yml. The bundle set is
asserted below on purpose, so a release that silently lost its installer fails
instead of publishing a manifest with no usable download.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


def collect(source: Path, output: Path, tag: str, repo: str):
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", tag):
        raise ValueError("Expected a semver release tag beginning with v")
    version = tag[1:]
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("Release output directory must be empty")
    suffixes = (".exe", ".exe.sig")
    for file in source.rglob("*"):
        if not file.is_file() or not file.name.endswith(suffixes):
            continue
        # GitHub normalizes spaces in uploaded release asset names to dots. Do
        # that before upload so the filename, checksum and updater URL agree.
        name = re.sub(r"\s+", ".", file.name)
        destination = output / name
        if destination.exists():
            raise ValueError(f"Duplicate release asset: {name}")
        shutil.copyfile(file, destination)

    def one(pattern):
        matches = list(output.glob(pattern))
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one {pattern}, found {len(matches)}")
        return matches[0]

    bundles = {
        "windows-x86_64": one(f"*_{version}_x64-setup.exe"),
    }
    # One installer and its signature, nothing else. A runner that leaves a
    # second .exe behind (an msi build, a downloaded "(1)" copy) would otherwise
    # publish two files a user has to choose between.
    expected = {bundles["windows-x86_64"].name, bundles["windows-x86_64"].name + ".sig"}
    extras = sorted(
        file.name for file in output.iterdir()
        if file.name.endswith((".exe", ".exe.sig")) and file.name not in expected
    )
    if extras:
        raise ValueError(f"Unexpected installers in the release: {extras}")
    platforms = {}
    for platform, bundle in bundles.items():
        signature = Path(str(bundle) + ".sig").read_text().strip()
        if not signature:
            raise ValueError(f"Empty signature for {bundle.name}")
        platforms[platform] = {
            "signature": signature,
            "url": f"https://github.com/{repo}/releases/download/{tag}/{quote(bundle.name)}",
        }
    manifest = {
        "version": version,
        "notes": f"MooshieUI {tag}",
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": platforms,
    }
    (output / "latest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    sums = []
    for file in sorted(output.iterdir()):
        with file.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        sums.append(f"{digest}  {file.name}\n")
    (output / "SHA256SUMS").write_text("".join(sums))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repo", required=True)
    args = parser.parse_args()
    result = collect(args.source, args.output, args.tag, args.repo)
    print("Prepared updater platforms:", ", ".join(result["platforms"]))
