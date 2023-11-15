import { Principal } from '@dfinity/principal';
import { _SERVICE as AggregatorAPI, GidStatus, GlobalId, TxInput } from '../../candid/aggregator';
import { idlFactory as aggregatorIDLFactory } from '../../candid/aggregator.idl';
import { Delegate } from './delegate';
import { unpackVariant } from '../utils/unpack-variant';
import { QueryRetryInterceptorErrorCallback } from './call-interceptors';

// import { idlFactory as certifiedAggregatorIdlFactory } from '../../candid/aggregator.certified.idl';

export type TxAggStatus =
  | { status: 'pending' }
  | { status: 'queued'; queueNumber: bigint }
  | { status: 'other'; lastLedgerTimestamp: bigint };

export class AggregatorDelegate extends Delegate<AggregatorAPI> {
  constructor(protected readonly _canisterPrincipal: Principal | string, network: 'ic' | 'local') {
    super(aggregatorIDLFactory, _canisterPrincipal, network);
  }

  async submitAndExecute(txs: TxInput[]): Promise<GlobalId[]> {
    return this.update((await this.service).submitAndExecute, txs);
  }

  async singleSubmitAndExecute(tx: TxInput): Promise<GlobalId> {
    return (await this.update((await this.service).submitAndExecute, [tx]))[0];
  }

  private castTxStatusResponse = (res: GidStatus) => {
    const [status, payload] = unpackVariant(res);
    if (status === 'queued') {
      return { status, queueNumber: (payload as [bigint])[0] };
    } else if (status === 'other') {
      return { status, lastLedgerTimestamp: (payload as [bigint])[0] };
    } else {
      return { status };
    }
  };

  async txStatus(gids: GlobalId[]): Promise<TxAggStatus[]> {
    const res = await this.query((await this.service).txStatus, gids);
    return res.map(this.castTxStatusResponse);
  }

  async singleTxStatus(id: GlobalId): Promise<TxAggStatus> {
    return (await this.txStatus([id]))[0];
  }

  async loggedTxStatus(gids: GlobalId[], errorCallback: QueryRetryInterceptorErrorCallback): Promise<TxAggStatus[]> {
    const res = await this.loggedQuery((await this.service).txStatus, errorCallback, gids);
    return res.map(this.castTxStatusResponse);
  }

  async loggedSingleTxStatus(id: GlobalId, errorCallback: QueryRetryInterceptorErrorCallback): Promise<TxAggStatus> {
    return (await this.loggedTxStatus([id], errorCallback))[0];
  }

  async streamStatus(): Promise<{ id: bigint; sent: bigint; received: bigint; length: bigint }[]> {
    return (await this.service).streamStatus();
  }
}
