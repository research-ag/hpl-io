import React, { useState } from 'react';
import { OwnersDelegate } from '@research-ag/hpl-client';
import { unpackLinkCode } from '../../utils';

export type VirtualAccountRef = { owner: string; id: number };

interface VirtualAccountInputProps {
  owners: () => Promise<OwnersDelegate>;
  value: VirtualAccountRef | undefined;
  requiredPrincipal?: string;
  onChange: (ref: VirtualAccountRef) => void;
}

const VirtualAccountInput: React.FC<VirtualAccountInputProps> = ({ owners, value, requiredPrincipal, onChange }) => {
  const [inputType, setInputType] = useState<'default' | 'linkCode'>('linkCode');

  const [accountOwner, setAccountOwner] = useState(requiredPrincipal || value?.owner || '');
  const [accountId, setAccountId] = useState(Number(value?.id) || 0);

  const [linkCode, setLinkCode] = useState<string>('');
  const [linkCodeLoading, setLinkCodeLoading] = useState<boolean>(false);
  const [linkCodeError, setLinkCodeError] = useState<boolean>(false);

  React.useEffect(() => {
    onChange({ owner: accountOwner, id: accountId });
  }, [accountOwner, accountId]);

  React.useEffect(() => {
    if (inputType == 'linkCode' && linkCode) {
      setLinkCodeLoading(true);
      owners().then(ownersCanister => {
        try {
          const { ownerId, virId } = unpackLinkCode(linkCode);
          ownersCanister
            .get(ownerId)
            .catch(e => Promise.resolve(null))
            .then(p => {
              if (p) {
                setAccountId(Number(virId));
                if (!requiredPrincipal || p.toText() == requiredPrincipal) {
                  setAccountOwner(p.toText());
                }
              }
              setLinkCodeError(!p || (!!requiredPrincipal && p.toText() != requiredPrincipal));
              setLinkCodeLoading(false);
            });
        } catch (err) {
          setLinkCodeError(true);
          setLinkCodeLoading(false);
        }
      });
    }
  }, [inputType, linkCode, requiredPrincipal]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <select value={inputType} onChange={e => setInputType(e.target.value as 'default' | 'linkCode')}>
        <option value="default">{requiredPrincipal === undefined ? 'Principal/AccountId' : 'AccountId'}</option>
        <option value="linkCode">Link code</option>
      </select>
      {inputType === 'default' && (
        <div style={{ display: 'contents' }}>
          {requiredPrincipal === undefined && (
            <input
              type="text"
              placeholder="Principal"
              value={accountOwner}
              onChange={event => setAccountOwner(event.target.value)}
            />
          )}
          <input
            type="number"
            placeholder="Account ID"
            value={accountId}
            onChange={event => setAccountId(Number(event.target.value))}
          />
        </div>
      )}
      {inputType === 'linkCode' && (
        <div style={{ display: 'flex', width: '200px' }}>
          <input
            type="text"
            placeholder="Link code"
            value={linkCode}
            style={{ width: '100%' }}
            className={linkCodeError ? 'errored-input' : ''}
            onChange={e => setLinkCode(e.target.value as string)}
          />
          {linkCodeLoading && <div className="lds-dual-ring"></div>}
        </div>
      )}
    </div>
  );
};

export default VirtualAccountInput;
