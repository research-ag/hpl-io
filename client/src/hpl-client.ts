import { Principal } from '@dfinity/principal';
import { LedgerDelegate } from './delegates/ledger-delegate';
import { LedgerAdminDelegate } from './delegates/ledger-admin-delegate';
import { AggregatorDelegate } from './delegates/aggregator-delegate';
import { AssetId, GlobalId } from '../candid/ledger';
import { finalize, Observable, Subject, takeWhile } from 'rxjs';
import { Actor, AnonymousIdentity, Identity, RequestId } from '@dfinity/agent';
import { AccountRef, TxInput } from '../candid/aggregator';
import { sleep } from './utils/sleep.util';

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
    memo: Array<Uint8Array | number[]> = [],
  ): Promise<GlobalId> {
    return aggregator.singleSubmitAndExecute(this._txInputFromRawArgs(from, to, asset, amount, memo));
  }

  async prepareSimpleTransfer(
    aggregator: AggregatorDelegate,
    from: TransferAccountReference,
    to: TransferAccountReference,
    asset: AssetId,
    amount: number | BigInt | 'max',
    memo: Array<Uint8Array | number[]> = [],
  ): Promise<{ requestId: RequestId; commit: () => Promise<GlobalId> }> {
    const { requestId, call: commit } = await aggregator.prepareUpdateRequest<[[TxInput]], [GlobalId]>(
      'submitAndExecute',
      [this._txInputFromRawArgs(from, to, asset, amount, memo)],
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
    setTimeout(async () => {
      try {
        let pollingState = 'aggregator';
        let counter = 0;

        const pollAggregatorRoutine = async (): Promise<SimpleTransferStatus> => {
          const txStatus = await aggregator.singleTxStatus(txId);
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
          return status;
        };
        const pollLedgerRoutine = async (throwErrorOnAwaited: boolean) => {
          const ledgerStatus = await this.ledger.singleTxStatus(txId);
          if (ledgerStatus.status === 'dropped') {
            throw new Error('Ledger responded with "dropped" state');
          } else if (ledgerStatus.status === 'processed') {
            subj.next({ status: 'processed', txId, statusPayload: ledgerStatus.result });
            return true;
          } else if (ledgerStatus.status === 'awaited') {
            if (throwErrorOnAwaited) {
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
          return false;
        };
        pollingLoop: while (true) {
          switch (pollingState) {
            case 'aggregator':
              await sleep(250);
              subj.next(await pollAggregatorRoutine());
              break;
            case 'both':
              await sleep(250);
              const routines: [l: Promise<boolean>, a?: Promise<SimpleTransferStatus>] = [pollLedgerRoutine(false)];
              if (counter % 3 == 0) {
                routines.push(pollAggregatorRoutine());
              }
              const [processed, aggStatus] = await Promise.all(routines);
              if (processed) {
                break pollingLoop;
              }
              if (aggStatus) {
                subj.next(aggStatus);
              }
              break;
            case 'final':
              await pollLedgerRoutine(true);
              break pollingLoop;
          }
          counter++;
        }
      } catch (err) {
        subj.error(err);
      }
      subj.complete();
    }, 0);
    return subj.pipe(finalize(() => (interrupted = true)));
  }

  private _txInputFromRawArgs(
    from: TransferAccountReference,
    to: TransferAccountReference,
    asset: AssetId,
    amount: number | BigInt | 'max',
    memo: Array<Uint8Array | number[]> = [],
  ): TxInput {
    return {
      ftTransfer: {
        from: toAccountRef(from),
        to: toAccountRef(to),
        asset,
        amount:
          amount === 'max' ? { max: null } : { amount: typeof amount == 'bigint' ? amount : BigInt(amount as number) },
        memo,
      },
    };
  }
}
