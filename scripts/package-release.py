#!/usr/bin/env python3
"""Package already-checked static output, plus its public source download."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from shutil import copyfile
from zipfile import ZipFile, ZIP_DEFLATED
import json

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
OUT = ROOT / "artifacts" / "releases"
OUT.mkdir(parents=True, exist_ok=True)
for name in ("native-build.json", "network-build.json"):
    if json.loads((DIST / name).read_text(encoding="utf-8"))["enabled"] is not True:
        raise SystemExit("Actual native and network bundles are required")

source = OUT / f"Midnight_Ballot_Lab_{VERSION}_source.zip"
copyfile(DIST / "midnight-ballot-lab-source.zip", source)
site = OUT / f"Midnight_Ballot_Lab_{VERSION}_static.zip"
with ZipFile(site, "w", ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(DIST.rglob("*")):
        if path.is_symlink():
            raise SystemExit("Symlinks are excluded from release")
        if path.is_file():
            archive.write(path, "midnight-ballot-lab-site/" + path.relative_to(DIST).as_posix())
for path in (source, site):
    with ZipFile(path) as archive:
        if archive.testzip():
            raise SystemExit("Release archive CRC verification failed")
report = {"version": VERSION, "createdAt": datetime.now(timezone.utc).isoformat(),
          "artifacts": [{"file": path.name, "bytes": path.stat().st_size,
                         "sha256": sha256(path.read_bytes()).hexdigest()} for path in (source, site)],
          "scope": "Verified archive packaging; hosting and network acceptance have separate evidence."}
(OUT / "release-manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
