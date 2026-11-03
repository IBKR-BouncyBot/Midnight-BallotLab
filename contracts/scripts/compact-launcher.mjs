/** Select the official compiler host without invoking Windows compact.exe.
 * That Windows program is a filesystem compressor, not the Midnight compiler.
 * Arguments remain an array; neither path translation nor execution uses a shell.
 */
export function compactInvocation({ platform = process.platform, cwd, env = process.env }) {
  const absolutePosix = (value, name) => {
    if (typeof value !== 'string' || !value.startsWith('/') || /[\\\x00-\x1f]/.test(value)) {
      throw new Error(`${name} must be an absolute path inside the Linux environment`);
    }
    return value;
  };
  if (platform !== 'win32') {
    const args = env.COMPACT_DIRECTORY ? ['--directory', absolutePosix(env.COMPACT_DIRECTORY, 'COMPACT_DIRECTORY')] : [];
    return { command: 'compact', args };
  }

  const names = ['COMPACT_WSL_DISTRO', 'COMPACT_WSL_USER', 'COMPACT_WSL_BINARY', 'COMPACT_DIRECTORY'];
  if (names.some(name => !env[name])) {
    throw new Error(`Native Windows compilation is unavailable. Configure ${names.join(', ')} to use the official toolchain in WSL. Windows compact.exe is not Midnight and will not be executed.`);
  }
  for (const name of ['COMPACT_WSL_DISTRO', 'COMPACT_WSL_USER']) {
    if (typeof env[name] !== 'string' || env[name].startsWith('-') || /[\x00-\x1f]/.test(env[name])) {
      throw new Error(`${name} must identify the intended WSL environment`);
    }
  }
  const binary = absolutePosix(env.COMPACT_WSL_BINARY, 'COMPACT_WSL_BINARY');
  const directory = absolutePosix(env.COMPACT_DIRECTORY, 'COMPACT_DIRECTORY');
  // The documented WSL installation uses its standard /mnt/<drive> automount.
  // Do not guess a translation for UNC/network paths or customized mounts.
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(cwd ?? '');
  if (!drive || /[\x00-\x1f]/.test(cwd)) {
    throw new Error('The Windows contract directory must be on a drive mounted under WSL /mnt/<drive>. Run Node inside WSL for other mount layouts.');
  }
  const linuxCwd = `/mnt/${drive[1].toLowerCase()}/${drive[2].replaceAll('\\', '/')}`;
  return { command: 'wsl.exe', args: ['--distribution', env.COMPACT_WSL_DISTRO,
    '--user', env.COMPACT_WSL_USER, '--cd', linuxCwd, '--exec', binary, '--directory', directory] };
}
