#!/usr/bin/env python3
"""Offline Git fixtures for the hosted source archive packager."""
import importlib.util
import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / "codex-hosted-packager.py"
spec = importlib.util.spec_from_file_location("hosted_packager", MODULE)
assert spec and spec.loader
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)

class HostedPackagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.test")
        (self.repo / "apps").mkdir()
        (self.repo / "apps" / "combat.ts").write_text("export const attack = 1;\n")
        self.commit()
    def git(self,*args):
        return subprocess.check_output(["git","-C",str(self.repo),*args],stderr=subprocess.DEVNULL).decode().strip()
    def commit(self):
        self.git("add","-A")
        self.git("commit","-qm","fixture")
        self.source = self.git("rev-parse","HEAD")
    def archive(self,name="source.tar.gz"):
        return packager.package(self.repo,self.source,self.root / name)
    def test_deterministic_archive_matches_pinned_git_tree(self):
        first = self.archive("one.tar.gz")
        second = self.archive("two.tar.gz")
        self.assertEqual(first["sha256"],second["sha256"])
        with tarfile.open(self.root/"one.tar.gz","r:gz") as tar:
            members=tar.getmembers()
            self.assertEqual([x.name for x in members],["apps/combat.ts"])
            self.assertEqual(members[0].mode,0o644)
            self.assertEqual(tar.extractfile(members[0]).read(),b"export const attack = 1;\n")
    def test_untracked_and_modified_worktree_do_not_enter_archive(self):
        (self.repo/"secret-untracked.txt").write_text("sk-proj-"+"x"*32)
        (self.repo/"apps"/"combat.ts").write_text("modified without commit")
        self.archive()
        with tarfile.open(self.root/"source.tar.gz","r:gz") as tar:
            self.assertEqual(tar.getnames(),["apps/combat.ts"])
            self.assertEqual(tar.extractfile("apps/combat.ts").read(),b"export const attack = 1;\n")
    def test_symlink_tracked_by_git_is_denied(self):
        (self.repo/"shortcut").symlink_to("apps/combat.ts")
        self.commit()
        with self.assertRaisesRegex(packager.PackagingDenied,"nonregular-source-entry"):
            self.archive()
    def test_environment_and_workflow_files_are_not_exported(self):
        (self.repo/".env.production").write_text("FAKE_KEY=abc")
        (self.repo/".github").mkdir()
        (self.repo/".github"/"workflow.yml").write_text("name: never export")
        self.commit()
        self.archive()
        with tarfile.open(self.root/"source.tar.gz","r:gz") as tar:
            self.assertEqual(tar.getnames(),["apps/combat.ts"])
    def test_embedded_key_denied(self):
        (self.repo/"apps"/"combat.ts").write_text("const key='sk-proj-"+"x"*20+"';")
        self.commit()
        with self.assertRaisesRegex(packager.PackagingDenied,"source-secret-or-size"):
            self.archive()
    def test_oversized_blob_denied(self):
        (self.repo/"large.txt").write_bytes(b"x"*(packager.MAX_FILE+1))
        self.commit()
        with self.assertRaisesRegex(packager.PackagingDenied,"source-size"):
            self.archive()
    def test_non_commit_and_invalid_source_denied(self):
        with self.assertRaisesRegex(packager.PackagingDenied,"source-sha"):
            packager.package(self.repo,"main",self.root/"bad.tar.gz")
        blob=self.git("hash-object","apps/combat.ts")
        with self.assertRaisesRegex(packager.PackagingDenied,"git-object-unavailable"):
            packager.package(self.repo,blob,self.root/"bad.tar.gz")
    def test_executable_source_is_not_executable_in_archive(self):
        path=self.repo/"apps"/"combat.ts"
        path.chmod(0o755)
        self.commit()
        self.archive()
        with tarfile.open(self.root/"source.tar.gz","r:gz") as tar:
            self.assertEqual(tar.getmember("apps/combat.ts").mode,0o644)
    def test_rejects_unsafe_paths(self):
        for raw in (b"../outside",b"/etc/passwd",b"a//b",b".env",b".git/config",b"bad\\name",b"a/./b",b"a/../b"):
            with self.assertRaises(packager.PackagingDenied):
                packager.safe_path(raw)

if __name__ == "__main__":
    unittest.main(verbosity=2)
