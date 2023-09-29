import React, { useState } from 'react';

interface Props {
  onOutputChange: (output: [bigint, bigint][]) => void;
}

function GidSelectorInput({ onOutputChange }: Props) {

  const [inputValues, setInputValues] = useState<[number, number][]>([]);

  const compileGidSelector = (value: [number, number][]) => {
    return value.map(([a, b]) => [BigInt(a), BigInt(b)]) as [bigint, bigint][];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1em' }}>
      {inputValues.map((tuple, index) => (
        <div key={index}
             style={{ display: 'flex', alignItems: 'flex-end', marginBottom: '0.5rem', columnGap: '0.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {(index === 0) && <span><b>Global id (0):</b></span>}
            <input
              type='number'
              value={tuple[0]}
              onChange={(e) => {
                const updatedValues = [...inputValues];
                updatedValues[index][0] = Number(e.target.value);
                setInputValues(updatedValues);
                onOutputChange(compileGidSelector(updatedValues));
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {(index === 0) && <span><b>Global id (1):</b></span>}
            <input
              type='number'
              value={tuple[1]}
              onChange={(e) => {
                const updatedValues = [...inputValues];
                updatedValues[index][1] = Number(e.target.value);
                setInputValues(updatedValues);
                onOutputChange(compileGidSelector(updatedValues));
              }}
            />
          </div>
          <button onClick={() => {
            const updatedValues = inputValues.filter((_, i) => i !== index);
            setInputValues(updatedValues);
            onOutputChange(compileGidSelector(updatedValues));
          }}>-
          </button>
        </div>
      ))}
      <button onClick={() => {
        const updatedValues: [number, number][] = [...inputValues, [0, 0]];
        setInputValues(updatedValues);
        onOutputChange(compileGidSelector(updatedValues));
      }}>+
      </button>
    </div>
  );
}

export default GidSelectorInput;
