import React, { useState } from 'react';
import IdSelectorInput, { IdSelector } from './IdSelectorInput';
import { Principal } from '@dfinity/principal';
import { unpackVariant } from '../../utils';

interface Props {
  onOutputChange: (output: RemoteSelector) => void;
}

type RemoteSubSelector = { id: [Principal, bigint] } | { idRange: [Principal, bigint, [] | [bigint]] };

export type RemoteSelector = RemoteSubSelector | { cat: RemoteSubSelector[] };

const transformSingleSelector: (p: Principal, s: IdSelector) => RemoteSelector = (p, s) => {
  switch (unpackVariant(s)[0]) {
    case 'id':
      return { id: [p, (s as { id: bigint }).id] };
    case 'idRange':
      return { idRange: [p, ...(s as { idRange: [bigint, [] | [bigint]] }).idRange] };
    case 'cat':
      return { cat: (s as { cat: IdSelector[] }).cat.map(x => transformSingleSelector(p, x)) as RemoteSubSelector[] };
  }
};

const compileRaw: (input: [string, IdSelector | undefined][]) => RemoteSelector = input => {
  const filters = input.filter(([_, s]) => !!s) as [string, IdSelector][];
  if (filters.length === 1) {
    return transformSingleSelector(Principal.fromText(filters[0][0]), filters[0][1]);
  }
  let items: RemoteSubSelector[] = [];
  for (const f of filters.map(f => transformSingleSelector(Principal.fromText(f[0]), f[1]))) {
    if (unpackVariant(f)[0] === 'cat') {
      items = [...items, ...(f as { cat: RemoteSubSelector[] }).cat];
    } else {
      items.push(f as RemoteSubSelector);
    }
  }
  return { cat: items };
};

function RemoteAccountsSelectorInput({ onOutputChange }: Props) {
  const [inputValues, setInputValues] = useState<[string, IdSelector | undefined][]>([]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1em' }}>
      {inputValues.map((tuple, index) => (
        <div
          key={index}
          style={{ display: 'flex', alignItems: 'flex-end', marginBottom: '0.5rem', columnGap: '0.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {index === 0 && (
              <span>
                <b>Account holder:</b>
              </span>
            )}
            <input
              type="text"
              value={tuple[0]}
              onChange={e => {
                const updatedValues = [...inputValues];
                updatedValues[index][0] = e.target.value;
                setInputValues(updatedValues);
                onOutputChange(compileRaw(updatedValues));
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {index === 0 && (
              <span>
                <b>Account id:</b>
              </span>
            )}
            <IdSelectorInput
              value={tuple[1]}
              onOutputChange={selector => {
                const updatedValues = [...inputValues];
                updatedValues[index][1] = selector;
                setInputValues(updatedValues);
                onOutputChange(compileRaw(updatedValues));
              }}></IdSelectorInput>
          </div>
          <button
            onClick={() => {
              const updatedValues = inputValues.filter((_, i) => i !== index);
              setInputValues(updatedValues);
              onOutputChange(compileRaw(updatedValues));
            }}>
            -
          </button>
        </div>
      ))}
      <button
        onClick={() => {
          const updatedValues: [string, IdSelector | undefined][] = [...inputValues, ['', undefined]];
          setInputValues(updatedValues);
          onOutputChange(compileRaw(updatedValues));
        }}>
        +
      </button>
    </div>
  );
}

export default RemoteAccountsSelectorInput;
