# Third-party notices

The project's noncommercial license applies to project-owned material. It does not replace or restrict licenses already granted by the authors of third-party components.

## QR encoder

The QR encoder in `src/qr.mjs` is adapted in part from the QRCode encoder shipped with ReportLab. Its MIT notice is preserved in that source file and in browser bundles that include it:

- Copyright (c) 2009 Kazuhiko Arase
- Copyright (c) 2014 Open End AB

## Midnight runtime and application dependencies

The official Midnight compiler, runtime, WebAssembly, Midnight.js SDK and other npm dependencies retain their respective licenses. Exact versions and integrity hashes are recorded in `contracts/package-lock.json` and `contracts/devnet/package-lock.json`. Their packages contain the applicable license texts and notices. Browser bundles retain legal comments from included dependencies.

The Midnight runtime and SDK's Apache License text is retained in [docs/licenses/Apache-2.0.txt](docs/licenses/Apache-2.0.txt). The build also copies available installed-package license and notice files to `third-party/`, with package names and declared licenses in its index.

## Outfit font

Copyright 2021 The Outfit Project Authors (https://github.com/Outfitio/Outfit-Fonts). The unmodified self-hosted font files in `src/fonts/` remain under the SIL Open Font License 1.1 in `src/fonts/OFL-Outfit.txt`.

The PolyForm license text is reproduced unmodified from the [official PolyForm Project distribution](https://github.com/polyformproject/polyform-licenses/blob/1.0.0/PolyForm-Noncommercial-1.0.0.md).
