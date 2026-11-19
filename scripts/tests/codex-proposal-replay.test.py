import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPLAY = Path(__file__).resolve().parents[1] / 'codex-proposal-replay.py'
SOURCE = 'packages/game-engine/src/combat.ts'

def cmd(cwd, *args, check=True, data=None):
    return subprocess.run(args, cwd=cwd, input=data, capture_output=True, check=check)

class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.artifacts = tempfile.TemporaryDirectory()
        cmd(self.root,'git','init','-q')
        cmd(self.root,'git','config','user.name','Fixture')
        cmd(self.root,'git','config','user.email','fixture@example.invalid')
        (self.root/'packages/game-engine/src').mkdir(parents=True)
        (self.root/SOURCE).write_text('export const combat = 1;\n')
        (self.root/'.gitignore').write_text('ignored-secret.txt\n')
        cmd(self.root,'git','add','.')
        cmd(self.root,'git','commit','-qm','baseline')
        self.sha=cmd(self.root,'git','rev-parse','HEAD').stdout.decode().strip()
        self.scope={'sourceSha':self.sha,'scopeDigest':'a'*64,'approvedPaths':[SOURCE]}
        self.blob=b'export const combat = 2;\n'
        (self.root/SOURCE).write_bytes(self.blob)
        self.patch=cmd(self.root,'git','diff','--binary').stdout
        cmd(self.root,'git','checkout','--',SOURCE)
        self.manifest={'format':'sovereign-codex-proposal-v1','source_sha':self.sha,
          'scope_digest':self.scope['scopeDigest'],'patch_sha256':hashlib.sha256(self.patch).hexdigest(),
          'patch_bytes':len(self.patch),'paths':[{'path':SOURCE,'sha256':hashlib.sha256(self.blob).hexdigest(),'bytes':len(self.blob)}]}
    def tearDown(self):self.tmp.cleanup();self.artifacts.cleanup()
    def run_replay(self, prepare=None):
        for n, data in [('scope.json',json.dumps(self.scope).encode()),('manifest.json',json.dumps(self.manifest).encode()),('proposal.patch',self.patch)]:
            (Path(self.artifacts.name)/n).write_bytes(data)
        if prepare: prepare(Path(self.artifacts.name))
        return cmd(self.root,sys.executable,str(REPLAY),*(str(Path(self.artifacts.name)/n) for n in ('scope.json','manifest.json','proposal.patch')),check=False)
    def test_valid_patch_reconstructed(self):
        r=self.run_replay();self.assertEqual(r.returncode,0,r.stderr.decode());self.assertIn(b'RECONSTRUCTED_NO_EXECUTION',r.stdout)
        cmd(self.root,'git','apply','--cached','-',data=self.patch)
        self.assertEqual(json.loads(r.stdout)['tree_sha'],cmd(self.root,'git','write-tree').stdout.decode().strip())
    def test_wrong_source(self):
        self.scope['sourceSha']='b'*40;self.assertNotEqual(self.run_replay().returncode,0)
    def test_bad_manifest_digest(self):
        self.manifest['patch_sha256']='b'*64;self.assertNotEqual(self.run_replay().returncode,0)
    def test_unapproved_path(self):
        self.scope['approvedPaths']=['packages/other/src/combat.ts'];self.assertNotEqual(self.run_replay().returncode,0)
    def test_secret_patch(self):
        self.patch+=b'sk-proj-EXAMPLE';self.assertNotEqual(self.run_replay().returncode,0)
    def test_binary_patch(self):
        self.patch+=b'\0';self.assertNotEqual(self.run_replay().returncode,0)
    def test_dirty_source(self):
        (self.root/SOURCE).write_text('dirty');self.assertNotEqual(self.run_replay().returncode,0)
    def test_delete_rejected(self):
        cmd(self.root,'git','rm',SOURCE)
        self.patch=cmd(self.root,'git','diff','--cached','--binary').stdout
        self.manifest['patch_sha256']=hashlib.sha256(self.patch).hexdigest()
        self.manifest['patch_bytes']=len(self.patch)
        cmd(self.root,'git','reset','--hard','HEAD')
        self.assertNotEqual(self.run_replay().returncode,0)
    def test_mode_change_rejected(self):
        cmd(self.root,'git','update-index','--chmod=+x',SOURCE)
        self.patch=cmd(self.root,'git','diff','--cached','--binary').stdout
        self.manifest['patch_sha256']=hashlib.sha256(self.patch).hexdigest()
        self.manifest['patch_bytes']=len(self.patch)
        cmd(self.root,'git','reset','--hard','HEAD')
        self.assertNotEqual(self.run_replay().returncode,0)

    def test_ignored_source_rejected(self):
        (self.root/'ignored-secret.txt').write_text('synthetic ignored fixture')
        self.assertNotEqual(self.run_replay().returncode,0)
    def test_dependencies_must_be_installed_after_clean_replay(self):
        ignored = self.root/'.git/info/exclude'
        ignored.write_text('node_modules/\n')
        modules = self.root/'node_modules'
        modules.mkdir()
        installed = modules/'fixture.js'
        installed.write_text('module.exports = {};\n')
        result = self.run_replay()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'dirty-source', result.stderr)
        installed.unlink()
        modules.rmdir()
        self.assertEqual(self.run_replay().returncode, 0)
    def test_null_manifest_rejected(self):
        self.manifest=None;self.assertNotEqual(self.run_replay().returncode,0)
    def test_null_scope_rejected(self):
        self.scope=None;self.assertNotEqual(self.run_replay().returncode,0)
    def test_non_string_scope_path_rejected(self):
        self.scope['approvedPaths']=[{}];self.assertNotEqual(self.run_replay().returncode,0)
    def test_non_object_file_rejected(self):
        self.manifest['paths']=[None];self.assertNotEqual(self.run_replay().returncode,0)
    def test_double_slash_path_rejected(self):
        self.scope['approvedPaths']=['packages//game-engine/src/combat.ts'];self.assertNotEqual(self.run_replay().returncode,0)
    def test_symlink_artifact_rejected(self):
        def prepare(root):
            (root/'proposal.patch').rename(root/'target')
            (root/'proposal.patch').symlink_to(root/'target')
        self.assertNotEqual(self.run_replay(prepare).returncode,0)
    def test_hardlink_artifact_rejected(self):
        def prepare(root): os.link(root/'proposal.patch',root/'alias')
        self.assertNotEqual(self.run_replay(prepare).returncode,0)
    def test_oversized_artifact_rejected(self):
        def prepare(root): (root/'proposal.patch').write_bytes(b'x'*1_500_001)
        self.assertNotEqual(self.run_replay(prepare).returncode,0)

    def feature_patch(self, path, existing=False):
        target = self.root/path
        target.parent.mkdir(parents=True, exist_ok=True)
        if existing:
            target.write_text('-- existing migration\n')
            cmd(self.root, 'git', 'add', path)
            cmd(self.root, 'git', 'commit', '-qm', 'existing migration')
            self.sha = cmd(self.root, 'git', 'rev-parse', 'HEAD').stdout.decode().strip()
        content = b'CREATE TABLE city_test (id integer);\n'
        target.write_bytes(content)
        cmd(self.root, 'git', 'add', '-N', path)
        self.patch = cmd(self.root, 'git', 'diff', '--binary').stdout
        cmd(self.root, 'git', 'reset', '--hard', 'HEAD')
        if not existing and target.exists():
            target.unlink()
        self.scope.update(profile='city-feature-v1', sourceSha=self.sha, approvedPaths=[path])
        self.manifest.update(source_sha=self.sha, patch_sha256=hashlib.sha256(self.patch).hexdigest(),
                             patch_bytes=len(self.patch), paths=[{'path':path,'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)}])
    def test_feature_new_migration_source_accepted(self):
        self.feature_patch('database/prisma/migrations/20261119_city/migration.sql')
        r=self.run_replay();self.assertEqual(r.returncode,0,r.stderr.decode())
    def test_feature_existing_migration_edit_rejected(self):
        self.feature_patch('database/prisma/migrations/20261119_city/migration.sql', existing=True)
        r=self.run_replay();self.assertNotEqual(r.returncode,0);self.assertIn(b'existing-migration-change',r.stderr)
    def test_feature_cannot_modify_controller(self):
        self.feature_patch('scripts/controller.ts')
        self.assertNotEqual(self.run_replay().returncode,0)
    def test_unknown_profile_rejected(self):
        self.scope['profile']='unknown'
        self.assertNotEqual(self.run_replay().returncode,0)
    def test_legacy_scope_cannot_use_feature_paths(self):
        self.feature_patch('database/prisma/schema.prisma')
        del self.scope['profile']
        self.assertNotEqual(self.run_replay().returncode,0)

if __name__=='__main__':unittest.main()

