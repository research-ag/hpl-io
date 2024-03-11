import { Principal } from '@dfinity/principal';
import { AggregatorDelegate, HPLClient, LedgerDelegate, SimpleTransferStatus } from '../src';
import { lastValueFrom, Observable } from 'rxjs';

describe('HPLClient', () => {
  let client: HPLClient;

  beforeEach(() => {
    client = new HPLClient('bkyz2-fmaaa-aaaaa-qaaaq-cai', 'local');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllTimers();
  });

  it('should initialize with the provided ledgerPrincipal and network', () => {
    expect(client.ledgerPrincipal).toBe('bkyz2-fmaaa-aaaaa-qaaaq-cai');
    expect(client.network).toBe('local');
    expect(client.ledger).toBeInstanceOf(LedgerDelegate);
  });

  describe('pollTx', () => {
    it('should complete with "processed" status', (done) => {
      // Mock necessary dependencies and setup
      const aggregator: AggregatorDelegate = {
        timestampedSingleTxStatus: () => Promise.resolve([{ status: 'other', lastLedgerTimestamp: BigInt(123) }, BigInt(0)]),
        canisterPrincipal: { toString: () => 'canister-principal' },
        prepareSimpleTransfer: () => Promise.resolve({
          requestId: new ArrayBuffer(0),
          commit: () => Promise.resolve([[BigInt(0), BigInt(0)], BigInt(0)]),
        }),
      } as any;
      client.ledger.timestampedSingleTxStatus = jest.fn().mockResolvedValue([{ status: 'processed' }, BigInt(0)]);
      const observable: Observable<SimpleTransferStatus> = client.pollTx(aggregator, [BigInt(0), BigInt(0)]);
      observable.subscribe({
        next: ({ status }) => {
          if (status === 'processed') {
            done(); // Test passed if status is "processed"
          }
        },
        error: done.fail, // Fail the test if there's an error
        complete: done.fail, // Fail the test if the observable completes (shouldn't happen)
      });
    });
    it('should not emit aggregator forwarded status after ledger responded with "processed"', async () => {
      const aggregator: AggregatorDelegate = {
        timestampedSingleTxStatus: () => new Promise(r => setTimeout(() => r([{ status: 'pending' }, BigInt(0)]), 10)),
        canisterPrincipal: { toString: () => 'canister-principal' },
        prepareSimpleTransfer: () => Promise.resolve({
          requestId: new ArrayBuffer(0),
          commit: () => Promise.resolve([[BigInt(0), BigInt(0)], BigInt(0)]),
        }),
      } as any;
      let counter = 3;
      client.ledger.timestampedSingleTxStatus = jest.fn().mockImplementation(() => {
        counter--;
        return counter > 0
          ? [{ status: 'awaited', aggregator: Principal.anonymous() }, BigInt(0)]
          : [{ status: 'processed' }, BigInt(0)];
      });
      const finalResult = await lastValueFrom(client.pollTx(aggregator, [BigInt(0), BigInt(0)]));
      expect(finalResult.status).toBe('processed');
    });
    it('should handle "dropped" status and throw an error', (done) => {
      // Mock necessary dependencies and setup
      const aggregator: AggregatorDelegate = {
        timestampedSingleTxStatus: () => Promise.resolve([{ status: 'other', lastLedgerTimestamp: BigInt(0) }, BigInt(0)]),
        canisterPrincipal: { toString: () => 'canister-principal' },
        prepareUpdateRequest: () => Promise.resolve({
          requestId: new ArrayBuffer(0),
          call: () => Promise.resolve([[BigInt(0), BigInt(0)], BigInt(0)]),
        }),
      } as any;
      client.ledger.timestampedSingleTxStatus = jest.fn().mockResolvedValue([{ status: 'dropped' }, BigInt(0)]);
      const observable: Observable<SimpleTransferStatus> = client.pollTx(aggregator, [BigInt(0), BigInt(0)]);
      observable.subscribe({
        error: (error) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe('Ledger responded with "dropped" state');
          done();
        },
        complete: done.fail, // Fail the test if the observable completes (shouldn't happen)
      });
    });
  });
});
