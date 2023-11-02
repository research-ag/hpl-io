import React, { useState } from 'react';
import { HPLClient } from '@research-ag/hpl-client';
import { logTime } from '../utils';

interface OpenVirtualAccountProps {
  client: HPLClient;
  onLogEntry: (logEntry: string) => void; // Callback function to pass log entries to the parent component
}

const OpenVirtualAccount: React.FC<OpenVirtualAccountProps> = ({ client, onLogEntry }) => {
  const [assetId, setAssetId] = useState(0);
  const [balance, setBalance] = useState(0);
  const [accessPrincipal, setAccessPrincipal] = useState<string>('');
  const [expiration, setExpiration] = useState<number | null>(null);
  const [backingAccount, setBackingAccount] = useState(0);

  const handleAssetIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setAssetId(Number(event.target.value));
  };

  const handleBalanceChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setBalance(Number(event.target.value));
  };

  const handleAccessPrincipalChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setAccessPrincipal(event.target.value);
  };

  const handleExpirationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setExpiration(Number(event.target.value));
  };

  const handleBackingAccountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setBackingAccount(Number(event.target.value));
  };

  const handleButtonClick = async () => {
    await logTime(onLogEntry, async () => {
      try {
        onLogEntry(`Opening virtual account (account: ${BigInt(backingAccount)}, accessPrincipal: ${accessPrincipal}, asset id: ${assetId}, balance: ${balance}, ${expiration}) .....`);
        const id = (await client.ledger.openVirtualAccount(
          { type: 'ft', assetId: BigInt(assetId) },
          accessPrincipal,
          { type: 'ft', balance: BigInt(balance) },
          BigInt(backingAccount),
          expiration || undefined,
        )).id;
        onLogEntry(`Opened virtual account with ID ${id}`);
      } catch (err) {
        onLogEntry(`Error: ${err}`);
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', rowGap: '2rem', padding: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'row', columnGap: '1rem', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Asset ID:</b></span>
          <input type='number' value={assetId} onChange={handleAssetIdChange} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Balance:</b></span>
          <input type='number' value={balance} onChange={handleBalanceChange} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Access principal:</b></span>
          <input type='text' placeholder='Principal' value={accessPrincipal} onChange={handleAccessPrincipalChange} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Expiration in ms (0 for infinite):</b></span>
          <input type='number' value={expiration || 0} onChange={handleExpirationChange} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Backing account:</b></span>
          <input type='number' value={backingAccount} onChange={handleBackingAccountChange} />
        </div>
        <button onClick={handleButtonClick}>Send</button>
      </div>
    </div>
  );
};

export default OpenVirtualAccount;
