"""Offline, credential-free Git patch reconstruction for untrusted Codex proposals.

Never execute generated code or use this process with a GitHub publisher token.
The caller must independently authenticate the frozen scope and source commit.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

MAX_PATCH = 1_500_000
MAX_MANIFEST = 32 * 1024
MAX_FILES = 25
SHA = re.compile(r'^[0-9a-f]{40}$')
DIGEST = re.compile(r'^[0-9a-f]{64}$')
SAFE_PATH = re.compile(r'^(?:apps|packages)/[A-Za-z0-9_./-]+\\.(?:ts|tsx)$')
SECRETS = re.compile(rb'(?:sk-proj-|github_pat_|-----BEGIN .*PRIVATE KEY-----)', re.I)


def deny(reason):
    raise SystemExit('REJECT: ' + reason)


def git(*args, env=None, data=None):
    p = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.quotepath=false',
                        '-c', 'diff.external=', *args], input=data, capture_output=True,
                       env=env, check=False)
    if p.returncode:
        deny('git-' + args[0])
    return p.stdout


def safe_path(path):
    return (isinstance(path, str) and len(path) < 200 and bool(SAFE_PATH.fullmatch(path))
            and not any(part.startswith('.') or part in ('node_modules', 'prisma', 'migrations', 'secrets')
                        for part in path.split('/')))


def parse_json(path, limit):
    data = Path(path).read_bytes()
    if len(data) > limit:
        deny('oversized-json')
    try:
        return json.loads(data)
    except (ValueError, UnicodeError):
        deny('invalid-json')


def verify(scope_path, manifest_path, patch_path):
    scope = parse_json(scope_path, MAX_MANIFEST)
    manifest = parse_json(manifest_path, MAX_MANIFEST)
    expected = scope.get('sourceSha')
    allowed = scope.get('approvedPaths')
    digest = scope.get('scopeDigest')
    if (not isinstance(expected, str) or not SHA.fullmatch(expected)
        or not isinstance(digest, str) or not DIGEST.fullmatch(digest)
        or not isinstance(allowed, list) or not (1 <= len(allowed) <= MAX_FILES)
        or len(allowed) != len(set(allowed)) or any(not safe_path(p) for p in allowed)):
        deny('scope')
    if git('rev-parse', 'HEAD').decode().strip() != expected:
        deny('source-head')
    if git('status', '--porcelain=v1', '-z', '--untracked-files=all'):
        deny('dirty-source')
    patch = Path(patch_path).read_bytes()
    if not patch or len(patch) > MAX_PATCH or b'\0' in patch or SECRETS.search(patch):
        deny('patch-bytes')
    if (manifest.get('format') != 'sovereign-codex-proposal-v1'
        or manifest.get('source_sha') != expected or manifest.get('scope_digest') != digest
        or manifest.get('patch_sha256') != hashlib.sha256(patch).hexdigest()
        or manifest.get('patch_bytes') != len(patch)):
        deny('manifest-identity')
    files = manifest.get('paths')
    if (not isinstance(files, list) or not (1 <= len(files) <= MAX_FILES)
        or len(files) != len({f.get('path') for f in files if isinstance(f, dict)})):
        deny('manifest-paths')
    with tempfile.TemporaryDirectory(prefix='sovereign-replay-') as tmp:
        index = str(Path(tmp) / 'index')
        env = dict(os.environ, GIT_INDEX_FILE=index, GIT_CONFIG_NOSYSTEM='1',
                   GIT_CONFIG_GLOBAL=os.devnull, GIT_OPTIONAL_LOCKS='0')
        git('read-tree', expected, env=env)
        git('apply', '--cached', '--binary', '--check', '-', env=env, data=patch)
        git('apply', '--cached', '--binary', '-', env=env, data=patch)
        changed = git('diff', '--cached', '--name-status', '-z', expected, env=env).split(b'\0')
        if changed[-1] != b'':
            deny('malformed-diff')
        names = []
        for i in range(0, len(changed)-1, 2):
            if changed[i] not in (b'A', b'M'):
                deny('rename-delete-or-type')
            try:
                name = changed[i+1].decode('utf-8')
            except UnicodeError:
                deny('path-encoding')
            if name not in allowed or not safe_path(name):
                deny('unapproved-path')
            names.append(name)
        if not names or len(names) != len(set(names)) or len(names) > MAX_FILES:
            deny('path-count')
        if set(names) != {f['path'] for f in files}:
            deny('manifest-inventory')
        for f in files:
            path = f['path']
            stage = git('ls-files', '--stage', '--', path, env=env).decode('utf-8')
            match = re.fullmatch(r'100644 ([0-9a-f]{40}) 0\t[^\n]+\n', stage)
            if not match:
                deny('unsafe-file-mode')
            blob = git('cat-file', 'blob', match.group(1), env=env)
            if (len(blob) != f.get('bytes') or hashlib.sha256(blob).hexdigest() != f.get('sha256')
                or b'\0' in blob or SECRETS.search(blob) or len(blob) > MAX_PATCH):
                deny('file-digest-or-content')
            try:
                blob.decode('utf-8')
            except UnicodeError:
                deny('file-encoding')
    return {'source_sha': expected, 'scope_digest': digest,
            'patch_sha256': hashlib.sha256(patch).hexdigest(), 'paths': sorted(names),
            'result': 'RECONSTRUCTED_NO_EXECUTION'}


if __name__ == '__main__':
    if len(sys.argv) != 4:
        deny('usage: scope.json manifest.json proposal.patch')
    print(json.dumps(verify(*sys.argv[1:]), sort_keys=True))
