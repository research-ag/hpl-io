import { Certificate, LookupStatus } from '@dfinity/agent/lib/cjs/certificate';
import { decodeTime } from '@dfinity/agent/lib/cjs/utils/leb';
import { bufFromBufLike } from '@dfinity/agent/lib/cjs/utils/buffer';

export const getCanisterTimestamp = (certificate: Certificate): number => {
  const timeLookup = certificate.lookup(['time']);
  if (timeLookup.status !== LookupStatus.Found) {
    throw new Error('Time was not found in the response or was not in its expected format.');
  }
  if (!(timeLookup.value instanceof ArrayBuffer) && !ArrayBuffer.isView(timeLookup)) {
    throw new Error('Time was not found in the response or was not in its expected format.');
  }
  const date = decodeTime(bufFromBufLike(timeLookup.value as any));
  return Number(date);
};
