import { HplError } from '../hpl-error';

export const unpackRes: <Ok, Err>(call: Promise<{ ok?: Ok; err?: Err }>) => Promise<Ok> = async call => {
  const response = await call;
  if (!response.err) {
    return response.ok!;
  } else {
    throw new HplError(response.err);
  }
};
