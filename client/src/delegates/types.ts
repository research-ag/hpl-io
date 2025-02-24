import { AccountState, AssetId, FtSupply, RemoteId, SubId, Time, VirId } from '../../candid/ledger_admin';
import { Principal } from '@dfinity/principal';
import { unpackOpt } from '../utils/unpack-opt.util';

export type JsAccountState = { type: 'ft'; balance: bigint };
export const accountStateCast = (state: { ft: bigint }): JsAccountState => ({ type: 'ft', balance: state.ft });

export type JsAccountInfo = { type: 'ft'; assetId: bigint };
export const accountInfoCast = (info: { ft: bigint }): JsAccountInfo => ({ type: 'ft', assetId: info.ft });

export type JsLedgerState = {
  ftSupplies: Array<[AssetId, bigint]>;
  virtualAccounts: Array<[VirId, { state: JsAccountState; backingSubaccountId: bigint; expiration: bigint }]>;
  accounts: Array<[SubId, JsAccountState]>;
  remoteAccounts: Array<[[Principal, VirId], { state: JsAccountState; expiration: bigint } | null]>;
};
export const ledgerStateCast = (result: {
  ftSupplies: Array<[AssetId, FtSupply]>;
  virtualAccounts: Array<[VirId, [AccountState, SubId, Time]]>;
  accounts: Array<[SubId, AccountState]>;
  remoteAccounts: Array<[RemoteId, [AccountState, Time]]>;
}): JsLedgerState => {
  return {
    ftSupplies: result.ftSupplies,
    virtualAccounts: result.virtualAccounts.map(([id, item]) => [
      id,
      {
        state: accountStateCast(item[0]),
        backingSubaccountId: item[1],
        expiration: item[2],
      },
    ]),
    accounts: result.accounts.map(([id, x]) => [id, accountStateCast(x)]),
    remoteAccounts: result.remoteAccounts.map(([id, item]) => [
      id,
      {
        state: accountStateCast(item[0]),
        expiration: item[1],
      },
    ]),
  };
};
