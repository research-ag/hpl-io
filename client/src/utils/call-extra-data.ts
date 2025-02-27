import { Certificate, LookupStatus } from '@dfinity/agent/lib/cjs/certificate';
import { NodeSignature } from '@dfinity/agent/lib/cjs/agent/api';
import { decodeTime } from '@dfinity/agent/lib/cjs/utils/leb';
import { bufFromBufLike } from '@dfinity/agent/lib/cjs/utils/buffer';

export type CallExtraData = {
  canisterTimestamp: number;
};

export const extractCallExtraData = (response: {
  certificate?: Certificate;
  signatures?: NodeSignature[];
}): CallExtraData => {
  const ret: CallExtraData = { canisterTimestamp: 0 };
  if (response.certificate) {
    const timeLookup = response.certificate.lookup(['time']);
    if (timeLookup.status !== LookupStatus.Found) {
      throw new Error('Time was not found in the response or was not in its expected format.');
    }
    if (!(timeLookup.value instanceof ArrayBuffer) && !ArrayBuffer.isView(timeLookup)) {
      throw new Error('Time was not found in the response or was not in its expected format.');
    }
    const date = decodeTime(bufFromBufLike(timeLookup.value as any));
    ret.canisterTimestamp = Number(date);
  } else if (response.signatures?.length) {
    ret.canisterTimestamp = Number(response.signatures[0].timestamp) / 1_000_000;
  }
  return ret;
};
