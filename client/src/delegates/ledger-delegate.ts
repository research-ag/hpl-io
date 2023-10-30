import { Principal } from '@dfinity/principal';
import {
  _SERVICE as LedgerAPI,
  AccountType,
  AssetId,
  GlobalId,
  IdSelector,
  RemoteSelector,
  SubId,
  VirId,
} from '../../candid/ledger';
import { idlFactory as ledgerIDLFactory } from '../../candid/ledger.idl';
import { Delegate } from './delegate';
import { unpackVariant } from '../utils/unpack-variant';
import { accountInfoCast, JsAccountInfo, JsAccountState, ledgerStateCast } from './types';

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
  constructor(protected readonly _canisterPrincipal: Principal | string, network: 'ic' | 'local') {
    super(ledgerIDLFactory, _canisterPrincipal, network);
  }

  async accountInfo(selector: IdSelector): Promise<Array<[bigint, JsAccountInfo]>> {
    return (await this.query((await this.service).accountInfo, selector)).map(([id, x]) => [id, accountInfoCast(x)]);
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
    const info = await this.query((await this.service).virtualAccountInfo, selector);
    return info.map(([id, x]) => [id, !!x[0] ? { type: 'ft', assetId: x[0].ft, accessPrincipal: x[1] } : null]);
  }

  async remoteAccountInfo(
    selector: RemoteSelector,
  ): Promise<Array<[[Principal, VirId], { type: 'ft'; assetId: AssetId } | null]>> {
    const info = await this.query((await this.service).remoteAccountInfo, selector);
    return info.map(([id, x]) => [id, { type: 'ft', assetId: x.ft }]);
  }

  async createFungibleToken(decimals: number, description: string): Promise<bigint> {
    return this.resUpdate((await this.service).createFungibleToken, decimals, description);
  }

  async openAccounts(accountType: AccountType, amount: number): Promise<{ first: bigint }> {
    return this.resUpdate((await this.service).openAccounts, BigInt(amount), accountType);
  }

  async openVirtualAccount(
    accountType: { type: 'ft'; assetId: AssetId },
    accessPrincipal: Principal | string,
    assetState: { type: 'ft'; balance: bigint },
    backingAccount: SubId,
    expiration?: number,
  ): Promise<{ id: VirId }> {
    return this.resUpdate(
      (await this.service).openVirtualAccount,
      { [accountType.type]: accountType.assetId },
      accessPrincipal instanceof Principal ? accessPrincipal : Principal.fromText(accessPrincipal),
      { [assetState.type]: assetState.balance },
      backingAccount,
      BigInt(expiration || 0) * BigInt(1000000),
    );
  }

  async updateVirtualAccount(
    vid: VirId,
    updates: {
      backingAccount?: SubId;
      state?: { ft_set: bigint } | { ft_dec: bigint } | { ft_inc: bigint };
      expiration?: number;
    },
  ): Promise<{ type: 'ft'; balance: bigint; delta: bigint }> {
    const response = await this.resUpdate((await this.service).updateVirtualAccount, vid, {
      backingAccount: updates.backingAccount || updates.backingAccount === BigInt(0) ? [updates.backingAccount] : [],
      state: updates.state ? [updates.state] : [],
      expiration: updates.expiration || updates.expiration === 0 ? [BigInt(updates.expiration) * BigInt(1000000)] : [],
    });
    return { type: 'ft', balance: response.ft[0], delta: response.ft[1] };
  }

  async deleteVirtualAccount(vid: VirId): Promise<{ type: 'ft'; balance: bigint }> {
    const result = await this.resUpdate((await this.service).deleteVirtualAccount, vid);
    return { type: 'ft', balance: result.ft };
  }

  async txStatus(gids: GlobalId[]): Promise<TxLedStatus[]> {
    const res = await this.query((await this.service).txStatus, gids);
    return res.map(res => {
      const [status, payload] = unpackVariant(res);
      if (status === 'awaited') {
        return { status, aggregator: (payload as [Principal])[0] };
      } else if (status === 'processed') {
        return { status, result: (payload as [[TxResult]] | [])[0] || null };
      } else {
        return { status };
      }
    });
  }

  async singleTxStatus(id: GlobalId): Promise<TxLedStatus> {
    return (await this.txStatus([id]))[0];
  }

  async nFtAssets(): Promise<bigint> {
    return this.query((await this.service).nFtAssets);
  }

  async ftInfo(
    selector: IdSelector,
  ): Promise<Array<[AssetId, { controller: Principal; decimals: number; description: string }]>> {
    return this.query((await this.service).ftInfo, selector);
  }

  async aggregators(): Promise<{ principal: Principal; priority: number }[]> {
    const res = await this.query((await this.service).aggregators);
    return res.map(([principal, priority]) => ({ principal, priority: Number(priority) }));
  }

  async aggregatorPrincipal(streamId: bigint): Promise<Principal | null> {
    const [info] = await this.query((await this.service).streamInfo, { id: streamId });
    return info ? info[1] : null;
  }

  async nStreams(): Promise<bigint> {
    return this.query((await this.service).nStreams);
  }

  async streamStatus(selector: IdSelector): Promise<Array<[bigint, StreamStatus]>> {
    const items = await this.query((await this.service).streamStatus, selector);
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
      await this.query((await this.service).state, {
        ftSupplies: arg.ftSupplies ? [arg.ftSupplies] : [],
        virtualAccounts: arg.virtualAccounts ? [arg.virtualAccounts] : [],
        accounts: arg.accounts ? [arg.accounts] : [],
        remoteAccounts: arg.remoteAccounts ? [arg.remoteAccounts] : [],
      }),
    );
  }
}
