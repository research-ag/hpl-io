import { HPLClient, HplError } from '../src';
import { exec } from 'child-process-promise';

describe('Intergation', () => {

  let ledgerId: string = null!;
  let aggregatorId: string = null!;
  let client: HPLClient = null!;

  jest.setTimeout(30000);
  const w = (command: string) => `pushd test/canisters && ${command} && popd`;

  beforeAll(async () => {
    const { stderr: output } = await exec(
      w('dfx canister create --all --network local')
    );
    let [[_, aid], [__, lid]] = Array.from(output.matchAll(/canister id: ([\w-]+)/gi));
    ledgerId = lid;
    aggregatorId = aid;
  });

  beforeEach(async () => {
    await exec(
      w('dfx canister uninstall-code --all --network local')
    );
    await exec(
      w('dfx deploy --network local --no-wallet ledger --argument="(vec { principal \\"' + aggregatorId + '\\"; }, 65536, null)"')
    );
    await exec(
      w('dfx deploy --network local --no-wallet aggregator --argument="(principal \\"' + ledgerId + '\\", principal \\"' + ledgerId + '\\")"')
    );
    const { stdout, stderr } = await exec(
      w('dfx canister call aggregator init --network local')
    );
    client = new HPLClient(ledgerId, 'local');
  });

  it('should be able to query ledger', async () => {
    let aggregators = await client.ledger.aggregators();
    expect(aggregators).toHaveLength(1);
    expect(aggregators[0].priority).toBe(1);
    expect(aggregators[0].principal.toText()).toBe(aggregatorId);
  });

  // it('should be able to prepare transfer request and submit it separately', async () => {
  //   let aggregator = (await client.pickAggregator())!;
  //   const [{ length: streamInitialLength }] = await aggregator.streamStatus();
  //   const { commit } = await client.prepareSimpleTransfer(
  //     aggregator, { type: 'mint' }, { type: 'mint' }, BigInt(2), BigInt(100)
  //   );
  //   const [{ length: streamLength2 }] = await aggregator.streamStatus();
  //   expect(streamLength2).toBe(streamInitialLength);
  //   const [_, canisterTimestamp] = await commit();
  //
  //   // check canister timestamp
  //   expect(Math.abs(Date.now() - canisterTimestamp)).toBeLessThan(5000);
  //
  //   const [{ length: streamLength3 }] = await aggregator.streamStatus();
  //   expect(streamLength3).toBe(streamInitialLength + BigInt(1));
  // });

  // it('rejected call needs to return correct canister timestamp', async () => {
  //   let aggregator = (await client.pickAggregator())!;
  //   try {
  //     await client.simpleTransfer(
  //       aggregator, { type: 'mint' }, { type: 'mint' }, BigInt(2), "max"
  //     );
  //     fail('Rejection error was not thrown')
  //   } catch (err) {
  //     expect(err instanceof HplError).toBeTruthy();
  //     let canisterTimestamp = (err as HplError).callExtra.canisterTimestamp;
  //     expect(Math.abs(Date.now() - canisterTimestamp)).toBeLessThan(5000);
  //   }
  // });
  //
  // it('rejected call needs to return correct HPL error', async () => {
  //   let aggregator = (await client.pickAggregator())!;
  //   try {
  //     await client.simpleTransfer(
  //       aggregator, { type: 'mint' }, { type: 'mint' }, BigInt(2), "max"
  //     );
  //     fail('Rejection error was not thrown');
  //   } catch (err) {
  //     expect(err instanceof HplError).toBeTruthy();
  //     expect((err as HplError).errorPayload).toBe('Unsupported #max flows');
  //     expect((err as HplError).isTrapped()).toBe(false);
  //     expect((err as HplError).isErrorRejectThrown()).toBe(true);
  //     let canisterTimestamp = (err as HplError).callExtra.canisterTimestamp;
  //     expect(Math.abs(Date.now() - canisterTimestamp)).toBeLessThan(5000);
  //   }
  // });

  it('queryWithExtras should return correct timestamp', async () => {
    const [res, canisterTimestamp] = await client.ledger.timestampedSingleTxStatus([BigInt(0), BigInt(10000)]);
    expect(res.status).toBe('awaited');
    expect(Math.abs(Date.now() - canisterTimestamp)).toBeLessThan(5000);
  });

  it('query reject should return correct timestamp', async () => {
    try {
      await client.ledger.timestampedSingleTxStatus([BigInt(10000), BigInt(10000)]);
      fail('Error was not thrown');
    } catch (err) {
      expect(err instanceof HplError).toBeTruthy();
      expect((err as HplError).errorPayload).toBe('Stream id inside the gid has not yet been issued');
      expect((err as HplError).isTrapped()).toBe(false);
      expect((err as HplError).isErrorRejectThrown()).toBe(true);
      let canisterTimestamp = (err as HplError).callExtra.canisterTimestamp;
      expect(Math.abs(Date.now() - canisterTimestamp)).toBeLessThan(5000);
    }
  });

  it('should unwrap result response on update call', async () => {
    let ft = await client.ledger.createFungibleToken(0, '');
    await client.ledger.openAccounts([{ ft }]);
    try {
      await client.ledger.openVirtualAccount({ type: 'ft', assetId: BigInt(228) }, aggregatorId, {
        type: 'ft',
        balance: BigInt(100)
      }, BigInt(0));
      fail('Error was not thrown');
    } catch (err) {
      expect(err instanceof HplError).toBeTruthy();
      expect((err as HplError).errorKey).toBe('InvalidArguments');
      expect((err as HplError).errorPayload).toBe('Asset id mismatch');
      expect((err as HplError).isTrapped()).toBe(false);
      expect((err as HplError).isErrorRejectThrown()).toBe(false);
      let canisterTimestamp = (err as HplError).callExtra.canisterTimestamp;
      expect(Math.abs(Date.now() - canisterTimestamp)).toBeLessThan(5000);
    }
  });

});
