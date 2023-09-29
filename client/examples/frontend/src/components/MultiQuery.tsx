import React, { useState } from 'react';
import { HPLClient } from '@research-ag/hpl-client';
import IdSelectorInput, { IdSelector } from './IdSelectorInput';
import TupleInput from './TupleInput';
import { Principal } from '@dfinity/principal';
import { bigIntPrincipalReplacer } from '../utils';

interface SimpleTransferProps {
  client: HPLClient;
  onLogEntry: (logEntry: string) => void; // Callback function to pass log entries to the parent component
}

const MultiQuery: React.FC<SimpleTransferProps> = ({ client, onLogEntry }) => {
  const [accounts, setAccounts] = useState<IdSelector | undefined>();
  const [virtualAccounts, setVirtualAccounts] = useState<IdSelector | undefined>();
  const [ftSupplies, setFtSupplies] = useState<IdSelector | undefined>();
  const [remoteAccounts, setRemoteAccounts] = useState<[string, number][]>([]);

  const handleButtonClick = async () => {
    try {
      const remoteConverted: [Principal, bigint][] = remoteAccounts.map(([p, n]) => [Principal.fromText(p), BigInt(n)]);
      const query = {
        accounts,
        virtualAccounts,
        ftSupplies,
        remoteAccounts: remoteConverted.length > 0
          ? (remoteConverted?.length > 1 ? { cat: remoteConverted.map(id => ({ id })) } : { id: remoteConverted[0] })
          : undefined,
      };
      onLogEntry('Calling multi-query with argument: ' + JSON.stringify(query, bigIntPrincipalReplacer));
      const result = await client.ledger.state(query);
      onLogEntry(JSON.stringify(result, bigIntPrincipalReplacer));
    } catch (err) {
      onLogEntry(`Error: ${err}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', rowGap: '2rem', padding: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'row', columnGap: '1rem', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Accounts:</b></span>
          <IdSelectorInput value={accounts} onOutputChange={setAccounts} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Virtual accounts:</b></span>
          <IdSelectorInput value={virtualAccounts} onOutputChange={setVirtualAccounts} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>FT supplies:</b></span>
          <IdSelectorInput value={ftSupplies} onOutputChange={setFtSupplies} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Remote virtual accounts:</b></span>
          <TupleInput onValuesChange={setRemoteAccounts} />
        </div>
        <button onClick={handleButtonClick}>Query</button>
      </div>
    </div>
  );
};

export default MultiQuery;
