import React, { useState } from 'react';

interface TupleInputProps {
  onValuesChange: (values: [string, number][]) => void;
}

const TupleInput: React.FC<TupleInputProps> = ({ onValuesChange }) => {
  const [inputValues, setInputValues] = useState<[string, number][]>([]);

  const handleTextChange = (index: number, text: string) => {
    const updatedValues = [...inputValues];
    updatedValues[index][0] = text;
    setInputValues(updatedValues);
    onValuesChange(updatedValues);
  };

  const handleNumberChange = (index: number, number: number) => {
    const updatedValues = [...inputValues];
    updatedValues[index][1] = number;
    setInputValues(updatedValues);
    onValuesChange(updatedValues);
  };

  const handleAddInput = () => {
    setInputValues([...inputValues, ['', 0]]);
    onValuesChange(inputValues);
  };

  const handleRemoveInput = (index: number) => {
    const updatedValues = inputValues.filter((_, i) => i !== index);
    setInputValues(updatedValues);
    onValuesChange(updatedValues);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {inputValues.map((tuple, index) => (
        <div
          key={index}
          style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem', columnGap: '0.25rem' }}>
          <input type="text" value={tuple[0]} onChange={e => handleTextChange(index, e.target.value)} />
          <input type="number" value={tuple[1]} onChange={e => handleNumberChange(index, parseFloat(e.target.value))} />
          <button onClick={() => handleRemoveInput(index)}>-</button>
        </div>
      ))}
      <button onClick={handleAddInput}>+</button>
    </div>
  );
};

export default TupleInput;
