import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCredentialVault } from './credentials.mjs';

// This test cipher exercises the vault contract, not Windows DPAPI availability.
export function testProtector() {
  const key = randomBytes(32);
  return async (operation, bytes) => {
    if (operation === 'protect') {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
      return Buffer.concat([nonce, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
    }
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
  };
}
test('vault encrypts outside match state, survives a restart and forgets one provider without clearing the others', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'credential-vault-')), file = path.join(directory, 'private.dpapi'), protect = testProtector();
  const make = () => createCredentialVault({ file, platform: 'win32', protect });
  try {
    const first = make(); assert.equal((await first.check()).available, true);
    await Promise.all([first.save('football', 'synthetic-football-key'), first.save('basketball', 'synthetic-basketball-key'), first.save('footystats', 'synthetic-footystats-key')]);
    const disk = await readFile(file, 'utf8');
    assert.equal(disk.includes('synthetic-'), false); assert.equal(JSON.stringify(first.state()).includes('synthetic-'), false);
    const restarted = make(), restored = await restarted.load();
    assert.equal(restored.football, 'synthetic-football-key'); assert.equal(restored.basketball, 'synthetic-basketball-key');
    await restarted.save('football', null);
    const remaining = await make().load(); assert.equal(remaining.football, undefined); assert.equal(remaining.footystats, 'synthetic-footystats-key');
    await assert.rejects(restarted.save('invalid', 'synthetic'), { status: 400 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('wrong account, corrupt ciphertext and unavailable encryption never produce a plaintext fallback or overwrite the vault', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'credential-errors-')), file = path.join(directory, 'private.dpapi'), protect = testProtector();
  try {
    const first = createCredentialVault({ file, platform: 'win32', protect }); await first.save('football', 'synthetic-test-key');
    const before = await readFile(file, 'utf8');
    const wrong = createCredentialVault({ file, platform: 'win32', protect: testProtector() });
    await assert.rejects(wrong.load(), { status: 503 }); await assert.rejects(wrong.save('football', 'replacement-test-key'), { status: 503 });
    assert.equal(await readFile(file, 'utf8'), before);
    const broken = createCredentialVault({ file, platform: 'win32', protect: async () => { throw new Error('do not expose internal or credential text'); } });
    assert.equal((await broken.check()).available, false); assert.equal(broken.state().error.includes('internal'), false);
    await writeFile(file, '{broken'); await assert.rejects(createCredentialVault({ file, platform: 'win32', protect }).load(), { status: 503 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('non-Windows and disabled test servers do not attempt to read a real credential store', async () => {
  for (const options of [{ platform: 'linux' }, { platform: 'win32', enabled: false }]) {
    const vault = createCredentialVault({ file: 'not-a-real-store', ...options, protect: () => { throw new Error('must not be used'); } });
    assert.equal(vault.state().supported, false); assert.deepEqual(await vault.load(), {});
  }
});
