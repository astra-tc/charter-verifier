// Founding Charter attestation verifier. Pure ES module: runs in the browser and in Node 20.
import { hexToBytes, bytesToHex, word, num, bytesAt, stringAt, stringArrayAt, bytes32ArrayAt, addressAt } from './abi.js';

export const EAS_ADDRESS = '0x4200000000000000000000000000000000000021';
export const SCHEMA = 'string version,string date,string[] names,bytes32[] digests,string[] cids';
export const NETWORKS = {
  base: { chainId: 8453, name: 'Base', rpc: 'https://mainnet.base.org', explorer: 'https://base.easscan.org' },
  'base-sepolia': { chainId: 84532, name: 'Base Sepolia', rpc: 'https://sepolia.base.org', explorer: 'https://base-sepolia.easscan.org' },
};
/** getAttestation(bytes32) selector */
export const GET_ATTESTATION = '0xa3112a64';
const ZERO32 = '0x' + '0'.repeat(64);

/**
 * Decodes the attestation data of the Charter schema.
 * @param {string} dataHex
 * @returns {{version: string, date: string, names: string[], digests: string[], cids: string[]}}
 */
export function decodeCharterData(dataHex) {
  const b = hexToBytes(dataHex);
  const version = stringAt(b, num(b, 0));
  const date = stringAt(b, num(b, 32));
  const names = stringArrayAt(b, num(b, 64));
  const digests = bytes32ArrayAt(b, num(b, 96)).map((d) => d.toLowerCase());
  const cids = stringArrayAt(b, num(b, 128));
  return { version, date, names, digests, cids };
}

/**
 * Decodes the Attestation struct returned by EAS getAttestation.
 * @param {string} resultHex
 */
export function decodeAttestation(resultHex) {
  const b = hexToBytes(resultHex);
  const t = num(b, 0); // offset of the tuple
  const h = (i) => bytesToHex(b.slice(t + i * 32, t + i * 32 + 32));
  return {
    uid: h(0),
    schema: h(1),
    time: Number(word(b, t + 64)),
    expirationTime: Number(word(b, t + 96)),
    revocationTime: Number(word(b, t + 128)),
    refUID: h(5),
    recipient: addressAt(b, t + 192),
    attester: addressAt(b, t + 224),
    revocable: word(b, t + 256) !== 0n,
    data: bytesToHex(bytesAt(b, t + num(b, t + 288))),
  };
}

/** sha256 of bytes as 0x + 64 lowercase hex, through WebCrypto. @param {Uint8Array} bytes */
export async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(d));
}

const plain = (e) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e));

/**
 * Verifies the Charter attestation: never throws for a missing or revoked attestation or an unfetchable text.
 * @param {{uid: string, network: 'base'|'base-sepolia', rpc: (method: string, params: unknown[]) => Promise<any>, ipfs: (cid: string) => Promise<Uint8Array>}} args
 */
export async function verifyCharter({ uid, network, rpc, ipfs }) {
  const out = { ok: false, reason: undefined, network, attestation: { uid, attester: null, time: null, revoked: false }, texts: [] };
  if (!NETWORKS[network]) return { ...out, reason: `unknown network ${network}: use base or base-sepolia` };
  if (typeof uid !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(uid)) return { ...out, reason: 'the UID must be 0x and 64 hex characters' };
  let att;
  try {
    const result = await rpc('eth_call', [{ to: EAS_ADDRESS, data: GET_ATTESTATION + uid.slice(2).toLowerCase() }, 'latest']);
    att = decodeAttestation(result);
  } catch (e) {
    return { ...out, reason: `could not read the attestation on ${NETWORKS[network].name}: ${plain(e)}` };
  }
  if (att.uid === ZERO32) return { ...out, reason: `no attestation with this UID on ${NETWORKS[network].name}` };
  out.attestation = { uid: att.uid, attester: att.attester, time: att.time, revoked: att.revocationTime > 0 };
  let data;
  try {
    data = decodeCharterData(att.data);
  } catch (e) {
    return { ...out, reason: `the attestation data does not follow the Charter schema: ${plain(e)}` };
  }
  out.version = data.version;
  out.date = data.date;
  if (data.names.length !== data.digests.length || data.names.length !== data.cids.length || data.names.length === 0)
    return { ...out, reason: 'names, digests and cids do not have one entry per text' };
  for (let i = 0; i < data.names.length; i++) {
    const text = { name: data.names[i], cid: data.cids[i], expected: data.digests[i], actual: null, match: false };
    try {
      const bytes = await ipfs(data.cids[i]);
      text.actual = await sha256Hex(bytes);
      text.match = text.actual === text.expected;
    } catch (e) {
      text.error = `could not fetch ${data.cids[i]}: ${plain(e)}`;
    }
    out.texts.push(text);
  }
  const failed = out.texts.filter((t) => !t.match);
  if (out.attestation.revoked) out.reason = 'the attestation is revoked';
  else if (failed.some((t) => t.error)) out.reason = `could not fetch: ${failed.filter((t) => t.error).map((t) => t.name).join(', ')}`;
  else if (failed.length) out.reason = `mismatch: ${failed.map((t) => t.name).join(', ')}`;
  out.ok = !out.attestation.revoked && failed.length === 0;
  return out;
}

/** fetch based JSON-RPC caller for the page. Throws an Error with the JSON-RPC code and message on failure. */
export function httpRpc(url, fetchFn = globalThis.fetch) {
  let id = 0;
  return async (method, params) => {
    const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) {
      const err = new Error(j.error.message || 'RPC error');
      err.code = j.error.code;
      throw err;
    }
    return j.result;
  };
}

/** IPFS gateway fetcher for the page. gateway like https://ipfs.io/ipfs/ */
export function gatewayIpfs(gateway, fetchFn = globalThis.fetch) {
  const g = gateway.endsWith('/') ? gateway : gateway + '/';
  return async (cid) => {
    const res = await fetchFn(g + cid.replace(/^ipfs:\/\//, ''));
    if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
}
