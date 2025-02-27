import { HplError } from '../../hpl-error';
import { ReplicaRejectCode } from '@dfinity/agent';
import { CallExtraData } from '../delegate';

export const hplErrorInterceptor = async <T, Args extends Array<unknown>>(
  call: (...args: Args) => Promise<T>,
  ...args: Args
) => {
  try {
    return await call(...args);
  } catch (err: any) {
    if (err.props?.Code) {
      // query error
      let message = err.props.Message;
      let trapMsgMatch = null;
      if (err.props.Code == 'CanisterError') {
        trapMsgMatch = /trapped explicitly:\s(.+)/gi.exec(message);
      }
      throw new HplError(
        { [err.props.Code]: trapMsgMatch ? trapMsgMatch[1] : message },
        (err as any as { callExtras: CallExtraData }).callExtras,
      );
    } else if (err.message.startsWith('Call was rejected:')) {
      // update error
      const match = /Reject\scode:\s(\d+)/gi.exec(err.message);
      if (match) {
        const errorCode = ReplicaRejectCode[+match[1]];
        let msgMatch = null;
        if (errorCode == 'CanisterError') {
          msgMatch = /trapped explicitly:\s(.+)/gi.exec(err.message);
        }
        if (!msgMatch) {
          msgMatch = /Reject text:\s(.+)/gi.exec(err.message);
        }
        throw new HplError(
          { [errorCode]: msgMatch ? msgMatch[1] : err.message },
          (err as any as { callExtras: CallExtraData }).callExtras,
        );
      }
    }
    throw err;
  }
};
