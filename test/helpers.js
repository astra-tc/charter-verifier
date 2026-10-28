import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { createHash } from 'node:crypto';

export const enc = new TextEncoder();
export const TEXTS = { charter: 'We, the citizens of Kognai, ...\n', constitution: 'Article 1. The Five Laws ...\n', soul: 'SOUL v1\n' };
export const CIDS = { charter: 'bafkreicharter', constitution: 'bafkreiconstitution', soul: 'bafkreisoul' };
export const sha = (s) => '0x' + createHash('sha256').update(s).digest('hex');

export function charterData(texts = TEXTS, { version = '1.0', date = '2026-10-28', digests } = {}) {
  const names = Object.keys(texts);
  return encodeAbiParameters(parseAbiParameters('string version,string date,string[] names,bytes32[] digests,string[] cids'), [
    version, date, names, digests ?? names.map((n) => sha(texts[n])), names.map((n) => CIDS[n] ?? `cid-${n}`),
  ]);
}

const ATT = parseAbiParameters('(bytes32 uid,bytes32 schema,uint64 time,uint64 expirationTime,uint64 revocationTime,bytes32 refUID,address recipient,address attester,bool revocable,bytes data)');
export const UID = '0x' + 'ab'.repeat(32);
export const ZERO = '0x' + '0'.repeat(64);
export function attestationResult({ uid = UID, revocationTime = 0n, data = charterData(), attester = '0x1111111111111111111111111111111111111111', time = 1761609600n } = {}) {
  return encodeAbiParameters(ATT, [{ uid, schema: '0x' + 'cd'.repeat(32), time, expirationTime: 0n, revocationTime, refUID: ZERO, recipient: '0x0000000000000000000000000000000000000000', attester, revocable: true, data }]);
}
export function rpcReturning(result, calls = []) {
  return async (method, params) => { calls.push({ method, params }); if (result instanceof Error) throw result; return typeof result === 'function' ? result(method, params) : result; };
}
export function ipfsFrom(texts = TEXTS, override = {}) {
  const byCid = Object.fromEntries(Object.entries(texts).map(([n, t]) => [CIDS[n] ?? `cid-${n}`, t]));
  return async (cid) => {
    if (cid in override) { const o = override[cid]; if (o instanceof Error) throw o; return enc.encode(o); }
    if (!(cid in byCid)) throw new Error('not found');
    return enc.encode(byCid[cid]);
  };
}
