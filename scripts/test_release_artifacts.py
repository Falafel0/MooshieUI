import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("release_artifacts", Path(__file__).with_name("release_artifacts.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReleaseArtifactsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "source"
        self.source.mkdir()
        self.output = Path(self.temp.name) / "output"
        name = "MooshieUI Fork_2.3.1_x64-setup.exe"
        (self.source / name).write_bytes(b"signed installer content")
        (self.source / (name + ".sig")).write_text("signature")
        # Bundles the Windows-only release no longer publishes; they must be
        # ignored even when a runner happens to leave them behind.
        for other in ("MooshieUI Fork_2.3.1_amd64.AppImage", "MooshieUI_2.3.1_aarch64.dmg"):
            (self.source / other).write_bytes(b"other platform")

    def collect(self):
        return module.collect(self.source, self.output, "v2.3.1", "example/app")

    def test_only_the_windows_installer_is_published(self):
        result = self.collect()
        self.assertEqual(list(result["platforms"]), ["windows-x86_64"])
        self.assertFalse(list(self.output.glob("*.AppImage")))
        self.assertFalse(list(self.output.glob("*.dmg")))
        self.assertIn("latest.json", (self.output / "SHA256SUMS").read_text())

    def test_updater_urls_match_github_normalized_asset_names(self):
        result = self.collect()
        url = result["platforms"]["windows-x86_64"]["url"]
        self.assertIn("MooshieUI.Fork_", url)
        self.assertNotIn("MooshieUI%20Fork_", url)
        self.assertTrue((self.output / "MooshieUI.Fork_2.3.1_x64-setup.exe").is_file())

    def test_missing_or_wrong_version_installer_blocks_release(self):
        (self.source / "MooshieUI Fork_2.3.1_x64-setup.exe").rename(self.source / "MooshieUI Fork_2.3.0_x64-setup.exe")
        with self.assertRaises(ValueError):
            self.collect()

    def test_empty_signature_blocks_release(self):
        (self.source / "MooshieUI Fork_2.3.1_x64-setup.exe.sig").write_text("")
        with self.assertRaises(ValueError):
            self.collect()

    def test_a_second_installer_blocks_release(self):
        (self.source / "MooshieUI Fork_2.3.1_x64-setup (1).exe").write_bytes(b"duplicate")
        with self.assertRaises(ValueError):
            self.collect()


if __name__ == "__main__":
    unittest.main()
