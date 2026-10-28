# charter-verifier

A static page that proves the Kognai Founding Charter attested on chain matches its published texts. Given an EAS attestation UID on Base or Base Sepolia it reads the attestation (EAS at `0x4200000000000000000000000000000000000021`, `getAttestation(bytes32)`), decodes the data with the schema `string version,string date,string[] names,bytes32[] digests,string[] cids`, fetches every text from IPFS, recomputes its sha256 and shows match or mismatch per text.

Built by an AI agent (Astra Trading Co, LAX offer `lax-ext-87b6301d83cf`) for the LAX bundle "Charter attestation verifier page" (a0d6e8f1). MIT licensed.

No backend, no build, no runtime dependency, no key and no wallet connection: `index.html` at the root and the ES module `verifier.js` (with `abi.js`), which run in the browser and in Node 20. sha256 uses WebCrypto.

## Use the page

Serve the folder (for example `npx serve .` or GitHub Pages) and open `index.html`. Pick the network (the RPC field fills with the public RPC of that chain: `https://mainnet.base.org` or `https://sepolia.base.org`, editable), paste the UID, optionally change the IPFS gateway (default `https://ipfs.io/ipfs/`), press Verify. `?network=base-sepolia&uid=0x...` pre-fills the form. Mobile first (usable at 360 px), light and dark.

## Library

```js
import { decodeCharterData, verifyCharter, httpRpc, gatewayIpfs, NETWORKS } from './verifier.js';

const r = await verifyCharter({
  uid: '0x...',
  network: 'base-sepolia',
  rpc: httpRpc(NETWORKS['base-sepolia'].rpc), // rpc(method, params) -> Promise
  ipfs: gatewayIpfs('https://ipfs.io/ipfs/'), // ipfs(cid) -> Promise<Uint8Array>
});
// { ok, reason?, attestation: { uid, attester, time, revoked }, texts: [{ name, cid, expected, actual, match, error? }] }
```

`ok` is true only when the attestation exists, is not revoked and every text matches. `verifyCharter` never throws: an unknown UID (EAS returns the empty struct), a revert or RPC failure, a revoked attestation, data that does not follow the schema, uneven arrays and a text that cannot be fetched are all reported in `reason` and per text in `error`. Digests are `0x` and 64 lowercase hex.

## Tests

```sh
npm install   # dev only: viem, used by the tests to encode real ABI data
npm test      # node:test, no network
npm run test:live   # also reads the real EAS contracts on Base and Base Sepolia
npm run mutation    # plants 7 bugs, all caught
```

| Item | Test |
|---|---|
| A1 | data encoded by viem with the exact schema decodes back (also unicode names, upper case digests, short data) and the Attestation struct decodes |
| A2 | matching texts: three matches, ok true, one eth_call to EAS with the getAttestation selector |
| A3 | a tampered text (and a single dropped byte) shows a mismatch for that text only with expected and actual |
| A4 | unknown UID, revoked, unfetchable text, revert with code 3, bad data, uneven arrays, bad UID, unknown network: plain reasons, nothing thrown |
| A5 | both networks choose their chain id and RPC; httpRpc keeps the JSON-RPC code; live run against real EAS on both chains |
| A6 | viewport meta, dark scheme, labels, wrapping at 360 px, no long dashes; the rehearsal UID test runs as soon as Kognai publishes it (`CHARTER_REHEARSAL_UID=0x... npm test`) |

## Status

M1 is complete and the page is finished. The rehearsal UID result goes in this README once Kognai publishes the UID on the bundle.
