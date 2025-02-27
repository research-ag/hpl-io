import { LookupStatus } from '@dfinity/agent/lib/cjs/certificate';
import { decodeTime } from '@dfinity/agent/lib/cjs/utils/leb';
import { bufFromBufLike } from '@dfinity/agent/lib/cjs/utils/buffer';
import { ActorMethodExtendedReturnType } from "../delegates/delegate";

export const getCanisterTimestamp = (response: ActorMethodExtendedReturnType<unknown>): number => {
  if (response.certificate) {
    const timeLookup = response.certificate.lookup(['time']);
    if (timeLookup.status !== LookupStatus.Found) {
      throw new Error('Time was not found in the response or was not in its expected format.');
    }
    if (!(timeLookup.value instanceof ArrayBuffer) && !ArrayBuffer.isView(timeLookup)) {
      throw new Error('Time was not found in the response or was not in its expected format.');
    }
    const date = decodeTime(bufFromBufLike(timeLookup.value as any));
    return Number(date);
  } else if (response.signatures?.length) {
    return Number(response.signatures[0].timestamp) / 1_000_000;
  }
  return 0;
};
