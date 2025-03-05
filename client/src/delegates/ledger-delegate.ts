import { Principal } from '@dfinity/principal';
import {
  _SERVICE as LedgerAPI,
  AccountState,
  AccountType,
  AssetId,
  GidStatus,
  GlobalId,
  IdSelector,
  RemoteSelector,
  SubId,
  Time,
  VirId,
} from '../../candid/ledger';
import { idlFactory as ledgerIDLFactory } from '../../candid/ledger.idl';
import { Delegate } from './delegate';
import { unpackVariant } from '../utils/unpack-variant.util';
import { accountInfoCast, JsAccountInfo, JsAccountState, ledgerStateCast } from './types';
import { QueryRetryInterceptorErrorCallback } from './call-interceptors';

export type TxResult = any; // TODO type when implemented
export type TxLedStatus =
  | { status: 'dropped' }
  | { status: 'awaited' }
  | { status: 'processed'; result: TxResult | null };

export type StreamStatus = {
  closed: boolean;
  source: { type: 'internal' } | { type: 'aggregator'; principal: Principal };
  length: bigint;
  lastActive: bigint;
};

export class LedgerDelegate extends Delegate<LedgerAPI> {
  constructor(
    protected readonly _canisterPrincipal: Principal | string,
    network: 'ic' | 'local',
  ) {
    super(ledgerIDLFactory, _canisterPrincipal, network);
  }

  async accountInfo(selector: IdSelector): Promise<Array<[bigint, JsAccountInfo]>> {
    return (await this.query((await this.service).accountInfo, {}, selector)).map(([id, x]) => [
      id,
      accountInfoCast(x),
    ]);
  }

  async nAccounts(): Promise<bigint> {
    return this.query((await this.service).nAccounts);
  }

  async nVirtualAccounts(): Promise<bigint> {
    return this.query((await this.service).nVirtualAccounts);
  }

  async virtualAccountInfo(
    selector: IdSelector,
  ): Promise<Array<[bigint, { type: 'ft'; assetId: AssetId; accessPrincipal: Principal } | null]>> {
    const info = await this.query((await this.service).virtualAccountInfo, {}, selector);
    return info.map(([id, x]) => [id, !!x[0] ? { type: 'ft', assetId: x[0].ft, accessPrincipal: x[1] } : null]);
  }

  async remoteAccountInfo(
    selector: RemoteSelector,
  ): Promise<Array<[[Principal, VirId], { type: 'ft'; assetId: AssetId } | null]>> {
    const info = await this.query((await this.service).remoteAccountInfo, {}, selector);
    return info.map(([id, x]) => [id, { type: 'ft', assetId: x.ft }]);
  }

  async createFungibleToken(decimals: number, description: string): Promise<bigint> {
    return this.resUpdate((await this.service).createFungibleToken, decimals, description);
  }

  async openAccounts(accountTypes: AccountType[]): Promise<{ first: bigint }> {
    return this.resUpdate((await this.service).openAccounts, accountTypes);
  }

  async openVirtualAccounts(
    args: {
      accountType: { type: 'ft'; assetId: AssetId };
      accessPrincipal: Principal | string;
      assetState: { type: 'ft'; balance: bigint };
      backingAccount: SubId;
      expiration?: number;
    }[],
  ): Promise<{ first: VirId }> {
    return this.resUpdate(
      (await this.service).openVirtualAccounts,
      args.map(
        a =>
          [
            { [a.accountType.type]: a.accountType.assetId },
            typeof a.accessPrincipal === 'string' ? Principal.fromText(a.accessPrincipal) : a.accessPrincipal,
            { [a.assetState.type]: a.assetState.balance },
            a.backingAccount,
            BigInt(a.expiration || 0) * BigInt(1000000),
          ] as [AccountType, Principal, AccountState, SubId, Time],
      ),
    );
  }

  async openVirtualAccount(
    accountType: { type: 'ft'; assetId: AssetId },
    accessPrincipal: Principal | string,
    assetState: { type: 'ft'; balance: bigint },
    backingAccount: SubId,
    expiration?: number,
  ): Promise<{ id: VirId }> {
    let { first } = await this.openVirtualAccounts([
      {
        accountType,
        accessPrincipal,
        assetState,
        backingAccount,
        expiration,
      },
    ]);
    return { id: first };
  }

  async updateVirtualAccounts(
    args: {
      vid: VirId;
      updates: {
        backingAccount?: SubId;
        state?: { ft_set: bigint } | { ft_dec: bigint } | { ft_inc: bigint };
        expiration?: number;
      };
    }[],
  ): Promise<{ type: 'ft'; balance: bigint; delta: bigint }[]> {
    const response = await this.resUpdate<
      [
        [
          VirId,
          {
            backingAccount: [] | [SubId];
            state: [] | [{ ft_dec: bigint } | { ft_inc: bigint } | { ft_set: bigint }];
            expiration: [] | [Time];
          },
        ][],
      ],
      { ft: [bigint, bigint] }[],
      { DeletedVirtualAccount: null } | { InvalidArguments: string } | { InsufficientFunds: null }
    >(
      (await this.service).updateVirtualAccounts,
      args.map(a => [
        a.vid,
        {
          backingAccount:
            a.updates.backingAccount || a.updates.backingAccount === BigInt(0) ? [a.updates.backingAccount] : [],
          state: a.updates.state ? [a.updates.state] : [],
          expiration:
            a.updates.expiration || a.updates.expiration === 0 ? [BigInt(a.updates.expiration) * BigInt(1000000)] : [],
        },
      ]),
    );
    return response.map(r => ({ type: 'ft', balance: r.ft[0], delta: r.ft[1] }));
  }

