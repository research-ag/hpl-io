import React, { useState } from 'react';
import AccountRefSelector from './AccountRefSelector';
import { FeeMode, HPLClient, TransferAccountReference } from '@research-ag/hpl-client';
import { runOrPickupSimpleTransfer } from '../services/simple-transfer';
import { logTime } from '../utils';

interface SimpleTransferProps {
  client: HPLClient;
  onLogEntry: (logEntry: string) => void; // Callback function to pass log entries to the parent component
}

const SimpleTransfer: React.FC<SimpleTransferProps> = ({ client, onLogEntry }) => {
  const [from, setFrom] = useState<TransferAccountReference>({ type: 'mint' });
  const [to, setTo] = useState<TransferAccountReference>({ type: 'mint' });
  const [assetId, setAssetId] = useState(0);
  const [amountVariant, setAmountVariant] = useState<'max' | 'amount'>('amount');
  const [feeModeVariant, setFeeModeVariant] = useState<FeeMode | undefined>(undefined);
  const [amount, setAmount] = useState(0);

  const handleFromChange = (ref: TransferAccountReference) => {
    setFrom(ref);
  };

  const handleToChange = (ref: TransferAccountReference) => {
    setTo(ref);
  };

  const handleAssetIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setAssetId(Number(event.target.value));
  };

  const handleAmountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(Number(event.target.value));
  };

  const handleAmountVariantChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setAmountVariant(event.target.value as ('max' | 'amount'));
  };

  const handleFeeModeVariantChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (event.target.value === 'auto') {
      setFeeModeVariant(undefined);
    } else {
      setFeeModeVariant(+event.target.value as FeeMode);
    }
  };

  const handleButtonClick = async () => {
    await logTime(onLogEntry, async () => {
      const localId = Date.now();
      await runOrPickupSimpleTransfer(localId, [from, to, BigInt(assetId), amountVariant === 'max' ? 'max' : BigInt(amount), feeModeVariant], client, onLogEntry);
    });
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      columnGap: '1rem',
      padding: '1rem',
      rowGap: '1rem',
      justifyContent: 'center',
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span><b>From:</b></span>
        <AccountRefSelector onChange={handleFromChange} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span><b>To:</b></span>
        <AccountRefSelector onChange={handleToChange} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span><b>Asset ID:</b></span>
        <input type='number' value={assetId} onChange={handleAssetIdChange} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span><b>Amount:</b></span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <select value={amountVariant} onChange={handleAmountVariantChange}>
            <option value='amount'>Amount</option>
            <option value='max'>Max</option>
          </select>
          {amountVariant === 'amount' && (
            <div>
              <input type='number' value={amount} onChange={handleAmountChange} />
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span><b>Fee mode:</b></span>
        <select value={feeModeVariant} onChange={handleFeeModeVariantChange}>
          <option value="auto">Auto-detect</option>
          <option value={FeeMode.SENDER_PAYS}>Sender pays</option>
          <option value={FeeMode.RECEIVER_PAYS}>Receiver pays</option>
        </select>
      </div>
      <button onClick={handleButtonClick}>Send</button>
    </div>
  );
};

export default SimpleTransfer;
