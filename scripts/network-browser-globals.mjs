// Real browser implementations for dependencies that reference Node globals.
// esbuild injects these imports only where the corresponding identifier is free.
// Neither module implements or replaces Midnight cryptography.
export { Buffer } from 'buffer';
export { default as process } from 'process/browser.js';
