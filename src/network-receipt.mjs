import { parseStrictJson } from './json.mjs';
import { requireDevelopmentNetwork } from '../contracts/native/browser-config.mjs';

const SCHEMA = 'midnight-ballot-lab/native-receipt/v1';
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const digest = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError('Invalid native receipt digest');
  return Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
};

export function encodeNetworkReceipt(receipt) {
  if (receipt?.schema !== SCHEMA) throw new TypeError('Expected a native network receipt');
  requireDevelopmentNetwork(receipt.networkId);
  if (!Number.isSafeInteger(receipt.index) || receipt.index < 0 || receipt.index >= 1024) throw new TypeError('Invalid receipt index');
  const bytes = new Uint8Array(96);
  [receipt.contractAddress, receipt.configurationDigest, receipt.receipt].forEach((value, i) => bytes.set(digest(value), i * 32));
  const payload = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_');
  return `mbnn1:${receipt.networkId}:${receipt.index}:${payload}`;
}

export function decodeNetworkReceipt(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new TypeError('Receipt is too large');
  if (!text.startsWith('mbnn1:')) {
    const receipt = parseStrictJson(text, { maxBytes: 4096, maxDepth: 8 });
    encodeNetworkReceipt(receipt);
    // Explicit projection discards arbitrary additional JSON properties.
    return { schema: SCHEMA, networkId: receipt.networkId, contractAddress: receipt.contractAddress,
      configurationDigest: receipt.configurationDigest, receipt: receipt.receipt, index: receipt.index };
  }
  const match = /^mbnn1:(undeployed|preview|preprod):(0|[1-9][0-9]{0,3}):([A-Za-z0-9_-]{128})$/.exec(text);
  if (!match) throw new TypeError('Invalid native network QR receipt');
  const bytes = Uint8Array.from(atob(match[3].replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
  const receipt = { schema: SCHEMA, networkId: match[1], index: Number(match[2]),
    contractAddress: hex(bytes.slice(0, 32)), configurationDigest: hex(bytes.slice(32, 64)), receipt: hex(bytes.slice(64)) };
  if (encodeNetworkReceipt(receipt) !== text) throw new TypeError('Noncanonical native network QR receipt');
  return receipt;
}
