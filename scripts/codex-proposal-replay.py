"""Offline, credential-free Git patch reconstruction for untrusted Codex proposals.

Never execute generated code or use this process with a GitHub publisher token.
The caller must independently authenticate the frozen scope and source commit.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

MAX_PATCH = 1_500_000
MAX_MANIFEST = 32 * 1024
MAX_FILES = 25
SHA = re.compile(r'^[0-9a-f]{40}$')
DIGEST = re.compile(r'^[0-9a-f]{64}$')
SAFE_PATH = re.compile(r'^(?:apps|packages)/[A-Za-z0-9_./-]+\.(?:ts|tsx)$')
SECRETS = re.compile(rb'(?:sk-proj-|github_pat_|-----BEGIN .*PRIVATE KEY-----)', re.I)


def deny(reason):
    raise SystemExit('REJECT: ' + reason)


def git(*args, env=None, data=None):
    p = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.quotepath=false',
                        '-c', 'diff.external=', *args], input=data, capture_output=True,
                       env=env, check=False, timeout=15)
    if p.returncode:
        deny('git-' + args[0])
    return p.stdout


def safe_path(path):
    return (isinstance(path, str) and len(path) < 200 and bool(SAFE_PATH.fullmatch(path))
            and '//' not in path
            and not any(part.startswith('.') or part.lower() in ('node_modules', 'prisma', 'migrations', 'secrets')
                        for part in path.split('/')))


def bounded_read(path, limit):
    # Trusted collector must also provide a non-worker-controlled parent directory.
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                deny('unsafe-artifact-file')
            data = stream.read(limit + 1)
    except OSError:
        deny('artifact-read')
    if len(data) > limit:
        deny('oversized-artifact')
    return data


def parse_json(path, limit):
    data = bounded_read(path, limit)
    try:
        result = json.loads(data)
        if not isinstance(result, dict):
            deny('json-object-required')
        return result
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
        or any(not safe_path(p) for p in allowed) or len(allowed) != len(set(allowed))):
        deny('scope')
    if git('rev-parse', 'HEAD').decode().strip() != expected:
        deny('source-head')
    if git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored'):
        deny('dirty-source')
    patch = bounded_read(patch_path, MAX_PATCH)
    if not patch or len(patch) > MAX_PATCH or b'\0' in patch or SECRETS.search(patch):
        deny('patch-bytes')
    if (manifest.get('format') != 'sovereign-codex-proposal-v1'
        or manifest.get('source_sha') != expected or manifest.get('scope_digest') != digest
        or manifest.get('patch_sha256') != hashlib.sha256(patch).hexdigest()
        or manifest.get('patch_bytes') != len(patch)):
        deny('manifest-identity')
    files = manifest.get('paths')
    if (not isinstance(files, list) or not (1 <= len(files) <= MAX_FILES)
        or any(not isinstance(f, dict) or not safe_path(f.get('path'))
               or type(f.get('bytes')) is not int or not (0 <= f['bytes'] <= MAX_PATCH)
               or not isinstance(f.get('sha256'), str) or not DIGEST.fullmatch(f['sha256']) for f in files)
        or len(files) != len({f['path'] for f in files})):
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
        proposal_tree = git('write-tree', env=env).decode().strip()
    return {'tree_sha': proposal_tree, 'source_sha': expected, 'scope_digest': digest,
            'patch_sha256': hashlib.sha256(patch).hexdigest(), 'paths': sorted(names),
            'result': 'RECONSTRUCTED_NO_EXECUTION'}


if __name__ == '__main__':
    if len(sys.argv) != 4:
        deny('usage: scope.json manifest.json proposal.patch')
    print(json.dumps(verify(*sys.argv[1:]), sort_keys=True))