  async updateVirtualAccount(
    vid: VirId,
    updates: {
      backingAccount?: SubId;
      state?: { ft_set: bigint } | { ft_dec: bigint } | { ft_inc: bigint };
      expiration?: number;
    },
  ): Promise<{ type: 'ft'; balance: bigint; delta: bigint }> {
    const resp = await this.updateVirtualAccounts([{ vid, updates }]);
    return resp[0];
  }

  async deleteVirtualAccounts(vids: [VirId]): Promise<{ type: 'ft'; balance: bigint }[]> {
    const resp = await this.resUpdate<
      [VirId[]],
      { ft: bigint }[],
      { DeletedVirtualAccount: null } | { InvalidArguments: string }
    >((await this.service).deleteVirtualAccounts, vids);
    return resp.map(r => ({ type: 'ft', balance: r.ft }));
  }

  async deleteVirtualAccount(vid: VirId): Promise<{ type: 'ft'; balance: bigint }> {
    const result = await this.deleteVirtualAccounts([vid]);
    return result[0];
  }

  async feeRatio(): Promise<bigint> {
    return this.query((await this.service).feeRatio);
  }

  private castTxStatusResponse = (res: GidStatus) => {
    const [status, payload] = unpackVariant(res);
    if (status === 'awaited') {
      return { status, aggregator: (payload as [Principal])[0] };
    } else if (status === 'processed') {
      return { status, result: (payload as [[TxResult]] | [])[0] || null };
    } else {
      return { status };
    }
  };

  async txStatus(
    gids: GlobalId[],
    retryErrorCallback: QueryRetryInterceptorErrorCallback = null,
  ): Promise<TxLedStatus[]> {
    const res = await this.query((await this.service).txStatus, { retryErrorCallback }, gids);
    return res.map(this.castTxStatusResponse);
  }

  async singleTxStatus(
    id: GlobalId,
    retryErrorCallback: QueryRetryInterceptorErrorCallback = null,
  ): Promise<TxLedStatus> {
    return (await this.txStatus([id], retryErrorCallback))[0];
  }

  async timestampedSingleTxStatus(
    id: GlobalId,
    retryErrorCallback: QueryRetryInterceptorErrorCallback = null,
  ): Promise<[TxLedStatus, number]> {
    const [res, callExtraData] = await this.queryWithExtras<[Array<GlobalId>], Array<GidStatus>>(
      (await this.service).txStatus,
      { retryErrorCallback },
      [id],
    );
    return [this.castTxStatusResponse(res[0]), callExtraData.canisterTimestamp];
  }

  async nFtAssets(): Promise<bigint> {
    return this.query((await this.service).nFtAssets);
  }

  async ftInfo(
    selector: IdSelector,
  ): Promise<Array<[AssetId, { controller: Principal; decimals: number; description: string }]>> {
    return this.query((await this.service).ftInfo, {}, selector);
  }

  async aggregators(): Promise<{ principal: Principal; priority: number }[]> {
    const res = await this.query((await this.service).aggregators);
    return res.map(([principal, priority]) => ({ principal, priority: Number(priority) }));
  }

  async aggregatorPrincipal(streamId: bigint): Promise<Principal | null> {
    const [info] = await this.query((await this.service).streamInfo, {}, { id: streamId });
    return info ? info[1] : null;
  }

  async nStreams(): Promise<bigint> {
    return this.query((await this.service).nStreams);
  }

  async streamStatus(selector: IdSelector): Promise<Array<[bigint, StreamStatus]>> {
    const items = await this.query((await this.service).streamStatus, {}, selector);
    return items.map(([id, status]) => {
      const [sourceType, sourcePrincipal] = unpackVariant(status.source);
      const source: any = { type: sourceType };
      if (sourceType === 'aggregator') {
        source.principal = sourcePrincipal;
      }
      return [id, { ...status, source }];
    });
  }

  async state(arg: {
    ftSupplies?: IdSelector;
    virtualAccounts?: IdSelector;
    accounts?: IdSelector;
    remoteAccounts?: RemoteSelector;
  }): Promise<{
    ftSupplies: Array<[AssetId, bigint]>;
    virtualAccounts: Array<[VirId, { state: JsAccountState; backingSubaccountId: bigint; expiration: bigint }]>;
    accounts: Array<[SubId, JsAccountState]>;
    remoteAccounts: Array<[[Principal, VirId], { state: JsAccountState; expiration: bigint } | null]>;
  }> {
    return ledgerStateCast(
      await this.query(
        (await this.service).state,
        {},
        {
          ftSupplies: arg.ftSupplies ? [arg.ftSupplies] : [],
          virtualAccounts: arg.virtualAccounts ? [arg.virtualAccounts] : [],
          accounts: arg.accounts ? [arg.accounts] : [],
          remoteAccounts: arg.remoteAccounts ? [arg.remoteAccounts] : [],
        },
      ),
    );
  }
}
