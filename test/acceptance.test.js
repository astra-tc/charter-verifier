import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeCharterData, verifyCharter, decodeAttestation, NETWORKS, EAS_ADDRESS, GET_ATTESTATION, SCHEMA, httpRpc, gatewayIpfs } from '../verifier.js';
import { charterData, attestationResult, rpcReturning, ipfsFrom, sha, TEXTS, CIDS, UID, ZERO } from './helpers.js';

test('A1 decodeCharterData reads back what the schema encodes', () => {
  const d = decodeCharterData(charterData());
  assert.deepEqual(d, {
    version: '1.0', date: '2026-10-28', names: ['charter', 'constitution', 'soul'],
    digests: ['charter', 'constitution', 'soul'].map((n) => sha(TEXTS[n])), cids: [CIDS.charter, CIDS.constitution, CIDS.soul],
  });
  for (const x of d.digests) assert.match(x, /^0x[0-9a-f]{64}$/);
  const upper = charterData(TEXTS, { digests: Object.values(TEXTS).map((t) => sha(t).toUpperCase().replace('0X', '0x')) });
  assert.ok(decodeCharterData(upper).digests.every((x) => x === x.toLowerCase()));
  const uni = decodeCharterData(charterData({ 'Ménage ✓': 'x' }, { version: 'v2', date: '2026-11-01' }));
  assert.deepEqual(uni.names, ['Ménage ✓']);
  assert.equal(SCHEMA, 'string version,string date,string[] names,bytes32[] digests,string[] cids');
  assert.throws(() => decodeCharterData('0x1234'));
  assert.throws(() => decodeCharterData('nothex'));
  const att = decodeAttestation(attestationResult());
  assert.equal(att.uid, UID);
  assert.equal(att.attester, '0x1111111111111111111111111111111111111111');
  assert.equal(att.time, 1761609600);
  assert.equal(att.revocationTime, 0);
  assert.equal(att.revocable, true);
});

test('A2 a matching attestation shows a match per text and ok true', async () => {
  const calls = [];
  const r = await verifyCharter({ uid: UID, network: 'base', rpc: rpcReturning(attestationResult(), calls), ipfs: ipfsFrom() });
  assert.equal(r.ok, true);
  assert.equal(r.reason, undefined);
  assert.equal(r.texts.length, 3);
  assert.ok(r.texts.every((t) => t.match && t.actual === t.expected && !t.error));
  assert.deepEqual(r.attestation, { uid: UID, attester: '0x1111111111111111111111111111111111111111', time: 1761609600, revoked: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'eth_call');
  assert.deepEqual(calls[0].params, [{ to: EAS_ADDRESS, data: GET_ATTESTATION + UID.slice(2) }, 'latest']);
});

test('A3 a tampered text shows a mismatch for that text only, with expected and actual, and ok false', async () => {
  const r = await verifyCharter({ uid: UID, network: 'base', rpc: rpcReturning(attestationResult()), ipfs: ipfsFrom(TEXTS, { [CIDS.constitution]: 'Article 1. The Four Laws ...\n' }) });
  assert.equal(r.ok, false);
  assert.deepEqual(r.texts.map((t) => t.match), [true, false, true]);
  const bad = r.texts[1];
  assert.equal(bad.expected, sha(TEXTS.constitution));
  assert.equal(bad.actual, sha('Article 1. The Four Laws ...\n'));
  assert.equal(r.reason, 'mismatch: constitution');
  // a single changed byte is caught
  const r2 = await verifyCharter({ uid: UID, network: 'base', rpc: rpcReturning(attestationResult()), ipfs: ipfsFrom(TEXTS, { [CIDS.soul]: 'SOUL v1' }) });
  assert.deepEqual(r2.texts.map((t) => t.match), [true, true, false]);
});

test('A4 unknown UID, revoked attestation or unfetchable text are reported plainly, never thrown', async () => {
  const unknown = await verifyCharter({ uid: UID, network: 'base', rpc: rpcReturning(attestationResult({ uid: ZERO, data: '0x' })), ipfs: ipfsFrom() });
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /no attestation with this UID on Base/);

  const revoked = await verifyCharter({ uid: UID, network: 'base', rpc: rpcReturning(attestationResult({ revocationTime: 1761700000n })), ipfs: ipfsFrom() });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.attestation.revoked, true);
  assert.equal(revoked.reason, 'the attestation is revoked');
  assert.ok(revoked.texts.every((t) => t.match), 'texts are still checked and shown');

  const missing = await verifyCharter({ uid: UID, network: 'base', rpc: rpcReturning(attestationResult()), ipfs: ipfsFrom(TEXTS, { [CIDS.soul]: new Error('gateway HTTP 504') }) });
  assert.equal(missing.ok, false);
  assert.equal(missing.texts[2].match, false);
  assert.match(missing.texts[2].error, /could not fetch bafkreisoul: gateway HTTP 504/);
  assert.equal(missing.reason, 'could not fetch: soul');

  const rpcErr = Object.assign(new Error('execution reverted'), { code: 3 });
  const reverted = await verifyCharter({ uid: UID, network: 'base-sepolia', rpc: rpcReturning(rpcErr), ipfs: ipfsFrom() });
  assert.match(reverted.reason, /could not read the attestation on Base Sepolia: execution reverted/);

  const garbage = await verifyCharter({ uid: UID, network: 'base', rpc: rpcReturning(attestationResult({ data: '0xdeadbeef' })), ipfs: ipfsFrom() });
  assert.match(garbage.reason, /does not follow the Charter schema/);
  const uneven = await verifyCharter({ uid: UID, network: 'base', rpc: rpcReturning(attestationResult({ data: charterData(TEXTS, { digests: [sha('a')] }) })), ipfs: ipfsFrom() });
  assert.match(uneven.reason, /one entry per text/);
  assert.match((await verifyCharter({ uid: '0x12', network: 'base', rpc: rpcReturning('0x'), ipfs: ipfsFrom() })).reason, /64 hex/);
  assert.match((await verifyCharter({ uid: UID, network: 'mainnet', rpc: rpcReturning('0x'), ipfs: ipfsFrom() })).reason, /unknown network/);
  assert.match((await verifyCharter({ uid: UID, network: 'base', rpc: rpcReturning('0x'), ipfs: ipfsFrom() })).reason, /could not read/);
});

