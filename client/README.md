# Client module for HPL

TODO add documentation

# Usage

### Simple transfer via random aggregator
```typescript
const ledgerPrincipal: string = 'bkyz2-fmaaa-aaaaa-qaaaq-cai';
const network: 'ic' | 'local' = 'local';
const client = new HPLClient(ledgerPrincipal, network);

const asset = await client.ledger.createFungibleToken();
await client.ledger.openAccounts({ ft: asset }, 1);

// mint 100 tokens, listen for status
client.simpleTransfer(
  { type: 'mint' },
  { type: 'sub', id: BigInt(0) },
  asset,
  100,
)
  .subscribe(
    ({
       status,
       txId,
       statusPayload,
       submitRequestId,
     }) => console.log('TxId:', txId, '; status:', status, '; payload:', JSON.stringify(statusPayload, bigIntReplacer), ';submit request id:', submitRequestId),
  );
// expected console output:
// TxId: null; status: pickAggregator; payload: null; submitRequestId: null
// TxId: null; status: submitting; payload: {"aggregatorPrincipal":"<principal string here>"}; submitRequestId: null
// TxId: null; status: submitting; payload: {"aggregatorPrincipal":"<principal string here>"}; submitRequestId: [object ArrayBuffer]
// TxId: <tx id here>; status: queued; payload: ["10n"]; submitRequestId: [object ArrayBuffer]
// ...TxId: <tx id here>; status: queued; payload: ["<number in queue>n"]; submitRequestId: [object ArrayBuffer]
// ...TxId: <tx id here>; status: forwarding; payload: {}; submitRequestId: [object ArrayBuffer]
// TxId: <tx id here>; status: forwarded; payload: {}; submitRequestId: [object ArrayBuffer]
// TxId: <tx id here>; status: processed; payload: <tx output json string here>; submitRequestId: [object ArrayBuffer]

// mint 100 tokens as promise, resolve when processed, write txId to variable
const { txId } = await lastValueFrom(client.simpleTransfer(...));

// mint 100 tokens as promise, resolve when submitted to aggregator, write txId to variable
const { txId } = await firstValueFrom(
  client.simpleTransfer(...)
    .pipe(
      filter(([status, _]) => ['pending', 'processed'].includes(status)
      ),
    );
  
// save transfer arguments in a variable
const txArgs = [
  { type: 'mint' },
  { type: 'sub', id: BigInt(0) },
  asset,
  100,
];
const { txId } = await lastValueFrom(client.simpleTransfer(...txArgs));

```

# Development notes

### Update candid from HPL:
`npm run compile-did`
