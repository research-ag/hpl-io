import React, { useState } from 'react';
import { TransferAccountReference } from '@research-ag/hpl-client';

export type AccountType = 'sub' | 'vir' | 'mint';

interface AccountRefSelectorProps {
  onChange: (ref: TransferAccountReference) => void;
}

const AccountRefSelector: React.FC<AccountRefSelectorProps> = ({ onChange }) => {
  const [accountType, setAccountType] = useState<AccountType>('mint');
  const [accountId, setAccountId] = useState(0);
  const [accountOwner, setAccountOwner] = useState('');

  const handleAccountTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setAccountType(event.target.value as AccountType);
  };

  const handleAccountOwnerChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setAccountOwner(event.target.value);
  };

  const handleAccountIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setAccountId(Number(event.target.value));
  };

  React.useEffect(() => {
    let ref!: TransferAccountReference;
    switch (accountType) {
      case 'mint':
        ref = { type: 'mint' };
        break;
      case 'sub':
        ref = { type: 'sub', id: BigInt(accountId) };
        break;
      case 'vir':
        ref = { type: 'vir', owner: accountOwner, id: BigInt(accountId) };
        break;
    }
    onChange(ref);
  }, [accountType]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <select value={accountType} onChange={handleAccountTypeChange}>
        <option value="sub">Sub account</option>
        <option value="vir">Virtual account</option>
        <option value="mint">Mint</option>
      </select>
      {accountType === 'sub' && (
        <div>
          <input type="number" placeholder="Account ID" value={accountId} onChange={handleAccountIdChange} />
        </div>
      )}
      {accountType === 'vir' && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <input type="text" placeholder="Principal" value={accountOwner} onChange={handleAccountOwnerChange} />
          {/* Add validation of principal string here */}
          <input type="number" placeholder="Account ID" value={accountId} onChange={handleAccountIdChange} />
        </div>
      )}
    </div>
  );
};

export default AccountRefSelector;