test('A5 works on Base and Base Sepolia, the network choosing the chain and the RPC', async () => {
  assert.equal(NETWORKS.base.chainId, 8453);
  assert.equal(NETWORKS['base-sepolia'].chainId, 84532);
  assert.notEqual(NETWORKS.base.rpc, NETWORKS['base-sepolia'].rpc);
  for (const network of ['base', 'base-sepolia']) {
    const urls = [];
    const fetchFn = async (url, init) => {
      urls.push(url);
      const body = JSON.parse(init.body);
      assert.equal(body.params[0].to, EAS_ADDRESS);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: attestationResult() }));
    };
    const r = await verifyCharter({ uid: UID, network, rpc: httpRpc(NETWORKS[network].rpc, fetchFn), ipfs: ipfsFrom() });
    assert.equal(r.ok, true);
    assert.deepEqual(urls, [NETWORKS[network].rpc]);
  }
  // httpRpc carries the JSON-RPC code; gatewayIpfs maps ipfs:// and gateway errors
  const rpc = httpRpc('https://x', async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } })));
  await assert.rejects(rpc('eth_call', []), (e) => e.code === 3 && /reverted/.test(e.message));
  await assert.rejects(httpRpc('https://x', async () => new Response('', { status: 503 }))('eth_call', []), /503/);
  const seen = [];
  const gw = gatewayIpfs('https://gw.example/ipfs', async (u) => { seen.push(u); return new Response('hi'); });
  assert.equal(new TextDecoder().decode(await gw('ipfs://bafy1')), 'hi');
  assert.deepEqual(seen, ['https://gw.example/ipfs/bafy1']);
  await assert.rejects(gatewayIpfs('https://gw/', async () => new Response('', { status: 404 }))('x'), /404/);
});

test('A6 the page is mobile friendly (viewport, 360 px), light and dark, labelled, uses verifier.js', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /import \{ verifyCharter, httpRpc, gatewayIpfs, NETWORKS \} from '\.\/verifier\.js'/);
  for (const id of ['uid', 'network', 'rpc', 'gateway']) assert.match(html, new RegExp(`<label for="${id}"`));
  assert.match(html, /overflow-wrap: anywhere/, 'long hex wraps at 360 px');
  assert.match(html, /min-width: 0/);
  assert.ok(!/[\u2013\u2014]/.test(html), 'no long dashes');
  assert.ok(!/width:\s*\d{4}px/.test(html), 'no fixed wide widths');
});

test('A6 verifies the Sepolia rehearsal UID Kognai publishes on this bundle', { todo: 'the rehearsal UID is not yet on the bundle page; set CHARTER_REHEARSAL_UID to run it' , skip: !process.env.CHARTER_REHEARSAL_UID }, async () => {
  const r = await verifyCharter({ uid: process.env.CHARTER_REHEARSAL_UID, network: 'base-sepolia', rpc: httpRpc(NETWORKS['base-sepolia'].rpc), ipfs: gatewayIpfs('https://ipfs.io/ipfs/') });
  assert.equal(r.ok, true, r.reason);
});

test('A5 live: real EAS on Base Sepolia answers an unknown UID with the empty state (CHARTER_LIVE=1)', { skip: process.env.CHARTER_LIVE !== '1' }, async () => {
  for (const network of ['base', 'base-sepolia']) {
    const r = await verifyCharter({ uid: '0x' + '12'.repeat(32), network, rpc: httpRpc(NETWORKS[network].rpc), ipfs: gatewayIpfs('https://ipfs.io/ipfs/') });
    assert.equal(r.ok, false);
    assert.match(r.reason, /no attestation with this UID/);
  }
});
