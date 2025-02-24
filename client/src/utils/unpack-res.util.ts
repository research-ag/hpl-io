import { HplError } from '../hpl-error';
import { CallExtraData } from '../delegates/hpl-agent';

export const unpackRes: <Ok, Err>(
  call: Promise<[{ ok?: Ok; err?: Err }, CallExtraData]>,
) => Promise<Ok> = async call => {
  const [response, callExtras] = await call;
  if (!response.err) {
    return response.ok!;
  } else {
    throw new HplError(response.err, callExtras);
  }
};
