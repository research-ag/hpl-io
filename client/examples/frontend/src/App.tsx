import React, { useEffect, useRef, useState } from 'react';
import './App.css';
import { AggregatorDelegate, bigIntReplacer, bigIntReviver, HPLClient, LedgerDelegate, LedgerAdminDelegate } from '@research-ag/hpl-client';
import OpenSubaccount from './components/OpenSubaccount';
import OpenVirtualAccount from './components/OpenVirtualAccount';
import UpdateVirtualAccount from './components/UpdateVirtualAccount';
import { Principal } from '@dfinity/principal';
import { AuthClient } from '@dfinity/auth-client';
import { runOrPickupSimpleTransfer, TX_HISTORY_KEY, TxHistoryEntry } from './services/simple-transfer';
import SimpleTransfer from './components/SimpleTransfer';
import MultiQuery from './components/MultiQuery';
import IdSelectorInput, { IdSelector } from './components/IdSelectorInput';
import GidSelectorInput from './components/GidSelectorInput';
import { copyToClipboard, zip } from './utils';
import { AnonymousIdentity, Identity } from '@dfinity/agent';
import { Ed25519KeyIdentity } from '@dfinity/identity';

type NavOption = {
  label: string;
  component?: JSX.Element;
} | 'divider';

let localStorageUnfinishedItems: [number, TxHistoryEntry][] = [];

const loadUnfinishedTxsFromLocalStorage = () => {
  localStorageUnfinishedItems = new Array(localStorage.length)
      .fill(null)
      .map((_, i) => localStorage.key(i)!)
      .filter(k => k.startsWith(TX_HISTORY_KEY))
      .map(k => {
        let obj = null;
        try {
          obj = JSON.parse(localStorage.getItem(k)!, bigIntReviver);
        } catch (err) {
          // pass
        }
        return [+k.substring(TX_HISTORY_KEY.length), obj] as [number, TxHistoryEntry];
      })
      .filter(([k, v]) => v.lastSeenStatus && v.lastSeenStatus !== 'processed');
};

loadUnfinishedTxsFromLocalStorage();

