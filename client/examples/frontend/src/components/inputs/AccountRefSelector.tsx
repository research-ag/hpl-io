import React, { useState } from 'react';
import { OwnersDelegate, TransferAccountReference } from '@research-ag/hpl-client';
import VirtualAccountInput from './VirtualAccountInput';

export type AccountType = 'sub' | 'vir' | 'mint';

interface AccountRefSelectorProps {
  owners: () => Promise<OwnersDelegate>;
  onChange: (ref: TransferAccountReference) => void;
}

const AccountRefSelector: React.FC<AccountRefSelectorProps> = ({ owners, onChange }) => {
  const [accountType, setAccountType] = useState<AccountType>('mint');
  const [accountId, setAccountId] = useState(0);
  const [accountOwner, setAccountOwner] = useState('');

  const handleAccountTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setAccountType(event.target.value as AccountType);
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
  }, [accountType, accountId, accountOwner]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <select value={accountType} onChange={handleAccountTypeChange}>
        <option value="sub">Sub account</option>
        <option value="vir">Virtual account</option>
        <option value="mint">Mint</option>
      </select>
      {accountType === 'sub' && (
        <div>
          <input
            type="number"
            placeholder="Account ID"
            value={accountId}
            onChange={event => setAccountId(Number(event.target.value))}
          />
        </div>
      )}
      {accountType === 'vir' && (
        <VirtualAccountInput
          owners={owners}
          value={{ owner: accountOwner, id: accountId }}
          onChange={({ owner, id }) => {
            setAccountId(id);
            setAccountOwner(owner);
          }}
        />
      )}
    </div>
  );
};

export default AccountRefSelector;
