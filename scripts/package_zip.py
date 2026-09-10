"""Create a sanitized NTK Note handoff ZIP.

Usage:
    python scripts/package_zip.py NTK-note-connections-groups-live-antigravity-verified.zip

The archive deliberately excludes local secrets, generated build caches, repository metadata,
and previous ZIP files. It validates the final archive before reporting success.
"""
from __future__ import annotations

import fnmatch
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_NAME = sys.argv[1] if len(sys.argv) > 1 else "NTK-note-sanitized-handoff.zip"
OUTPUT = ROOT / Path(OUTPUT_NAME).name

EXCLUDED_DIRS = {
    "node_modules", ".git", ".firebase", ".tempmediaStorage", "__pycache__", "dist", ".wrangler"
}
EXCLUDED_FILES = {"test.css", "rewrite_store.py", ".DS_Store", "Thumbs.db"}
EXCLUDED_GLOBS = ["*.log", "*.zip", "*.tar.gz", "*.pyc", ".env", ".env.local", ".env.*.local"]
REQUIRED = {
    ".firebaserc", "firebase.json", "firestore.rules", "firestore.indexes.json",
    "package.json", "package-lock.json", "src/App.tsx", "src/utils/ntkAi.ts",
    "src/components/AiSettingsPanel.tsx", "cloudflare/ntk-gateway/src/index.ts",
    "cloudflare/ntk-gateway/wrangler.toml", "cloudflare/ntk-gateway/README.md", ".env.example",
}


def excluded(rel: Path) -> bool:
    if any(part in EXCLUDED_DIRS for part in rel.parts):
        return True
    if rel.name in EXCLUDED_FILES:
        return True
    text = rel.as_posix()
    return any(fnmatch.fnmatch(rel.name, pattern) or fnmatch.fnmatch(text, pattern) for pattern in EXCLUDED_GLOBS)


def main() -> None:
    if OUTPUT.exists():
        OUTPUT.unlink()

    files: list[tuple[Path, str]] = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if path == OUTPUT or excluded(rel):
            continue
        files.append((path, rel.as_posix()))

    names = {name for _, name in files}
    missing = sorted(REQUIRED - names)
    if missing:
        raise SystemExit(f"Packaging stopped: missing required files: {', '.join(missing)}")

    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path, name in sorted(files, key=lambda item: item[1]):
            archive.write(path, name)

    with zipfile.ZipFile(OUTPUT) as archive:
        packaged = archive.namelist()
        forbidden = [
            name for name in packaged
            if name == ".env" or name == ".env.local" or (name.startswith(".env.") and name.endswith(".local")) or name.startswith(".git/")
            or name.startswith(".firebase/") or name.startswith("node_modules/")
            or name.startswith("dist/") or name.endswith(".log") or name.endswith(".zip")
        ]
        if forbidden:
            OUTPUT.unlink(missing_ok=True)
            raise SystemExit(f"Packaging stopped: forbidden files found: {', '.join(forbidden[:20])}")

    print(f"Created {OUTPUT.name}: {OUTPUT.stat().st_size / (1024*1024):.2f} MB, {len(files)} files")
    print("Sanitization check: PASS")


if __name__ == "__main__":
    main()
