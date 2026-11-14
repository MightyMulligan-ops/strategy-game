import hashlib
import json
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
    def run_replay(self):
        for n, data in [('scope.json',json.dumps(self.scope).encode()),('manifest.json',json.dumps(self.manifest).encode()),('proposal.patch',self.patch)]:
            (Path(self.artifacts.name)/n).write_bytes(data)
        return cmd(self.root,sys.executable,str(REPLAY),*(str(Path(self.artifacts.name)/n) for n in ('scope.json','manifest.json','proposal.patch')),check=False)
    def test_valid_patch_reconstructed(self):
        r=self.run_replay();self.assertEqual(r.returncode,0,r.stderr.decode());self.assertIn(b'RECONSTRUCTED_NO_EXECUTION',r.stdout)
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

if __name__=='__main__':unittest.main()
