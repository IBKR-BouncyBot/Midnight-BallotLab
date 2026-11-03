# Native development on Windows with WSL

Midnight's official compiler runs on Linux or macOS. On Windows, this project
uses an explicitly selected WSL installation. Windows includes an unrelated
`compact.exe` filesystem compressor: the compile script refuses to invoke it.
See the [official Windows setup guide](https://docs.midnight.network/guides/windows-compact-setup)
and [supported version matrix](https://docs.midnight.network/relnotes/support-matrix).

The continuation environment uses Windows Node 24.18.0, Python 3.14.6 and
Ubuntu 24.04 under WSL. The official Compact devtools binary is
`/root/.local/bin/compact`, with the compiler installed in
`/root/.compact-ballot-lab`. Those paths are specific to this local installation;
they are not credentials or requirements to run future deployments as root.

Install WSL/Ubuntu if needed using an administrator PowerShell terminal:

```powershell
wsl --install --distribution Ubuntu-24.04
```

Complete any Windows restart and Ubuntu setup that the installer requires.
Install official Compact devtools 0.5.1 inside the chosen Linux environment,
then install compiler 0.31.1. Do not run a bare `compact update` to select a
newer ledger-incompatible compiler. For the existing continuation installation,
the following explicit commands select the installed toolchain:

```powershell
wsl --distribution Ubuntu-24.04 --user root --exec /root/.local/bin/compact --version
wsl --distribution Ubuntu-24.04 --user root --exec /root/.local/bin/compact --directory /root/.compact-ballot-lab update 0.31.1
wsl --distribution Ubuntu-24.04 --user root --exec /root/.local/bin/compact --directory /root/.compact-ballot-lab compile +0.31.1 --version
```

From the repository root in PowerShell, configure the launcher for this terminal
session, then use the ordinary npm commands:

```powershell
$env:COMPACT_WSL_DISTRO = 'Ubuntu-24.04'
$env:COMPACT_WSL_USER = 'root'
$env:COMPACT_WSL_BINARY = '/root/.local/bin/compact'
$env:COMPACT_DIRECTORY = '/root/.compact-ballot-lab'
npm --prefix contracts ci --ignore-scripts
npm --prefix contracts run compile:native
npm --prefix contracts run test:native
npm --prefix contracts run demo:native
npm test
npm run build
npm --prefix contracts run build:browser:native
node scripts/build-network-browser.mjs
python scripts/check_pages.py
```

All four `COMPACT_*` settings above are required when Node runs on Windows.
`contracts/scripts/compact-launcher.mjs` translates a standard drive path such
as `C:\Ballot Lab\contracts` into `/mnt/c/Ballot Lab/contracts`, then passes
the directory and compiler arguments directly to `wsl.exe` without a shell.
Paths with spaces remain single arguments. UNC paths and customized WSL mount
layouts are not guessed: run Node inside WSL for those layouts instead.
On Linux/macOS the same compile script invokes `compact` directly, with an
optional absolute `COMPACT_DIRECTORY` to choose a separate toolchain directory.

Python is used for static packaging checks. Use `python` or `py -3` on Windows
according to your installation, and `python3` on Linux/macOS.

For the actual browser acceptance test, keep the browser cache inside the
workspace if desired and use the same setting for installation and execution:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.browser-cache'
node contracts/node_modules/playwright/cli.js install chromium
node scripts/test-native-browser.mjs
```

The browser gate requires a successfully compiled/bundled native build. See
[its acceptance scope](NATIVE_BROWSER_ACCEPTANCE.md). A compiler run, generated
runtime execution, browser execution, proof generation and accepted network
transaction are separate milestones.

Actual compile/runtime/browser results are recorded separately in
[CONTINUATION_RESULTS.md](CONTINUATION_RESULTS.md). Sandboxed processes can be
denied access to the WSL service even when WSL works in a normal terminal; that
permission failure must remain visible and must not trigger a replacement
compiler or runtime.
