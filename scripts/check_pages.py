#!/usr/bin/env python3
"""Check the built static site at both GitHub Pages URL shapes, without a browser.

Uses only Python's standard library. Verifies local references, JavaScript imports,
CSS assets, source ZIP integrity and packaging exclusions. This does not emulate
GitHub Actions, browser execution, MIME handling or an actual Pages deployment.
"""
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urljoin, urlsplit
from zipfile import ZipFile, BadZipFile
import json
import hashlib
import re
import sys

ROOT = Path(__file__).resolve().parent.parent


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []
        self.ids = set()

    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        if "id" in values:
            if values["id"] in self.ids:
                raise ValueError(f"Duplicate HTML ID: {values['id']}")
            self.ids.add(values["id"])
        if tag == "base":
            raise ValueError("A base element can break repository-path hosting")
        for attribute in ("src", "href", "poster"):
            if attribute in values:
                self.references.append((values[attribute], tag == "a"))


def check(dist):
    dist = Path(dist).resolve()
    if not (dist / "index.html").is_file() or not (dist / ".nojekyll").is_file():
        raise ValueError("Run npm run build first; index.html and .nojekyll are required")
    for name in ("overview.css", "fonts/Outfit-Latin.woff2", "fonts/Outfit-LatinExt.woff2", "fonts/OFL-Outfit.txt"):
        path = dist / name
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"Required frontend asset is missing or empty: {name}")
        if path.suffix == ".woff2" and path.read_bytes()[:4] != b"wOF2":
            raise ValueError(f"Frontend font is not a WOFF2 asset: {name}")
    pages = {}
    for page in dist.glob("*.html"):
        html = References()
        html.feed(page.read_text(encoding="utf-8"))
        pages[page.name] = html
    count = 0

    def reference(value, source="index.html", external_link=False):
        nonlocal count
        if value.startswith("#"):
            if source in pages and value[1:] and value[1:] not in pages[source].ids:
                raise ValueError(f"Missing HTML fragment: {value}")
            return
        scheme = urlsplit(value).scheme
        if scheme in ("data", "blob"):
            return
        if external_link and scheme in ("https", "http", "mailto"):
            return
        if scheme or value.startswith("/"):
            raise ValueError(f"Nonportable resource in {source}: {value}")
        for prefix in ("/", "/arbitrary-repository-name/"):
            base = f"https://example.github.io{prefix}"
            target = urlsplit(urljoin(urljoin(base, source), value))
            if target.netloc != "example.github.io" or not target.path.startswith(prefix):
                raise ValueError(f"Reference escapes Pages path in {source}: {value}")
            relative = unquote(target.path[len(prefix):])
            local = (dist / relative).resolve()
            if not local.is_relative_to(dist):
                raise ValueError(f"Reference escapes output directory: {value}")
            if local.is_dir():
                local = local / "index.html"
            if not local.is_file():
                raise ValueError(f"Missing local resource in {source}: {value}")
        count += 1

    for page, html in pages.items():
        for value, external_link in html.references:
            reference(value, source=page, external_link=external_link)
    for file in dist.rglob("*"):
        if file.is_symlink():
            raise ValueError(f"Symlink in Pages output: {file}")
        relative = file.relative_to(dist).as_posix()
        # The native build checks esbuild's import metadata and explicitly
        # packages its WASM assets. Regex-scanning third-party bundle comments
        # would misidentify prose or internal import-like strings as resources.
        if file.suffix in (".mjs", ".js") and relative not in {"native-bundle.mjs", "network-bundle.mjs"}:
            text = file.read_text(encoding="utf-8")
            for value in re.findall(r"\b(?:from\s*|import\s*\(?\s*)['\"]([^'\"]+)['\"]", text):
                reference(value, relative)
        if file.suffix == ".css":
            text = file.read_text(encoding="utf-8")
            if re.search(r"@import\b", text):
                raise ValueError("CSS imports require explicit review before publication")
            for value in re.findall(r"url\(\s*['\"]?([^)'\"]+)['\"]?\s*\)", text):
                reference(value.strip(), relative)

    native = json.loads((dist / "native-build.json").read_text(encoding="utf-8"))
    if type(native.get("enabled")) is not bool:
        raise ValueError("Native build manifest must explicitly enable or disable native mode")
    if native["enabled"]:
        if native.get("bundle") != "native-bundle.mjs" or not isinstance(native.get("assets"), list):
            raise ValueError("Native build manifest must identify its actual bundle and assets")
        for name in [native["bundle"], *native["assets"]]:
            if not isinstance(name, str) or (name != native["bundle"] and not name.startswith("native-assets/")):
                raise ValueError("Unexpected native asset path")
            reference(name)
            if (dist / name).stat().st_size == 0:
                raise ValueError("Native bundle/assets must be nonempty")
    elif (dist / "native-bundle.mjs").exists():
        raise ValueError("Disabled native build contains a stale native bundle")

    network = json.loads((dist / "network-build.json").read_text(encoding="utf-8"))
    if type(network.get("enabled")) is not bool:
        raise ValueError("Network build must explicitly enable or disable its real provider bundle")
    if network["enabled"]:
        if network.get("bundle") != "network-bundle.mjs" or network.get("mode") != "development-network-client":
            raise ValueError("Unexpected network build configuration")
        reference(network["bundle"])
        if len(network.get("wasmAssets", [])) != 3:
            raise ValueError("Network build requires actual onchain, ledger and ZKIR proving WASM")
        for asset in network["wasmAssets"]:
            if not asset.startswith("network-assets/"):
                raise ValueError("Unexpected network WASM location")
            reference(asset)
            if (dist / asset).read_bytes()[:4] != b"\0asm":
                raise ValueError("Network asset is not WASM")
        circuits = {"configureKeys", "enroll", "openVoting", "castBallot", "closeVoting", "submitDecryption", "finalize"}
        expected = {f"native-contract/{directory}/{circuit}.{extension}" for circuit in circuits
                    for directory, extension in [("keys", "prover"), ("keys", "verifier"), ("zkir", "bzkir")]}
        records = network.get("circuitAssets", [])
        if len(records) != len(expected) or {item.get("path") for item in records} != expected:
            raise ValueError("Network circuit asset set is incomplete")
        for item in records:
            reference(item["path"])
            content = (dist / item["path"]).read_bytes()
            if not content or len(content) != item.get("bytes") or hashlib.sha256(content).hexdigest() != item.get("sha256"):
                raise ValueError("Network circuit asset integrity mismatch")
        prover = network.get("browserProver", {})
        if prover.get("version") != "2.1.1" or prover.get("execution") != "dedicated-worker":
            raise ValueError("Browser proving worker is required")
        parameter_hashes = {
            7: "e82ae890c080188355f37feaffe91372584cd810615082d9143d4dec0453fd9d",
            13: "d3324910969c4cc54143b8045b649e5c3a4bd5fb7b8f85fe1b770f640ce1c803",
            15: "724c7c3d779148bb113c7ee9c034b2f27db16e6bdf315fde90105a9bad00b1de",
            16: "09c877216d6589b370263e18af40a030a901b41a7a7c37ef58c9901db41f05c6",
            17: "4a9ef6c7c0619aab74eede44b13e753e3ba54508a02dd3b7106a949aabb73b74",
        }
        params = prover.get("parameters", [])
        if len(params) != 5 or {item.get("k") for item in params} != set(parameter_hashes):
            raise ValueError("Browser proving parameter set is incomplete")
        for item in params:
            if item.get("path") != f'native-contract/params/bls_midnight_2p{item["k"]}' or item.get("sha256") != parameter_hashes[item["k"]]:
                raise ValueError("Public proving parameter does not match the official pin")
        for field, expected_path in [("worker", "native-prover-worker.mjs"), ("manifest", "native-contract/prover-manifest.json")]:
            if prover.get(field, {}).get("path") != expected_path:
                raise ValueError("Unexpected browser prover asset path")
        for item in [prover["worker"], prover["manifest"], *params]:
            reference(item["path"])
            content = (dist / item["path"]).read_bytes()
            if len(content) != item.get("bytes") or hashlib.sha256(content).hexdigest() != item.get("sha256"):
                raise ValueError("Browser prover asset integrity mismatch")
    elif (dist / "network-bundle.mjs").exists() or (dist / "native-contract").exists() or (dist / "native-prover-worker.mjs").exists():
        raise ValueError("Disabled network build contains stale code or proving assets")

    required = {
        "midnight-ballot-lab/LICENSE",
        "midnight-ballot-lab/NOTICE.md",
        "midnight-ballot-lab/THIRD_PARTY_NOTICES.md",
        "midnight-ballot-lab/AGENTS.md",
        "midnight-ballot-lab/contracts/package-lock.json",
        "midnight-ballot-lab/contracts/native/browser-providers.mjs",
        "midnight-ballot-lab/contracts/native/browser-wasm-proof.mjs",
        "midnight-ballot-lab/contracts/native/wasm-prover-worker.mjs",
        "midnight-ballot-lab/contracts/native/wasm-prover-assets.mjs",
        "midnight-ballot-lab/scripts/prepare-browser-prover-parameters.mjs",
        "midnight-ballot-lab/src/network.html",
        "midnight-ballot-lab/src/network-app.mjs",
        "midnight-ballot-lab/scripts/build-network-browser.mjs",
        "midnight-ballot-lab/scripts/test-native-browser.mjs",
        "midnight-ballot-lab/scripts/test-network-browser.mjs",
        "midnight-ballot-lab/scripts/test-deployed-browser.mjs",
        "midnight-ballot-lab/.github/workflows/pages.yml",
        "midnight-ballot-lab/.github/workflows/native-compact.yml",
        "midnight-ballot-lab/.github/workflows/devnet-acceptance.yml",
        "midnight-ballot-lab/docs/GITHUB_PAGES.md",
        "midnight-ballot-lab/scripts/check_pages.py",
        "midnight-ballot-lab/.gitignore",
        "midnight-ballot-lab/src/index.html",
        "midnight-ballot-lab/src/overview.css",
        "midnight-ballot-lab/src/fonts/Outfit-Latin.woff2",
        "midnight-ballot-lab/src/fonts/Outfit-LatinExt.woff2",
        "midnight-ballot-lab/src/fonts/OFL-Outfit.txt",
        "midnight-ballot-lab/src/fonts/README.md",
        "midnight-ballot-lab/docs/assets/ballot-lab-banner.svg",
        "midnight-ballot-lab/docs/assets/how-it-works.svg",
        "midnight-ballot-lab/docs/assets/threshold-tally.svg",
        "midnight-ballot-lab/contracts/native-election.compact",
        "midnight-ballot-lab/contracts/native/sdk-client.mjs",
        "midnight-ballot-lab/contracts/native/harness.mjs",
        "midnight-ballot-lab/contracts/native/verify-public.mjs",
        "midnight-ballot-lab/contracts/native/test/native-election.test.mjs",
        "midnight-ballot-lab/contracts/native/test/public-verifier.test.mjs",
        "midnight-ballot-lab/tests/native-adapter.test.mjs",
        "midnight-ballot-lab/docs/NATIVE_MIDNIGHT.md",
        "midnight-ballot-lab/src/native.html",
        "midnight-ballot-lab/src/native-app.mjs",
        "midnight-ballot-lab/src/native-loader.mjs",
        "midnight-ballot-lab/scripts/build-native-browser.mjs",
        "midnight-ballot-lab/contracts/devnet/package-lock.json",
        "midnight-ballot-lab/contracts/devnet/package.json",
        "midnight-ballot-lab/contracts/devnet/run-election.mjs",
        "midnight-ballot-lab/contracts/devnet/scheduled-operator.mjs",
        "midnight-ballot-lab/contracts/devnet/stage-runtime.mjs",
        "midnight-ballot-lab/contracts/devnet/probe.mjs",
        "midnight-ballot-lab/contracts/devnet/services.sh",
        "midnight-ballot-lab/scripts/ci-stop-devnet.sh",
    }
    with ZipFile(dist / "midnight-ballot-lab-source.zip") as archive:
        bad = archive.testzip()
        if bad:
            raise ValueError(f"Source ZIP checksum failed: {bad}")
        names = archive.namelist()
        if len(set(names)) != len(names) or not required.issubset(names):
            raise ValueError("Source ZIP has duplicate entries or omits deployment source")
        if any(archive.getinfo(name).file_size == 0 for name in required):
            raise ValueError("Source ZIP contains an empty required source file")
        forbidden = {".git", ".openai", "node_modules", "__pycache__", "private-state", "artifacts", "dist", "managed", ".runtime", ".npm-cache", "logs"}
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or path.parts[0] != "midnight-ballot-lab":
                raise ValueError(f"Unsafe source ZIP path: {name}")
            if forbidden.intersection(path.parts) or name.endswith((".pyc", ".secret.json")):
                raise ValueError(f"Excluded material entered source ZIP: {name}")
    return {"status": "passed", "localReferences": count, "sourceFiles": len(names),
            "nativeMode": "included" if native["enabled"] else "unavailable",
            "networkClient": "included" if network["enabled"] else "unavailable",
            "urlShapes": ["https://example.github.io/", "https://example.github.io/arbitrary-repository-name/"],
            "scope": "Static packaging and path checks; no browser or GitHub deployment execution"}


if __name__ == "__main__":
    try:
        print(json.dumps(check(sys.argv[1] if len(sys.argv) > 1 else ROOT / "dist")))
    except (OSError, ValueError, BadZipFile) as error:
        print(f"Pages packaging check failed: {error}", file=sys.stderr)
        sys.exit(1)