const App: React.FC = () => {
  const [ledgerPrincipal, setLedgerPrincipal] = useState<string>(`${process.env.LEDGER_CANISTER_ID}`);
  const [ledgerPrincipalInput, setLedgerPrincipalInput] = useState<string>(`${process.env.LEDGER_CANISTER_ID}`);
  const [client] = useState<HPLClient>(new HPLClient(ledgerPrincipal, process.env.DFX_NETWORK as any));
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [identity, setIdentity] = useState(new AnonymousIdentity());
  useEffect(() => {
    client.setIdentity(identity);
  }, [client, identity]);

  const [selectedNavItem, setSelectedNavItem] = useState<number>(1);
  const [log, setLog] = useState<string[]>([
    `Ledger principal: ${ledgerPrincipal}`,
  ]);
  const logContainerRef = useRef<HTMLDivElement>(null); // Ref for the log container element

  const appendLogEntry = (logEntry: string) => {
    setLog((prevLog) => [...prevLog, logEntry]);
  };

  const wrapCall = <Args extends Array<unknown>>(f: (...args: Args) => Promise<void>): (...args: Args) => Promise<void> => {
    return async (...args) => {
      try {
        await f(...args);
      } catch (err) {
        appendLogEntry(`Error: ${err}`);
      }
    };
  };

  const [newFtDecimals, setNewFtDecimals] = useState(0);
  const [newFtDescription, setNewFtDescription] = useState('');
  const [queryAssetsSelector, setQueryAssetsSelector] = useState<IdSelector | undefined>();
  const [queryAccountId, setQueryAccountId] = useState(0);
  const [queryAccountsSelector, setQueryAccountsSelector] = useState<IdSelector | undefined>();
  const [queryVirtualsSelector, setQueryVirtualsSelector] = useState<IdSelector | undefined>();
  const [remotePrincipal, setRemotePrincipal] = useState<string>('');
  const [aggregatorPrincipal, setAggregatorPrincipal] = useState<string>('');
  const [aggregatorPrincipalAutoDetect, setAggregatorPrincipalAutoDetect] = useState<boolean>(true);
  const [queryGlobalId0, setQueryGlobalId0] = useState(0);
  const [queryGlobalId1, setQueryGlobalId1] = useState(0);
  const [queryLedgerTxSelector, setQueryLedgerTxSelector] = useState<[bigint, bigint][] | undefined>();
  const [queryStreamsSelector, setQueryStreamsSelector] = useState<IdSelector | undefined>();

  const onQueryAggregatorsClicked = async () => {
    const result = await client.ledger.aggregators();
    appendLogEntry(`Aggregators list:`);
    for (const entry of result) {
      appendLogEntry(`principal: ${entry.principal.toText()}; priority weight: ${entry.priority}`);
    }
  };

  const onCreateAssetClicked = async () => {
    appendLogEntry(`Creating FT (args: ${newFtDecimals}, ${newFtDescription}) .....`);
    const assetId = await client.ledger.createFungibleToken(newFtDecimals, newFtDescription);
    appendLogEntry(`FT created. ID: ${assetId}`);
  };

  const onQueryAssetClicked = async () => {
    if (!queryAssetsSelector) {
      return;
    }
    const data = await client.ledger.ftInfo(queryAssetsSelector);
    appendLogEntry(`Assets info:`);
    for (const [id, info] of data) {
      appendLogEntry(`${id}:
          controller: ${info.controller.toText()};
          decimals: ${info.decimals};
          description: ${info.description}`);
    }
  };

  const onQueryAssetSupplyClicked = async () => {
    if (!queryAssetsSelector) {
      return;
    }
    const data = (await client.ledger.state({ ftSupplies: queryAssetsSelector })).ftSupplies;
    appendLogEntry(`Assets supply:`);
    for (const [id, supply] of data) {
      appendLogEntry(`${id}: ${supply}`);
    }
  };

  const onQuerySubaccountStateClicked = async (name: string, delegate: LedgerDelegate | LedgerAdminDelegate) => {
    if (!queryAccountsSelector) {
      return;
    }
    const data = (await delegate.state({ accounts: queryAccountsSelector })).accounts;
    appendLogEntry(`${name} subaccounts state:`);
    for (const [id, state] of data) {
      appendLogEntry(`${id}: type: ${state.type}, balance: ${state.balance}`);
    }
  };

  const onQuerySubaccountInfoClicked = async (name: string, delegate: LedgerDelegate | LedgerAdminDelegate) => {
    if (!queryAccountsSelector) {
      return;
    }
    const data = await delegate.accountInfo(queryAccountsSelector);
    appendLogEntry(`${name} subaccounts info:`);
    for (const [id, info] of data) {
      appendLogEntry(`${id}: type: ${info.type}, asset id: ${info.assetId}`);
    }
  };

  const onQueryVirtualAccountStateClicked = async () => {
    if (!queryVirtualsSelector) {
      return;
    }
    const res = (await client.ledger.state({ virtualAccounts: queryVirtualsSelector })).virtualAccounts;
    appendLogEntry(`Virtual accounts state:`);
    for (const [id, data] of res) {
      if (data) {
        appendLogEntry(`${id}: type: ${data.state.type}, balance: ${data.state.balance}, backing subaccount: ${data.backingSubaccountId}, expiration: ${data.expiration}`);
      } else {
        appendLogEntry(`${id}: null`);
      }
    }
  };

  const onQueryVirtualAccountInfoClicked = async () => {
    if (!queryVirtualsSelector) {
      return;
    }
    const data = await client.ledger.virtualAccountInfo(queryVirtualsSelector);
    appendLogEntry(`Virtual accounts info:`);
    for (const [id, info] of data) {
      if (info) {
        appendLogEntry(`${id}: type: ${info.type}, asset id: ${info.assetId}, access principal: ${info.accessPrincipal.toText()}`);
      } else {
        appendLogEntry(`${id}: null`);
      }
    }
  };

  const onQueryRemoteVirtualAccountStateClicked = async () => {
    const data = (await client.ledger.state({ remoteAccounts: { id: [Principal.fromText(remotePrincipal), BigInt(queryAccountId)] } })).remoteAccounts[0][1];
    if (data) {
      appendLogEntry(`Remote Virtual Account state (account holder: ${remotePrincipal}, account id: ${queryAccountId}): type: ${data.state.type}, balance: ${data.state.balance}, expiration: ${data.expiration}`);
    } else {
      appendLogEntry(`Remote Virtual Account state (account holder: ${remotePrincipal}, account id: ${queryAccountId}): deleted`);
    }
  };

  const onDeleteVirtualAccountClicked = async () => {
    appendLogEntry(`Deleting virtual account with id ${BigInt(queryAccountId)} .....`);
    const result = await client.ledger.deleteVirtualAccount(BigInt(queryAccountId));
    appendLogEntry(`Virtual account with id ${queryAccountId} deleted successfully, last seen balance: ${result.balance}`);
  };

  const onQueryTxAggregatorClicked = async () => {
    let aggregator!: AggregatorDelegate;
    if (aggregatorPrincipalAutoDetect) {
      let p = await client.ledger.aggregatorPrincipal(BigInt(queryGlobalId0));
      appendLogEntry('Auto-detected aggregator principal: ' + p.toText());
      aggregator = await client.createAggregatorDelegate(p);
    } else {
      aggregator = await client.createAggregatorDelegate(aggregatorPrincipal);
    }
    const status = await aggregator.singleTxStatus([BigInt(queryGlobalId0), BigInt(queryGlobalId1)]);
    const statusMsg = JSON.stringify(status, bigIntReplacer);
    appendLogEntry(`Tx status on aggregator (gid = [${queryGlobalId0}, ${queryGlobalId1}], aggregator principal = ${aggregatorPrincipal}): ${statusMsg}`);
  };

  const onQueryTxLedgerClicked = async () => {
    if (!queryLedgerTxSelector) {
      return;
    }
    const data = await client.ledger.txStatus(queryLedgerTxSelector);
    appendLogEntry(`Tx statuses on the ledger:`);
    for (const [id, status] of zip(queryLedgerTxSelector, data)) {
      const statusMsg = JSON.stringify(status, bigIntReplacer);
      appendLogEntry(`[${id}]: ${statusMsg}`);
    }
  };

  const onPickupTxClicked = async (localId: number, historyEntry: TxHistoryEntry) => {
    await runOrPickupSimpleTransfer(
        localId,
        historyEntry.txArgs,
        client,
        appendLogEntry,
        historyEntry.aggregatorPrincipal,
        historyEntry.submitRequestId,
        historyEntry.txId && [BigInt(historyEntry.txId[0]), BigInt(historyEntry.txId[1])],
    );
    loadUnfinishedTxsFromLocalStorage();
  };

  const onDeleteTxClicked = (localId: number) => {
    localStorage.removeItem(TX_HISTORY_KEY + localId);
    setSelectedNavItem(selectedNavItem - 1);
    appendLogEntry(`Tx ${localId} removed from local storage`);
    loadUnfinishedTxsFromLocalStorage();
  };

  const onQueryAggregatorStreamStatusClicked = async () => {
    const agg = await client.createAggregatorDelegate(aggregatorPrincipal);
    const statuses = await agg.streamStatus();
    appendLogEntry(`Stream stats of aggregator ${aggregatorPrincipal}:`);
    for (const status of statuses) {
      appendLogEntry(`id: ${status.id}; sent: ${status.sent}; received: ${status.received}; length: ${status.length};`);
    }
  };

  const onQueryLedgerStreamsClicked = async () => {
    if (!queryStreamsSelector) {
      return;
    }
    const statuses = await client.ledger.streamStatus(queryStreamsSelector);
    appendLogEntry(`Stream stats on ledger:`);
    for (const [id, status] of statuses) {
      appendLogEntry(`${id}: closed: ${status.closed}; source: ${status.source.type}${status.source.type === 'aggregator' ? ' (' + status.source.principal.toText() + ')' : ''}; length: ${status.length}; lastActive: ${status.lastActive}`);
    }
  };

  const navOptions: NavOption[] = [
    { label: 'Aggregators' },
    {
      label: 'list all',
      component: (
          <div className='query-input'>
            <button onClick={wrapCall(onQueryAggregatorsClicked)}>Query</button>
          </div>
      ),
    },
    {
      label: 'query stream status',
      component: (
          <div className='query-input'>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span><b>Aggregator principal:</b></span>
              <input type='text' placeholder='Aggregator principal' value={aggregatorPrincipal}
                     onChange={(event) => {
                       setAggregatorPrincipal(event.target.value);
                     }} />
            </div>
            <button onClick={wrapCall(onQueryAggregatorStreamStatusClicked)}>Query</button>
          </div>
      ),
    },
    'divider',
    { label: 'Fungible Tokens' },
    {
      label: 'create',
      component: (
          <div className='query-input'>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span><b>Decimals:</b></span>
              <input type='number' placeholder='Decimals' value={newFtDecimals}
                     onChange={(event) => setNewFtDecimals(Number(event.target.value))} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span><b>Description:</b></span>
              <input placeholder='Description' value={newFtDescription}
                     onChange={(event) => setNewFtDescription(event.target.value)} />
            </div>
            <button onClick={wrapCall(onCreateAssetClicked)}>Register FT Asset</button>
          </div>
      ),
    },
    {
      label: 'total number',
      component: (
          <div className='query-input'>
            <button onClick={wrapCall(async () =>
                appendLogEntry(`Total number of fungible tokens: ${await client.ledger.nFtAssets()}`))
            }>Query
            </button>
          </div>
      ),
    },
    {
      label: 'query',
      component: (
          <div className='query-input'>
            <IdSelectorInput value={queryAssetsSelector} onOutputChange={setQueryAssetsSelector} />
            <button onClick={wrapCall(onQueryAssetSupplyClicked)}>Query Supply</button>
            <button onClick={wrapCall(onQueryAssetClicked)}>Query Info</button>
          </div>
      ),
    },
    'divider',
    { label: 'Accounts' },
    {
      label: 'open',
      component: <OpenSubaccount client={client} onLogEntry={appendLogEntry} />,
    },
    {
      label: 'total number',
      component: (
          <div className='query-input'>
            <button onClick={wrapCall(async () =>
                appendLogEntry(`Total number of my subaccounts: ${await client.ledger.nAccounts()}`))
            }>Query
            </button>
          </div>
      ),
    },
    {
      label: 'query',
      component: (
          <div className='query-input'>
            <IdSelectorInput value={queryAccountsSelector} onOutputChange={setQueryAccountsSelector} />
            <button onClick={() => wrapCall(onQuerySubaccountStateClicked)('My ', client.ledger)}>Query State</button>
            <button onClick={() => wrapCall(onQuerySubaccountInfoClicked)('My ', client.ledger)}>Query Info</button>
          </div>
      ),
    },
    'divider',
    { label: 'Virtual accounts' },
    {
      label: 'open',
      component: <OpenVirtualAccount client={client} onLogEntry={appendLogEntry} />,
    },
    {
      label: 'update',
      component: <UpdateVirtualAccount client={client} onLogEntry={appendLogEntry} />,
    },
    {
      label: 'delete',
      component: (
          <div className='query-input'>
            <input type='number' placeholder='Virtual Account ID' value={queryAccountId}
                   onChange={(event) => {
                     setQueryAccountId(Number(event.target.value));
                   }} />
            <button onClick={wrapCall(onDeleteVirtualAccountClicked)}>Delete</button>
          </div>
      ),
    },
    {
      label: 'total number',
      component: (
          <div className='query-input'>
            <button
                onClick={wrapCall(async () => appendLogEntry(`Virtual Accounts amount: ${await client.ledger.nVirtualAccounts()}`))}>Query
            </button>
          </div>
      ),
    },
    {
      label: 'query',
      component: (
          <div className='query-input'>
            <IdSelectorInput value={queryVirtualsSelector} onOutputChange={setQueryVirtualsSelector} />
            <button onClick={wrapCall(onQueryVirtualAccountStateClicked)}>Query State</button>
            <button onClick={wrapCall(onQueryVirtualAccountInfoClicked)}>Query Info</button>
          </div>
      ),
    },
    'divider',
    { label: 'Remote accounts' },
    {
      label: 'query',
      component: (
          <div className='query-input'>
            <input type='text' placeholder='Owner principal' value={remotePrincipal}
                   onChange={(event) => {
                     setRemotePrincipal(event.target.value);
                   }} />
            <input type='number' placeholder='Account ID' value={queryAccountId}
                   onChange={(event) => {
                     setQueryAccountId(Number(event.target.value));
                   }} />
            <button onClick={wrapCall(onQueryRemoteVirtualAccountStateClicked)}>Query</button>
          </div>
      ),
    },
    'divider',
    { label: 'Ledger state' },
    {
      label: 'atomic multi-query',
      component: <MultiQuery client={client} onLogEntry={appendLogEntry} />,
    },
    'divider',
    { label: 'Admin accounts' },
    {
      label: 'total number',
      component: (
          <div className='query-input'>
            <button onClick={async () => {
              try {
                appendLogEntry(`Total number of admin subaccounts: ${await client.admin.nAccounts()}`);
              } catch (err) {
                appendLogEntry(`Error: ${err}`);
              }
            }}>Query
            </button>
          </div>
      ),
    },
    {
      label: 'query',
      component: (
          <div className='query-input'>
            <IdSelectorInput value={queryAccountsSelector} onOutputChange={setQueryAccountsSelector} />
            <button onClick={() => wrapCall(onQuerySubaccountStateClicked)('Ledger ', client.admin)}>Query State</button>
            <button onClick={() => wrapCall(onQuerySubaccountInfoClicked)('Ledger ', client.admin)}>Query Info</button>
          </div>
      ),
    },
    'divider',
    { label: 'Streams' },
    {
      label: 'total number',
      component: (
          <div className='query-input'>
            <button onClick={async () => {
              try {
                appendLogEntry(`Total number of streams: ${await client.ledger.nStreams()}`);
              } catch (err) {
                appendLogEntry(`Error: ${err}`);
              }
            }}>Query
            </button>
          </div>
      ),
    },
    {
      label: 'query',
      component: (
          <div className='query-input'>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span><b>Stream id-s:</b></span>
              <IdSelectorInput value={queryStreamsSelector} onOutputChange={setQueryStreamsSelector} />
            </div>
            <button onClick={wrapCall(onQueryLedgerStreamsClicked)}>Query</button>
          </div>
      ),
    },
    'divider',
    { label: 'Transactions' },
    {
      label: 'make transfer',
      component: <SimpleTransfer client={client} onLogEntry={appendLogEntry} />,
    },
    {
      label: 'query aggregator',
      component: (
          <div className='query-input'>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span><b>Aggregator principal:</b></span>
              <div>
                <input type='checkbox' id='autoDetectAggregatorCheckbox' checked={aggregatorPrincipalAutoDetect}
                       onClick={() => setAggregatorPrincipalAutoDetect(!aggregatorPrincipalAutoDetect)} />
                <label htmlFor='autoDetectAggregatorCheckbox'>Auto-detect</label>
              </div>
              {!aggregatorPrincipalAutoDetect &&
                  <input type='text' placeholder='Aggregator principal' value={aggregatorPrincipal}
                         onChange={(event) => {
                           setAggregatorPrincipal(event.target.value);
                         }} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span><b>Global id (0):</b></span>
              <input type='number' placeholder='Global id (0)' value={queryGlobalId0}
                     onChange={(event) => {
                       setQueryGlobalId0(Number(event.target.value));
                     }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span><b>Global id (1):</b></span>
              <input type='number' placeholder='Global id (1)' value={queryGlobalId1}
                     onChange={(event) => {
                       setQueryGlobalId1(Number(event.target.value));
                     }} />
            </div>
            <button onClick={wrapCall(onQueryTxAggregatorClicked)}>Query</button>
          </div>
      ),
    },
    {
      label: 'query ledger',
      component: (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1em' }}>
            <GidSelectorInput onOutputChange={setQueryLedgerTxSelector} />
            <button onClick={wrapCall(onQueryTxLedgerClicked)}>Query</button>
          </div>
      ),
    },
    ...(localStorageUnfinishedItems.length > 0 ? ['divider' as any, { label: 'Local journal' }] : []),
    ...localStorageUnfinishedItems.map(([k, v]) => ({
      label: `Pickup "${v.lastSeenStatus}" TX (${k})`,
      component: (
          <div
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1rem', rowGap: '1rem' }}>
            <h3>Last seen status object:</h3>
            <span style={{
              wordBreak: 'normal',
              textAlign: 'left',
              whiteSpace: 'break-spaces',
            }}>{JSON.stringify(v, bigIntReplacer, '\t')}</span>
            <button
                onClick={() => onPickupTxClicked(k, v)}>{v.lastSeenStatus === 'pickAggregator' ? 'Re-submit' : 'Poll result'}</button>
            <button onClick={() => onDeleteTxClicked(k)}>Delete from storage</button>
          </div>
      ),
    })),
  ];

  const handleLogin = async () => {
    const authClient = await AuthClient.create();
    try {
      await new Promise<void>((resolve, reject) => {
        authClient.login({
          onSuccess: () => {
            resolve();
          },
          onError: (error) => {
            reject(error);
          },
        });
      });
    } catch (err) {
      console.error(err);
      return;
    }
    setIdentity(authClient.getIdentity());
    setIsLoggedIn(true);
  };

  const handleLogout = async () => {
    setIdentity(new AnonymousIdentity());
    setIsLoggedIn(false);
  };

  const onSeedInput = async (seed: string) => {
    const seedToIdentity: (seed: string) => Identity | null = seed => {
      const seedBuf = new Uint8Array(new ArrayBuffer(32));
      if (seed.length && seed.length > 0 && seed.length <= 32) {
        seedBuf.set(new TextEncoder().encode(seed));
        return Ed25519KeyIdentity.generate(seedBuf);
      }
      return null;
    };
    let newIdentity = seedToIdentity(seed);
    if (!newIdentity) {
      if (!isLoggedIn) {
        newIdentity = new AnonymousIdentity();
      } else {
        return;
      }
    }
    if (identity.getPrincipal().toText() !== newIdentity.getPrincipal().toText()) {
      setIdentity(newIdentity);
      setIsLoggedIn(false);
    }
  };

  const handleNavItemClick = (index: number) => {
    setSelectedNavItem(index);
  };

  const renderComponent = (): JSX.Element | undefined => {
    if (!(navOptions[selectedNavItem] as any)?.component) {
      let index = selectedNavItem - 1;
      while (!(navOptions[index] as any)?.component && index > 1) {
        index--;
      }
      setSelectedNavItem(index);
      return (navOptions[index] as any).component;
    }
    return (navOptions[selectedNavItem] as any).component;
  };

  useEffect(() => {
    if (logContainerRef.current) {
      const logContainer = logContainerRef.current;
      logContainer.scrollTop = logContainerRef.current.scrollHeight;
      logContainer.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
    }
  }, [log]);

  const handleLedgerPrincipalInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLedgerPrincipalInput(event.target.value);
    if (client && client.ledgerPrincipal.toString() === event.target.value) {
      return;
    }
    try {
      Principal.fromText(event.target.value);
      setLedgerPrincipal(event.target.value);
      appendLogEntry(`Ledger principal: ${event.target.value}`);
    } catch (err) {
      // pass
    }
  };

  const clearLog = () => {
    setLog([]);
  };

  return (
      <div className='App'>
        <div className='navigation-panel'>
          <ul>
            {navOptions.map((option, index) => (
                option === 'divider'
                    ? <div key={index} className='divider' />
                    : (!!option.component ? <li
                        key={index}
                        className={selectedNavItem === index ? 'active' : ''}
                        onClick={() => handleNavItemClick(index)}
                    >
                      {option.label}
                    </li> : <h3 key={index}>{option.label}</h3>)
            ))}
          </ul>
        </div>
        <div className='right-component'>
          <div className='input-container'>
            <h3>Ledger principal: </h3>
            <input type='text' value={ledgerPrincipalInput} onChange={handleLedgerPrincipalInputChange} />
          </div>
          <div
              style={{ display: 'flex', flexDirection: 'column', rowGap: '1rem', padding: '1rem', alignItems: 'stretch' }}>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between' }}>
              <span>II login:</span>
              {isLoggedIn ? (
                  <button onClick={handleLogout}>Logout</button>
              ) : (
                  <button onClick={handleLogin}>Log In with Internet Identity</button>
              )}
            </div>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between' }}>
              <span>Seed principal:</span>
              <input type='text' onChange={(e) => onSeedInput(e.target.value)} />
            </div>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between' }}>
              <span><b>Me: {identity.getPrincipal().toText()}</b></span>
              <button onClick={() => copyToClipboard(identity.getPrincipal().toText())}>Copy</button>
            </div>
          </div>
          {renderComponent()}
          <div className='divider' />
          <div className='log-component'>
            <div className='log-header'>
              <h3>LOG</h3>
              <button onClick={clearLog}>Clear</button>
            </div>
            <div ref={logContainerRef} style={{ display: 'flex', flexDirection: 'column', alignSelf: 'center' }}>
              {log.map((result, index) => (
                  <span key={index} style={{ color: result.startsWith('Error: ') ? 'red' : 'black' }}>
                {result}
              </span>
              ))}
            </div>
          </div>
        </div>
      </div>
  );
};

export default App;
