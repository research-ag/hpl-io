export const idlFactory = ({ IDL }) => {
  const IdRange = IDL.Tuple(IDL.Nat, IDL.Opt(IDL.Nat));
  const IdSelector = IDL.Variant({
    'id' : IDL.Nat,
    'cat' : IDL.Vec(IDL.Variant({ 'id' : IDL.Nat, 'idRange' : IdRange })),
    'idRange' : IdRange,
  });
  const SubId = IDL.Nat;
  const AssetId = IDL.Nat;
  const AccountType = IDL.Variant({ 'ft' : AssetId });
  const VirId = IDL.Nat;
  const AccountState = IDL.Variant({ 'ft' : IDL.Nat });
  const Time = IDL.Nat64;
  const RemoteId = IDL.Tuple(IDL.Principal, IDL.Nat);
  const RemoteSelector = IDL.Variant({
    'id' : RemoteId,
    'cat' : IDL.Vec(IDL.Variant({ 'id' : RemoteId })),
  });
  const FtSupply = IDL.Nat;
  const GlobalId = IDL.Tuple(IDL.Nat, IDL.Nat);
  const FtTransferErrors = IDL.Variant({
    'DeletedVirtualAccount' : IDL.Null,
    'InvalidArguments' : IDL.Text,
    'InsufficientFunds' : IDL.Null,
  });
  const ProcessingError = IDL.Variant({ 'ftTransfer' : FtTransferErrors });
  const TxOutput = IDL.Variant({
    'ftTransfer' : IDL.Record({ 'fee' : IDL.Nat, 'amount' : IDL.Nat }),
  });
  const TxResult = IDL.Variant({
    'failure' : ProcessingError,
    'success' : TxOutput,
  });
  const GidStatus = IDL.Variant({
    'dropped' : IDL.Record({}),
    'awaited' : IDL.Record({}),
    'processed' : IDL.Tuple(IDL.Opt(TxResult)),
  });
  const LedgerIngressAPI = IDL.Service({
    'accountInfo' : IDL.Func(
        [IdSelector],
        [IDL.Vec(IDL.Tuple(SubId, AccountType))],
        ['query'],
      ),
    'aggregators' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat))],
        ['query'],
      ),
    'createFungibleToken' : IDL.Func(
        [IDL.Nat8, IDL.Text],
        [
          IDL.Variant({
            'ok' : AssetId,
            'err' : IDL.Variant({
              'NoSpace' : IDL.Null,
              'FeeError' : IDL.Null,
            }),
          }),
        ],
        [],
      ),
    'deleteVirtualAccount' : IDL.Func(
        [VirId],
        [
          IDL.Variant({
            'ok' : IDL.Variant({ 'ft' : IDL.Nat }),
            'err' : IDL.Variant({
              'DeletedVirtualAccount' : IDL.Null,
              'InvalidArguments' : IDL.Text,
            }),
          }),
        ],
        [],
      ),
    'ftInfo' : IDL.Func(
        [IdSelector],
        [
          IDL.Vec(
            IDL.Tuple(
              AssetId,
              IDL.Record({
                'controller' : IDL.Principal,
                'decimals' : IDL.Nat8,
                'description' : IDL.Text,
              }),
            )
          ),
        ],
        ['query'],
      ),
    'nAccounts' : IDL.Func([], [IDL.Nat], ['query']),
    'nFtAssets' : IDL.Func([], [IDL.Nat], ['query']),
    'nVirtualAccounts' : IDL.Func([], [IDL.Nat], ['query']),
    'openAccounts' : IDL.Func(
        [IDL.Nat, AccountType],
        [
          IDL.Variant({
            'ok' : IDL.Record({ 'first' : SubId }),
            'err' : IDL.Variant({
              'InvalidArguments' : IDL.Text,
              'NoSpaceForPrincipal' : IDL.Null,
              'NoSpaceForSubaccount' : IDL.Null,
            }),
          }),
        ],
        [],
      ),
    'openVirtualAccount' : IDL.Func(
        [AccountType, IDL.Principal, AccountState, SubId, Time],
        [
          IDL.Variant({
            'ok' : IDL.Record({ 'id' : VirId }),
            'err' : IDL.Variant({
              'InvalidArguments' : IDL.Text,
              'NoSpaceForAccount' : IDL.Null,
            }),
          }),
        ],
        [],
      ),
    'state' : IDL.Func(
        [
          IDL.Record({
            'ftSupplies' : IDL.Opt(IdSelector),
            'virtualAccounts' : IDL.Opt(IdSelector),
            'accounts' : IDL.Opt(IdSelector),
            'remoteAccounts' : IDL.Opt(RemoteSelector),
          }),
        ],
        [
          IDL.Record({
            'ftSupplies' : IDL.Vec(IDL.Tuple(AssetId, FtSupply)),
            'virtualAccounts' : IDL.Vec(
              IDL.Tuple(VirId, IDL.Opt(IDL.Tuple(AccountState, SubId, Time)))
            ),
            'accounts' : IDL.Vec(IDL.Tuple(SubId, AccountState)),
            'remoteAccounts' : IDL.Vec(
              IDL.Tuple(RemoteId, IDL.Opt(IDL.Tuple(AccountState, Time)))
            ),
          }),
        ],
        ['query'],
      ),
    'streamStatus' : IDL.Func(
        [IdSelector],
        [
          IDL.Vec(
            IDL.Tuple(
              IDL.Nat,
              IDL.Record({
                'closed' : IDL.Bool,
                'source' : IDL.Variant({
                  'internal' : IDL.Null,
                  'aggregator' : IDL.Principal,
                }),
                'length' : IDL.Nat,
                'lastActive' : Time,
              }),
            )
          ),
        ],
        ['query'],
      ),
    'txStatus' : IDL.Func([IDL.Vec(GlobalId)], [IDL.Vec(GidStatus)], ['query']),
    'updateVirtualAccount' : IDL.Func(
        [
          VirId,
          IDL.Record({
            'backingAccount' : IDL.Opt(SubId),
            'state' : IDL.Opt(
              IDL.Variant({
                'ft_dec' : IDL.Nat,
                'ft_inc' : IDL.Nat,
                'ft_set' : IDL.Nat,
              })
            ),
            'expiration' : IDL.Opt(Time),
          }),
        ],
        [
          IDL.Variant({
            'ok' : IDL.Variant({ 'ft' : IDL.Tuple(IDL.Nat, IDL.Int) }),
            'err' : IDL.Variant({
              'DeletedVirtualAccount' : IDL.Null,
              'InvalidArguments' : IDL.Text,
              'InsufficientFunds' : IDL.Null,
            }),
          }),
        ],
        [],
      ),
    'virtualAccountInfo' : IDL.Func(
        [IdSelector],
        [
          IDL.Vec(
            IDL.Tuple(VirId, IDL.Opt(IDL.Tuple(AccountType, IDL.Principal)))
          ),
        ],
        ['query'],
      ),
  });
  return LedgerIngressAPI;
};
export const init = ({ IDL }) => { return []; };
