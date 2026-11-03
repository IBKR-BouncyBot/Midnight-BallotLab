import test from 'node:test';
import assert from 'node:assert/strict';
import { compactInvocation } from '../contracts/scripts/compact-launcher.mjs';

const configured = { COMPACT_WSL_DISTRO: 'Ubuntu-24.04', COMPACT_WSL_USER: 'root',
  COMPACT_WSL_BINARY: '/root/.local/bin/compact', COMPACT_DIRECTORY: '/root/.compact-ballot-lab' };

test('Windows requires explicit WSL settings and never chooses the filesystem compressor', () => {
  assert.throws(() => compactInvocation({ platform: 'win32', cwd: 'C:\\lab\\contracts', env: {} }), /Windows compact.exe is not Midnight/);
  for (const name of Object.keys(configured)) {
    const env = { ...configured };
    delete env[name];
    assert.throws(() => compactInvocation({ platform: 'win32', cwd: 'C:\\lab\\contracts', env }), /Configure/);
  }
});

test('Windows invokes an explicit Linux binary and passes paths with spaces as single arguments', () => {
  assert.deepEqual(compactInvocation({ platform: 'win32', cwd: 'C:\\Ballot Lab\\contracts\\', env: configured }), {
    command: 'wsl.exe', args: ['--distribution', 'Ubuntu-24.04', '--user', 'root',
      '--cd', '/mnt/c/Ballot Lab/contracts/', '--exec', '/root/.local/bin/compact',
      '--directory', '/root/.compact-ballot-lab'],
  });
});

test('Windows fails instead of guessing a network mount or malformed executable', () => {
  assert.throws(() => compactInvocation({ platform: 'win32', cwd: '\\\\server\\share\\contracts', env: configured }), /drive mounted/);
  for (const value of ['compact', 'C:\\Windows\\System32\\compact.exe', '/bin/compact\n--help']) {
    assert.throws(() => compactInvocation({ platform: 'win32', cwd: 'C:\\lab',
      env: { ...configured, COMPACT_WSL_BINARY: value } }), /absolute path inside/);
  }
});

test('Windows rejects WSL selector option injection before any process starts', () => {
  for (const name of ['COMPACT_WSL_DISTRO', 'COMPACT_WSL_USER']) {
    assert.throws(() => compactInvocation({ platform: 'win32', cwd: 'C:\\lab',
      env: { ...configured, [name]: '--help' } }), /intended WSL environment/);
  }
});

test('Linux and macOS retain direct official compact execution', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(compactInvocation({ platform, cwd: '/work/contracts', env: {} }), { command: 'compact', args: [] });
  }
});

test('A custom toolchain directory is explicit on Linux too', () => {
  assert.deepEqual(compactInvocation({ platform: 'linux', cwd: '/work/contracts',
    env: { COMPACT_DIRECTORY: '/opt/ballot tools' } }), {
    command: 'compact', args: ['--directory', '/opt/ballot tools'],
  });
});
