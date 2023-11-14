import { Principal } from '@dfinity/principal';
import { LedgerDelegate } from './delegates/ledger-delegate';
import { LedgerAdminDelegate } from './delegates/ledger-admin-delegate';
import { AggregatorDelegate } from './delegates/aggregator-delegate';
import { AssetId, GlobalId } from '../candid/ledger';
import { finalize, Observable, Subject, takeWhile } from 'rxjs';
import { Actor, AnonymousIdentity, Identity, RequestId } from '@dfinity/agent';
import { AccountRef, TxInput } from '../candid/aggregator';
import { sleep } from './utils/sleep.util';
import { HplError } from './hpl-error';
import { FeeMode } from './types';

export type SimpleTransferStatusKey = 'queued' | 'forwarding' | 'forwarded' | 'processed';

export type SimpleTransferStatus = {
  status: SimpleTransferStatusKey;
  txId: GlobalId | null;
  statusPayload?: any | { info: any };
};

export type AggregatorTxStatus = SimpleTransferStatus & {
  status: 'queued' | 'forwarding' | 'forwarded';
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
    (Actor.agentOf((await this.ledger.service) as any as Actor) as any).replaceIdentity(identity);
    (Actor.agentOf((await this.admin.service) as any as Actor) as any).replaceIdentity(identity);
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
    (Actor.agentOf((await delegate.service) as any as Actor) as any).replaceIdentity(identity);
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
  ): Promise<{ requestId: RequestId; commit: () => Promise<GlobalId> }> {
    const { requestId, call: commit } = await aggregator.prepareUpdateRequest<[[TxInput]], [GlobalId]>(
      'submitAndExecute',
      [this._txInputFromRawArgs(from, to, asset, amount, feeMode, memo)],
    );
    return {
      requestId,
      commit: async () => {
        const result = await commit();
        return result[0];
      },
    };
  }

  pollTx(aggregator: AggregatorDelegate, txId: GlobalId): Observable<SimpleTransferStatus> {
    const subj: Subject<SimpleTransferStatus> = new Subject<SimpleTransferStatus>();
    let interrupted = false;
    let lastStatus: SimpleTransferStatus | undefined;
    subj.pipe(takeWhile(() => !interrupted)).subscribe(s => {
      lastStatus = s;
    });
    let pollingState = 'aggregator';

    // polls aggregator until it responds with "other" status; controls polling state.
    const pollAggregator = async (getInterrupted: () => boolean) => {
      // sometimes it is possible that txStatus will be answered by fallen-behind replica
      // in this case we can catch not possible otherwise error "Not yet issued".
      // we ignore up to 20 such errors
      let notYetIssuedCounter = 0;
      while (!getInterrupted()) {
        try {
          const txStatus = await aggregator.singleTxStatus(txId);
          // while we were waiting to response, the polling could've been already interrupted by ledger polling or externally
          if (getInterrupted()) {
            return;
          }
          let status: SimpleTransferStatus = null!;
          if (txStatus.status == 'queued') {
            status = { status: 'queued', txId, statusPayload: txStatus.queueNumber };
            pollingState = 'aggregator';
          } else if (txStatus.status == 'pending') {
            status = {
              status: 'forwarding',
              txId,
              statusPayload: {
                info: `Aggregator responded with state "pending"`,
              },
            };
            pollingState = 'both';
          } else {
            status = { status: 'forwarded', txId };
            pollingState = 'final';
          }
          subj.next(status);
        } catch (e) {
          if (
            notYetIssuedCounter < 20 &&
            e instanceof HplError &&
            e.errorKey == 'CanisterReject' &&
            e.errorPayload == 'Not yet issued'
          ) {
            notYetIssuedCounter++;
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
      // sometimes it is possible that txStatus will be answered by fallen-behind replica
      // in this case we can catch not possible otherwise status "awaited", even after aggregator reported "other".
      // we ignore up to 20 such errors
      let finalCallsCounter = 0;
      while (!getInterrupted()) {
        if (pollingState === 'aggregator') {
          await sleep(50);
          continue;
        } else if (pollingState === 'final') {
          finalCallsCounter++;
        }
        const ledgerStatus = await this.ledger.singleTxStatus(txId);
        // while we were waiting to response, the polling could've been already interrupted externally
        if (getInterrupted()) {
          return;
        }
        switch (ledgerStatus.status) {
          case 'dropped':
            throw new Error('Ledger responded with "dropped" state');
          case 'processed':
            subj.next({ status: 'processed', txId, statusPayload: ledgerStatus.result });
            return;
          case 'awaited':
            if (finalCallsCounter >= 20) {
              throw new Error('Ledger responded with "awaited" state, when aggregator already forwarded transaction');
            } else {
              subj.next({
                status: lastStatus!.status,
                txId,
                statusPayload: {
                  info: `Ledger responded with state "awaited"`,
                },
              });
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
    let hplFeeMode : [({ receiverPays: null } | { senderPays: null })] | [] = [];
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
