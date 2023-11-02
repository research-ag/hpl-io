import React, { useState } from 'react';
import { HPLClient } from '@research-ag/hpl-client';
import { logTime } from '../utils';

interface OpenSubaccountProps {
  client: HPLClient;
  onLogEntry: (logEntry: string) => void; // Callback function to pass log entries to the parent component
}

const OpenSubaccount: React.FC<OpenSubaccountProps> = ({ client, onLogEntry }) => {
  const [assetId, setAssetId] = useState(0);
  const [amount, setAmount] = useState(0);

  const handleAssetIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setAssetId(Number(event.target.value));
  };

  const handleAmountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(Number(event.target.value));
  };

  const handleButtonClick = async () => {
    await logTime(onLogEntry, async () => {
      try {
        onLogEntry(`Opening subaccounts (args: { ft: ${BigInt(assetId) }}, ${amount}) .....`);
        const { first } = await client.ledger.openAccounts({ ft: BigInt(assetId) }, amount);
        onLogEntry(`Opened ${amount} subaccounts with consequent id-s, starting from ${first}`);
      } catch (err) {
        onLogEntry(`Error: ${err}`);
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', rowGap: '2rem', padding: '2rem' }}>
      <div style={{ display: 'flex', flexDirection: 'row', columnGap: '1rem', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Asset ID:</b></span>
          <input type='number' value={assetId} onChange={handleAssetIdChange} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Amount:</b></span>
          <input type='number' value={amount} onChange={handleAmountChange} />
        </div>
        <button onClick={handleButtonClick}>Send</button>
      </div>
    </div>
  );
};

export default OpenSubaccount;
