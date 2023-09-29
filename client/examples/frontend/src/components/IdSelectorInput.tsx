import React, { useEffect, useState } from 'react';

type Range = [number, number | null];

type IdSubSelector =
  | { id: bigint }
  | { idRange: [bigint, [] | [bigint]] };

export type IdSelector =
  | IdSubSelector
  | { cat: IdSubSelector[]; };

const transformSubrange = (range: number | [number, number | null]): IdSubSelector => {
  if (range instanceof Array) {
    return { idRange: [BigInt(range[0]), range[1] === null ? [] : [BigInt(range[1])]] };
  }
  return { id: BigInt(range) };
};

const transformRange = (ranges: (number | [number, number | null])[]): IdSelector | undefined => {
  if (ranges.length === 0) return undefined;
  if (ranges.length === 1) return transformSubrange(ranges[0]);
  return { cat: ranges.map(transformSubrange) };
};

interface Props {
  onOutputChange: (output: IdSelector | undefined) => void;
  value: IdSelector | undefined;
}

function IdSelectorInput({ onOutputChange, value }: Props) {

  const stringifySelector: (s: IdSelector) => string = (selector: IdSelector) => {
    if ((selector as any).id !== undefined) {
      return '' + Number((selector as { id: bigint }).id);
    }
    if ((selector as any).idRange !== undefined) {
      const range = (selector as any).idRange as [bigint, [] | [bigint]];
      let res = '' + Number(range[0]) + '-';
      if (range[1].length > 0) {
        res += Number(range[1][0]);
      }
      return res;
    }
    if ((selector as any).cat !== undefined) {
      return ((selector as any).cat as IdSubSelector[]).map(x => stringifySelector(x)).join(',');
    }
    throw new Error(`Cannot stringify range "${selector}"`);
  };

  const initialValue: string = value ? stringifySelector(value) : '';
  const [inputText, setInputText] = useState(initialValue);

  useEffect(() => {
    setInputText(initialValue);
  }, [initialValue]);

  const parseInput = (text: string): (number | Range)[] => {
    const parts = text.split(',');
    const parsedList: (number | Range)[] = [];

    for (let part of parts) {
      part = part.trim();
      if (part === '') continue;

      if (part.includes('-')) {
        const range: Range = part.split('-').map((num) => (num === '' ? null : Number(num))) as Range;
        if (range.length === 2) {
          parsedList.push([range[0] || 0, range[1]]);
        }
      } else if (!isNaN(Number(part))) {
        parsedList.push(Number(part));
      }
    }

    return parsedList;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitizedText = e.target.value.replace(/[^0-9,-]|-{2,}/g, (match) => (match === '--' ? '-' : ''));
    setInputText(sanitizedText);

    if (sanitizedText === '') {
      onOutputChange(undefined);
    } else {
      const parsedOutput = parseInput(sanitizedText);
      onOutputChange(transformRange(parsedOutput));
    }
  };

  return (
    <input
      type='text'
      value={inputText}
      onChange={handleInputChange}
      placeholder='1,3,5-7'
    />
  );
}

export default IdSelectorInput;
