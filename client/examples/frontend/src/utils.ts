// Custom replacer function for JSON.stringify
import { Principal } from '@dfinity/principal';

export const bigIntPrincipalReplacer = (key: string, value: any): any => {
  if (typeof value === 'bigint') {
    return `${value.toString()}n`; // Serialize BigInts as strings with 'n' suffix
  }
  if (value instanceof Principal) {
    return value.toText();
  }
  return value;
};

export const zip: <T, K>(a: T[], b: K[]) => [T, K][] = (a, b) => {
  return Array(Math.max(a.length, b.length)).fill(null).map((_, i) => [a[i], b[i]]);
}
