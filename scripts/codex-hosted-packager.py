#!/usr/bin/env python3
"""Trusted-controller candidate: reproducible, bounded tracked-tree archive.

Read only Git objects at a pinned commit; do not archive the working directory.
Does not authenticate owner approval, install dependencies or upload files.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile

MAX_FILES = 5000
MAX_FILE = 5 * 1024 * 1024
MAX_TOTAL = 40 * 1024 * 1024
MAX_ARCHIVE = 50 * 1024 * 1024
SHA = re.compile(r"^[a-f0-9]{40}$")
SECRET = re.compile(rb"(?:sk-proj-[A-Za-z0-9_-]{10,}|github_pat_[A-Za-z0-9_]{10,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)", re.I)
FORBIDDEN = {".git", "node_modules", ".env", ".venv", "__pycache__", ".npm", ".pnpm-store"}

class PackagingDenied(ValueError):
    pass

def git(repo: Path, *args: str) -> bytes:
    result = subprocess.run(["git", "-C", str(repo), *args], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, check=False, timeout=30)
    if result.returncode != 0:
        raise PackagingDenied("git-object-unavailable")
    return result.stdout

def safe_path(raw: bytes) -> str:
    try:
        name = raw.decode("utf-8", "strict")
    except UnicodeDecodeError as exc:
        raise PackagingDenied("invalid-path-encoding") from exc
    parts = name.split("/")
    if (not name or len(name) > 240 or name.startswith("/") or "\\" in name or
        any(not p or p in (".", "..") or p in FORBIDDEN or p.startswith(".env") or
            any(ord(c) < 32 or ord(c) == 127 for c in p) for p in parts)):
        raise PackagingDenied("unsafe-source-path")
    return name

def package(repo: Path, source: str, destination: Path) -> dict:
    if not SHA.fullmatch(source):
        raise PackagingDenied("source-sha")
    resolved = git(repo, "rev-parse", "--verify", source + "^{commit}").decode().strip()
    if resolved != source:
        raise PackagingDenied("source-not-commit")
    listing = git(repo, "ls-tree", "-rz", "--full-tree", source)
    records = listing.split(b"\0")
    if records[-1] != b"":
        raise PackagingDenied("incomplete-tree-listing")
    if len(records) - 1 > MAX_FILES:
        raise PackagingDenied("too-many-source-files")
    files = []
    total = 0
    for record in records[:-1]:
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode, kind, object_sha = metadata.decode("ascii").split(" ")
        except (ValueError, UnicodeError) as exc:
            raise PackagingDenied("malformed-tree-entry") from exc
        if mode not in ("100644", "100755") or kind != "blob" or not SHA.fullmatch(object_sha):
            raise PackagingDenied("nonregular-source-entry")
        # Never send dotfiles or workflows to an untrusted coding sandbox.
        # This repository intentionally tracks .github and .gitignore, which are
        # omitted from the *agent archive*, not treated as an invalid repository.
        if any(part.startswith(".") for part in raw_path.decode("utf-8", "strict").split("/")):
            continue
        name = safe_path(raw_path)
        size_text = git(repo, "cat-file", "-s", object_sha).decode().strip()
        try:
            size = int(size_text)
        except ValueError as exc:
            raise PackagingDenied("source-size") from exc
        total += size
        if size > MAX_FILE or total > MAX_TOTAL:
            raise PackagingDenied("source-size")
        data = git(repo, "cat-file", "blob", object_sha)
        if len(data) != size or SECRET.search(data):
            raise PackagingDenied("source-secret-or-size")
        files.append((name, data))
    if not files:
        raise PackagingDenied("empty-source-tree")
    files.sort(key=lambda item: item[0])
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_name = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".sovereign-source-", dir=destination.parent, delete=False) as tmp:
            tmp_name = tmp.name
            with gzip.GzipFile(fileobj=tmp, mode="wb", filename="", mtime=0, compresslevel=6) as gz:
                with tarfile.open(fileobj=gz, mode="w", format=tarfile.PAX_FORMAT) as tar:
                    for name, data in files:
                        info = tarfile.TarInfo(name)
                        info.size = len(data)
                        info.mode = 0o644
                        info.uid = info.gid = info.mtime = 0
                        info.uname = info.gname = ""
                        tar.addfile(info, io.BytesIO(data))
        if os.path.getsize(tmp_name) > MAX_ARCHIVE:
            raise PackagingDenied("archive-size")
        digest = hashlib.sha256(Path(tmp_name).read_bytes()).hexdigest()
        os.replace(tmp_name, destination)
        tmp_name = None
        return {"sourceSha": source, "sha256": digest, "bytes": destination.stat().st_size,
                "files": len(files), "uncompressedBytes": total}
    finally:
        if tmp_name is not None:
            Path(tmp_name).unlink(missing_ok=True)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(package(args.repo, args.source, args.output), sort_keys=True))
    except (PackagingDenied, OSError, subprocess.TimeoutExpired) as exc:
        raise SystemExit("archive-denied: " + type(exc).__name__) from None

if __name__ == "__main__":
    main()
