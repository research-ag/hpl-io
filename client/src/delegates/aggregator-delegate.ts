import { Principal } from '@dfinity/principal';
import { _SERVICE as AggregatorAPI, GidStatus, GlobalId, TxInput } from '../../candid/aggregator';
import { idlFactory as aggregatorIDLFactory } from '../../candid/aggregator.idl';
import { Delegate } from './delegate';
import { unpackVariant } from '../utils/unpack-variant';
import { QueryRetryInterceptorErrorCallback } from './call-interceptors';

export type TxAggStatus =
  | { status: 'pending' }
  | { status: 'queued'; queueNumber: bigint }
  | { status: 'other'; lastLedgerTimestamp: bigint };

export class AggregatorDelegate extends Delegate<AggregatorAPI> {
  constructor(
    protected readonly _canisterPrincipal: Principal | string,
    network: 'ic' | 'local',
  ) {
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

  async txStatus(
    gids: GlobalId[],
    retryErrorCallback: QueryRetryInterceptorErrorCallback = null,
  ): Promise<TxAggStatus[]> {
    const res = await this.query((await this.service).txStatus, { retryErrorCallback }, gids);
    return res.map(this.castTxStatusResponse);
  }

  async singleTxStatus(
    id: GlobalId,
    retryErrorCallback: QueryRetryInterceptorErrorCallback = null,
  ): Promise<TxAggStatus> {
    return (await this.txStatus([id], retryErrorCallback))[0];
  }

  async timestampedSingleTxStatus(
    id: GlobalId,
    retryErrorCallback: QueryRetryInterceptorErrorCallback = null,
  ): Promise<[TxAggStatus, number]> {
    const [results, { canisterTimestamp }] = await this.queryWithExtras<[Array<GlobalId>], Array<GidStatus>>(
      (await this.service).txStatus,
      { retryErrorCallback },
      [id],
    );
    return [this.castTxStatusResponse(results[0]), canisterTimestamp];
  }

  async streamStatus(): Promise<{ id: bigint; sent: bigint; received: bigint; length: bigint }[]> {
    return this.query((await this.service).streamStatus);
  }
}
