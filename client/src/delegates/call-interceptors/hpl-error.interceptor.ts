import { HplError } from '../../hpl-error';
import { ReplicaRejectCode } from '@dfinity/agent';
import { extractCallExtraData } from '../../utils/call-extra-data';

export const hplErrorInterceptor = async <T, Args extends Array<unknown>>(
  call: (...args: Args) => Promise<T>,
  ...args: Args
) => {
  try {
    return await call(...args);
  } catch (err: any) {
    if (err.type === 'query') {
      throw new HplError({ [err.props.Code]: err.props.Message }, extractCallExtraData((err as any).result || {}));
    } else if (err.type === 'update') {
      throw new HplError(
        { [ReplicaRejectCode[err.reject_code]]: err.reject_message },
        extractCallExtraData(err as any),
      );
    }
    throw err;
  }
};
