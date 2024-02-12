import { Principal } from '@dfinity/principal';
import { LedgerDelegate } from './delegates/ledger-delegate';
import { LedgerAdminDelegate } from './delegates/ledger-admin-delegate';
import { AggregatorDelegate } from './delegates/aggregator-delegate';
import { AssetId, GlobalId } from '../candid/ledger';
import { finalize, Observable, Subject, takeWhile } from 'rxjs';
import { AnonymousIdentity, Identity, RequestId } from '@dfinity/agent';
import { AccountRef, TxInput } from '../candid/aggregator';
import { sleep } from './utils/sleep.util';
import { HplError } from './hpl-error';
import { FeeMode } from './types';
import { CallExtraData } from './delegates/hpl-agent';

export type SimpleTransferStatusKey = 'queued' | 'forwarding' | 'forwarded' | 'processed';

export type SimpleTransferStatus = {
  status: SimpleTransferStatusKey;
  txId: GlobalId | null;
  statusPayload?: any | { info: any };
};

export type TransferAccountReference =
  | { type: 'sub'; id: bigint }
  | { type: 'vir'; owner: Principal | string; id: bigint }
  | { type: 'mint' };

const toAccountRef: (ref: TransferAccountReference) => AccountRef = ref => {
  switch (ref.type) {
    case 'mint':
      return { mint: null };
    case 'sub':
      return { sub: ref.id };
    case 'vir':
      return { vir: [ref.owner instanceof Principal ? ref.owner : Principal.fromText(ref.owner), ref.id] };
  }
};

export class HPLClient {
  public readonly ledger: LedgerDelegate;
  public readonly admin: LedgerAdminDelegate;

  private _externalIdentity: Identity | null = null;
  public get externalIdentity(): Identity | null {
    return this._externalIdentity;
  }

  public async setIdentity(identity: Identity | null) {
    this._externalIdentity = identity;
    identity = identity || new AnonymousIdentity();
    await this.ledger.replaceIdentity(identity);
    await this.admin.replaceIdentity(identity);
  }

  constructor(public readonly ledgerPrincipal: Principal | string, public readonly network: 'ic' | 'local') {
    this.ledger = new LedgerDelegate(this.ledgerPrincipal, network);
    this.admin = new LedgerAdminDelegate(this.ledgerPrincipal, network);
  }

  async getAggregators(): Promise<AggregatorDelegate[]> {
    return Promise.all(
      (await this.ledger.aggregators())
        .filter(({ priority }) => priority > 0)
        .map(({ principal }) => this.createAggregatorDelegate(principal)),
    );
  }

  async pickAggregator(): Promise<AggregatorDelegate | null> {
    const aggDescriptions = await this.ledger.aggregators();
    const totalProbabilityWeight = aggDescriptions.reduce((prev, cur) => prev + cur.priority, 0);
    if (totalProbabilityWeight == 0) {
      return null;
    }
    const randomValue = Math.random() * totalProbabilityWeight;
    let currentWeightSum = 0;
    let principal: Principal = null!;
    for (let i = 0; i < aggDescriptions.length; i++) {
      currentWeightSum += aggDescriptions[i].priority;
      if (randomValue <= currentWeightSum) {
        principal = aggDescriptions[i].principal;
        break;
      }
    }
    return this.createAggregatorDelegate(principal);
  }

  async createAggregatorDelegate(principal: Principal | string): Promise<AggregatorDelegate> {
    const delegate = new AggregatorDelegate(principal, this.network);
    const identity = this.externalIdentity || new AnonymousIdentity();
    await delegate.replaceIdentity(identity);
    return delegate;
  }

  simpleTransfer(
    aggregator: AggregatorDelegate,
    from: TransferAccountReference,
    to: TransferAccountReference,
    asset: AssetId,
    amount: number | BigInt | 'max',
    feeMode: FeeMode | null = null,
    memo: Array<Uint8Array | number[]> = [],
  ): Promise<GlobalId> {
    return aggregator.singleSubmitAndExecute(this._txInputFromRawArgs(from, to, asset, amount, feeMode, memo));
  }

