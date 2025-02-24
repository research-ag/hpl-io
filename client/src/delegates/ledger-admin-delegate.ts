import { Principal } from '@dfinity/principal';
import {
  _SERVICE as LedgerAdminAPI,
  AssetId,
  IdSelector,
  RemoteSelector,
  SubId,
  VirId,
} from '../../candid/ledger_admin';
import { idlFactory as ledgerAdminIDLFactory } from '../../candid/ledger_admin.idl';
import { Delegate } from './delegate';
import { accountInfoCast, JsAccountInfo, JsAccountState, ledgerStateCast } from './types';

export class LedgerAdminDelegate extends Delegate<LedgerAdminAPI> {
  constructor(protected readonly _canisterPrincipal: Principal | string, network: 'ic' | 'local') {
    super(ledgerAdminIDLFactory, _canisterPrincipal, network);
  }

  async accountInfo(selector: IdSelector): Promise<Array<[bigint, JsAccountInfo]>> {
    return (await this.query((await this.service).adminAccountInfo, {}, selector)).map(([id, x]) => [
      id,
      accountInfoCast(x),
    ]);
  }

  async nAccounts(): Promise<bigint> {
    return this.query((await this.service).nAdminAccounts);
  }

  async state(arg: {
    ftSupplies?: IdSelector;
    virtualAccounts?: IdSelector;
    accounts?: IdSelector;
    remoteAccounts?: RemoteSelector;
  }): Promise<{
    ftSupplies: Array<[AssetId, bigint]>;
    virtualAccounts: Array<[VirId, { state: JsAccountState; backingSubaccountId: bigint; expiration: bigint } | null]>;
    accounts: Array<[SubId, JsAccountState]>;
    remoteAccounts: Array<[[Principal, VirId], { state: JsAccountState; expiration: bigint } | null]>;
  }> {
    return ledgerStateCast(
      await this.query(
        (
          await this.service
        ).adminState,
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
