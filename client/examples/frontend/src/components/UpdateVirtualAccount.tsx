import React, { useState } from 'react';
import { HPLClient } from '@research-ag/hpl-client';
import { logTime } from '../utils';

interface UpdateVirtualAccountProps {
  client: HPLClient;
  onLogEntry: (logEntry: string) => void; // Callback function to pass log entries to the parent component
}

const UpdateVirtualAccount: React.FC<UpdateVirtualAccountProps> = ({ client, onLogEntry }) => {
  const [vid, setVid] = useState(0);
  const [balanceChangeType, setBalanceChangeType] = useState<'none' | 'ft_set' | 'ft_dec' | 'ft_inc'>('none');
  const [balance, setBalance] = useState<number>(0);
  const [expiration, setExpiration] = useState<number | null>(null);
  const [backingAccount, setBackingAccount] = useState<number | null>(null);

  const handleVidChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setVid(Number(event.target.value));
  };

  const handleBalanceChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setBalance(Number(event.target.value));
  };

  const handleExpirationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setExpiration(Number(event.target.value));
  };

  const handleBackingAccountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setBackingAccount(event.target.value && !isNaN(+event.target.value) ? Number(event.target.value) : null);
  };

  const handleButtonClick = async () => {
    await logTime(onLogEntry, async () => {
      try {
        onLogEntry(`Updating virtual account (args: ${BigInt(vid)}, ${backingAccount}, ${expiration}, ${balanceChangeType === 'none' ? 'null' : balanceChangeType + ' ' + balance}) .....`);
        const result = (await client.ledger.updateVirtualAccount(
          BigInt(vid),
          {
            backingAccount: (backingAccount || backingAccount === 0) ? BigInt(backingAccount) : undefined,
            expiration: (expiration || expiration === 0) ? +expiration : undefined,
            state: balanceChangeType === 'none' ? undefined : { [balanceChangeType]: balance } as any,
          },
        ));
        onLogEntry(`Updated virtual account (id = ${vid}): type: ${result.type}, balance: ${result.balance}, balance delta: ${result.delta}`);
      } catch (err) {
        onLogEntry(`Error: ${err}`);
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', rowGap: '2rem', padding: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'row', columnGap: '1rem', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Virtual account ID:</b></span>
          <input type='number' value={vid} onChange={handleVidChange} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Backing account:</b></span>
          <input type='number' value={(backingAccount || backingAccount === 0) ? backingAccount : ''} onChange={handleBackingAccountChange} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Expiration in ms (0 for infinite):</b></span>
          <input type='number' value={expiration === null ? '' : expiration} onChange={handleExpirationChange} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span><b>Balance:</b></span>
          <select value={balanceChangeType} onChange={(event) => setBalanceChangeType(event.target.value as any)}>
            <option value="none">Do not change</option>
            <option value="ft_set">Set</option>
            <option value="ft_inc">Increment</option>
            <option value="ft_dec">Decrement</option>
          </select>
          { balanceChangeType !== 'none' && (
            <input type='number' value={balance === null ? '' : balance} onChange={handleBalanceChange} />
          )}
        </div>
        <button onClick={handleButtonClick}>Send</button>
      </div>
    </div>
  );
};

export default UpdateVirtualAccount;
