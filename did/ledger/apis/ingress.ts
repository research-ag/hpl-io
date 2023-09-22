import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';

export type AccountState = { 'ft' : bigint };
export type AccountType = { 'ft' : AssetId };
export type AssetId = bigint;
export type FtSupply = bigint;
export type FtTransferErrors = { 'DeletedVirtualAccount' : null } |
  { 'InvalidArguments' : string } |
  { 'InsufficientFunds' : null };
export type GidStatus = { 'dropped' : {} } |
  { 'awaited' : {} } |
  { 'processed' : [[] | [TxResult]] };
export type GlobalId = [bigint, bigint];
export type IdRange = [bigint, [] | [bigint]];
export type IdSelector = { 'id' : bigint } |
  { 'cat' : Array<{ 'id' : bigint } | { 'idRange' : IdRange }> } |
  { 'idRange' : IdRange };
export interface LedgerIngressAPI {
  'accountInfo' : ActorMethod<[IdSelector], Array<[SubId, AccountType]>>,
  'aggregators' : ActorMethod<[], Array<[Principal, bigint]>>,
  'createFungibleToken' : ActorMethod<
    [number, string],
    { 'ok' : AssetId } |
      { 'err' : { 'NoSpace' : null } | { 'FeeError' : null } }
  >,
  'deleteVirtualAccount' : ActorMethod<
    [VirId],
    { 'ok' : { 'ft' : bigint } } |
      {
        'err' : { 'DeletedVirtualAccount' : null } |
          { 'InvalidArguments' : string }
      }
  >,
  'ftInfo' : ActorMethod<
    [IdSelector],
    Array<
      [
        AssetId,
        {
          'controller' : Principal,
          'decimals' : number,
          'description' : string,
        },
      ]
    >
  >,
  'nAccounts' : ActorMethod<[], bigint>,
  'nFtAssets' : ActorMethod<[], bigint>,
  'nVirtualAccounts' : ActorMethod<[], bigint>,
  'openAccounts' : ActorMethod<
    [bigint, AccountType],
    { 'ok' : { 'first' : SubId } } |
      {
        'err' : { 'InvalidArguments' : string } |
          { 'NoSpaceForPrincipal' : null } |
          { 'NoSpaceForSubaccount' : null }
      }
  >,
  'openVirtualAccount' : ActorMethod<
    [AccountType, Principal, AccountState, SubId, Time],
    { 'ok' : { 'id' : VirId } } |
      {
        'err' : { 'InvalidArguments' : string } |
          { 'NoSpaceForAccount' : null }
      }
  >,
  'state' : ActorMethod<
    [
      {
        'ftSupplies' : [] | [IdSelector],
        'virtualAccounts' : [] | [IdSelector],
        'accounts' : [] | [IdSelector],
        'remoteAccounts' : [] | [RemoteSelector],
      },
    ],
    {
      'ftSupplies' : Array<[AssetId, FtSupply]>,
      'virtualAccounts' : Array<[VirId, [] | [[AccountState, SubId, Time]]]>,
      'accounts' : Array<[SubId, AccountState]>,
      'remoteAccounts' : Array<[RemoteId, [] | [[AccountState, Time]]]>,
    }
  >,
  'streamStatus' : ActorMethod<
    [IdSelector],
    Array<
      [
        bigint,
        {
          'closed' : boolean,
          'source' : { 'internal' : null } |
            { 'aggregator' : Principal },
          'length' : bigint,
          'lastActive' : Time,
        },
      ]
    >
  >,
  'txStatus' : ActorMethod<[Array<GlobalId>], Array<GidStatus>>,
  'updateVirtualAccount' : ActorMethod<
    [
      VirId,
      {
        'backingAccount' : [] | [SubId],
        'state' : [] | [
          { 'ft_dec' : bigint } |
            { 'ft_inc' : bigint } |
            { 'ft_set' : bigint }
        ],
        'expiration' : [] | [Time],
      },
    ],
    { 'ok' : { 'ft' : [bigint, bigint] } } |
      {
        'err' : { 'DeletedVirtualAccount' : null } |
          { 'InvalidArguments' : string } |
          { 'InsufficientFunds' : null }
      }
  >,
  'virtualAccountInfo' : ActorMethod<
    [IdSelector],
    Array<[VirId, [] | [[AccountType, Principal]]]>
  >,
}
export type ProcessingError = { 'ftTransfer' : FtTransferErrors };
export type RemoteId = [Principal, bigint];
export type RemoteSelector = { 'id' : RemoteId } |
  { 'cat' : Array<{ 'id' : RemoteId }> };
export type SubId = bigint;
export type Time = bigint;
export type TxOutput = { 'ftTransfer' : { 'fee' : bigint, 'amount' : bigint } };
export type TxResult = { 'failure' : ProcessingError } |
  { 'success' : TxOutput };
export type VirId = bigint;
export interface _SERVICE extends LedgerIngressAPI {}
