import { unpackVariant } from './utils/unpack-variant.util';
import { bigIntReplacer } from './utils/json_bigints';
import { CallExtraData } from './utils/call-extra-data';

/** takes variant response #err(#SomeError(<payload>)) and transforms to readable text: "#SomeError: <payload json>"*/
export class HplError<T = any> extends Error {
  errorKey: 'SysFatal' | 'SysTransient' | 'DestinationInvalid' | 'CanisterError' | 'CanisterReject' | string;
  errorPayload: any;

  constructor(
    errObject: T,
    public readonly callExtra: CallExtraData,
  ) {
    const [key, payload] = unpackVariant(errObject);
    let errorStr = '#' + (key as string);
    if (payload !== null) {
      errorStr += ': ' + JSON.stringify(payload, bigIntReplacer);
    }
    super(errorStr);
    this.errorKey = key as string;
    this.errorPayload = payload;
  }

  isTrapped(): boolean {
    return this.errorKey == 'CanisterError';
  }

  isErrorRejectThrown(): boolean {
    return this.errorKey == 'CanisterReject';
  }

  toString(): string {
    return `#${this.errorKey}(${JSON.stringify(this.errorPayload, bigIntReplacer)})`;
  }
}