  async prepareSimpleTransfer(
    aggregator: AggregatorDelegate,
    from: TransferAccountReference,
    to: TransferAccountReference,
    asset: AssetId,
    amount: number | BigInt | 'max',
    feeMode: FeeMode | null = null,
    memo: Array<Uint8Array | number[]> = [],
  ): Promise<{ requestId: RequestId; commit: () => Promise<[GlobalId, bigint]> }> {
    const { requestId, call: commit } = await aggregator.prepareUpdateRequest<[[TxInput]], [[GlobalId], CallExtraData]>(
      'submitAndExecute',
      [this._txInputFromRawArgs(from, to, asset, amount, feeMode, memo)],
    );
    return {
      requestId,
      commit: async () => {
        const [result, callExtra] = await commit();
        return [result[0], callExtra.canisterTimestamp];
      },
    };
  }

  pollTx(
    aggregator: AggregatorDelegate,
    txId: GlobalId,
    submissionTimestamp: BigInt = 0n,
  ): Observable<SimpleTransferStatus> {
    const subj: Subject<SimpleTransferStatus> = new Subject<SimpleTransferStatus>();
    let interrupted = false;
    let lastStatus: SimpleTransferStatus = { status: 'queued', txId, statusPayload: null! };
    subj.pipe(takeWhile(() => !interrupted)).subscribe(s => {
      lastStatus = s;
    });
    const logInfo = (msg: string) =>
      subj.next({
        status: lastStatus.status,
        txId,
        statusPayload: { info: msg },
      });
    let pollingState = 'aggregator';
    let ledgerBatchTimestamp: bigint | null = null;

    // polls aggregator until it responds with "other" status; controls polling state.
    const pollAggregator = async (getInterrupted: () => boolean) => {
      let counter = 0;
      while (!getInterrupted()) {
        counter++;
        try {
          logInfo(`Retrieving status from aggregator (attempt #${counter})`);
          const [txStatus, _] = await Promise.race([
            new Promise(r => setTimeout(() => r([null, 0n]), 5000)) as Promise<[null, bigint]>,
            aggregator.timestampedSingleTxStatus(txId, ({ code, canisterError }, goingToRetry) => {
              logInfo(
                `Poll error: Aggregator returned code ${code}, error: ${canisterError} (attempt #${counter}). Retry query? ${goingToRetry}`,
              );
            }),
          ]);
          // while we were waiting to response, the polling could've been already interrupted by ledger polling or externally
          if (getInterrupted()) {
            return;
          }
          // if query call was stopped by 5 seconds timeout
          if (txStatus === null) {
            continue;
          }
          let status: SimpleTransferStatus = null!;
          if (txStatus.status == 'queued') {
            logInfo(`Aggregator responded with state "queued" (attempt #${counter})`);
            status = { status: 'queued', txId, statusPayload: txStatus.queueNumber };
            subj.next(status);
            pollingState = 'aggregator';
          } else if (txStatus.status == 'pending') {
            logInfo(`Aggregator responded with state "pending" (attempt #${counter})`);
            if (lastStatus.status !== 'forwarding') {
              status = { status: 'forwarding', txId };
              subj.next(status);
            }
            pollingState = 'both';
          } else if (txStatus.status == 'other') {
            ledgerBatchTimestamp = txStatus.lastLedgerTimestamp;
            logInfo(`Aggregator responded with state "forwarded" (attempt #${counter})`);
            status = { status: 'forwarded', txId, statusPayload: { ledgerTimestamp: txStatus.lastLedgerTimestamp } };
            subj.next(status);
            pollingState = 'final';
          } else {
            throw new Error(`Unexpected status response from aggregator: "${(txStatus as any).status}"`);
          }
        } catch (e) {
          if (
            e instanceof HplError &&
            e.errorKey == 'CanisterReject' &&
            e.errorPayload == 'Not yet issued' &&
            Number((e as HplError).callExtra?.canisterTimestamp || 0) <= Number(submissionTimestamp)
          ) {
            // pass
          } else {
            throw e;
          }
        }
        switch (pollingState) {
          case 'aggregator':
            await sleep(250);
            break;
          case 'both':
            await sleep(750);
            break;
          default:
            return;
        }
      }
    };

    // polls ledger until it responds with "processed" status
    const pollLedger = async (getInterrupted: () => boolean) => {
      let counter = 0;
      while (!getInterrupted()) {
        if (pollingState === 'aggregator') {
          await sleep(50);
          continue;
        }
        counter++;
        logInfo(`Retrieving status from ledger (attempt #${counter})`);
        const [ledgerStatus, timestamp] = await Promise.race([
          new Promise(r => setTimeout(() => r([null, 0n]), 5000)) as Promise<[null, bigint]>,
          this.ledger.timestampedSingleTxStatus(txId, ({ code, canisterError }, goingToRetry) => {
            logInfo(
              `Poll error: Ledger returned code ${code}, error: ${canisterError} (attempt #${counter}). Retry query? ${goingToRetry}`,
            );
          }),
        ]);
        // while we were waiting to response, the polling could've been already interrupted externally
        if (getInterrupted()) {
          return;
        }
        // if query call was stopped by 5 seconds timeout
        if (ledgerStatus === null) {
          continue;
        }
        switch (ledgerStatus.status) {
          case 'dropped':
            logInfo(`Ledger responded with state "dropped" (attempt #${counter}). Ledger timestamp: ${timestamp}`);
            throw new Error('Ledger responded with "dropped" state');
          case 'processed':
            logInfo(`Ledger responded with state "processed" (attempt #${counter}). Ledger timestamp: ${timestamp}`);
            subj.next({ status: 'processed', txId, statusPayload: ledgerStatus.result });
            return;
          case 'awaited':
            logInfo(`Ledger responded with state "awaited" (attempt #${counter}). Ledger timestamp: ${timestamp}`);
            if (pollingState === 'final' && ledgerBatchTimestamp! < timestamp) {
              throw new Error('Ledger responded with "awaited" state, when aggregator already forwarded transaction');
            }
        }
        await sleep(250);
      }
    };

    const interrupt = (error?: Error) => {
      interrupted = true;
      if (error) {
        subj.error(error);
      }
      subj.complete();
    };

    // poll aggregator in background, ignore finishing
    pollAggregator(() => interrupted).catch(e => interrupt(e));
    // poll ledger and wait for finish (processed state)
    pollLedger(() => interrupted)
      .then(() => interrupt())
      .catch(e => interrupt(e));
    return subj.pipe(finalize(() => (interrupted = true)));
  }

  private _txInputFromRawArgs(
    from: TransferAccountReference,
    to: TransferAccountReference,
    asset: AssetId,
    amount: number | BigInt | 'max',
    feeMode: FeeMode | null,
    memo: Array<Uint8Array | number[]> = [],
  ): TxInput {
    let hplFeeMode: [{ receiverPays: null } | { senderPays: null }] | [] = [];
    if (feeMode === FeeMode.SENDER_PAYS) {
      hplFeeMode = [{ senderPays: null }];
    } else if (feeMode === FeeMode.RECEIVER_PAYS) {
      hplFeeMode = [{ receiverPays: null }];
    }
    return {
      ftTransfer: {
        from: toAccountRef(from),
        to: toAccountRef(to),
        asset,
        amount:
          amount === 'max' ? { max: null } : { amount: typeof amount == 'bigint' ? amount : BigInt(amount as number) },
        feeMode: hplFeeMode,
        memo,
      },
    };
  }
}
