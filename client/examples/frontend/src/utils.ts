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
};

export const copyToClipboard = (textToCopy: string) => {
  // Create a temporary input element to copy text to the clipboard
  const tempInput = document.createElement('input');
  tempInput.value = textToCopy;
  document.body.appendChild(tempInput);
  tempInput.select();
  document.execCommand('copy');
  document.body.removeChild(tempInput);
};

export const logTime = async <T>(logFunc: (s: string) => void, func: () => Promise<T>): Promise<T> => {
  const start = Date.now();
  const res = await func();
  logFunc(`Operation took ${(Date.now() - start) / 1000} seconds`);
  return res;
};

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
export const unpackVariant = <T>(
  variant: T,
): [keyof UnionToIntersection<T>, UnionToIntersection<T>[keyof UnionToIntersection<T>]] => {
  if (variant instanceof Array && variant.length === 1) {
    variant = variant[0];
  }
  const key = Object.keys(variant as any)[0] as keyof T;
  return [key, variant[key as keyof T]] as any;
};

export const packLinkCode = (ownerId: bigint, virId: bigint): string => {
  const ownerStr = ownerId.toString(16);
  const accountStr = virId.toString(16);
  const vidIdLenStr = (accountStr.length - 1).toString(16);
  if (vidIdLenStr.length != 1) {
    throw new Error(`Cannot craft link code for virtual account id ${vidIdLenStr}`);
  }
  return `${vidIdLenStr}${ownerStr}${accountStr}`;
};

export const unpackLinkCode = (linkCode: string): { ownerId: bigint, virId: bigint } => {
  const virIdLen = parseInt(linkCode.substring(0, 1), 16) + 1;
  const ownerId = BigInt(parseInt(linkCode.substring(1, linkCode.length - virIdLen), 16));
  const virId = BigInt(parseInt(linkCode.substring(linkCode.length - virIdLen), 16));
  if (packLinkCode(ownerId, virId) !== linkCode) {
    throw new Error(`Can not parse link code ${linkCode} correctly`);
  }
  return { ownerId, virId };
};
