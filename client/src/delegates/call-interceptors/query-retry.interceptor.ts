import { sleep } from '../../utils/sleep.util';

const RETRY_DELAY = 100;
const MAX_ATTEMPTS = 5;

export type QueryRetryInterceptorErrorCallback =
  | ((response: { code: number; canisterError: string | null }, goingToRetry: boolean) => void)
  | null;

function getResponseCode(error: Error): [number, string | null] {
  let code = 500;
  let canisterError = null;
  const httpStatusLine = error.message
    .split('\n')
    .map(l => l.trim().toLowerCase())
    .find(l => l.startsWith('code:') || l.startsWith('http status code:'));
  const canisterErrorLine = error.message
    .split('\n')
    .map(l => l.trim())
    .find(l => l.startsWith('"Code": "'));
  if (httpStatusLine) {
    const parts = httpStatusLine.split(':');
    if (parts && parts.length > 1) {
      let valueText = parts[1].trim();
      const valueParts = valueText.split(' ');
      if (valueParts && valueParts.length > 1) {
        valueText = valueParts[0].trim();
      }
      code = parseInt(valueText, 10);
      if (isNaN(code)) {
        code = 500;
      }
    }
  }
  if (canisterErrorLine) {
    canisterError = canisterErrorLine.split('"')[3];
  }
  return [code, canisterError];
}

const _retryQueryInterceptor = async <T, Args extends Array<any>>(
  call: (...args: Args) => Promise<T>,
  attempt: number,
  args: Args,
  errorCallback: QueryRetryInterceptorErrorCallback,
): Promise<T> => {
  try {
    return await call(...args);
  } catch (err) {
    const [code, canisterError] = getResponseCode(err as Error);
    if (
      ![401, 403].includes(code) &&
      (!canisterError || !['CanisterReject', 'CanisterError'].includes(canisterError)) &&
      attempt < MAX_ATTEMPTS
    ) {
      if (errorCallback) {
        errorCallback({ code, canisterError }, true);
      }
      const delay = RETRY_DELAY * Math.pow(2, attempt);
      await sleep(delay);
      return _retryQueryInterceptor(call, attempt + 1, args, errorCallback);
    } else {
      if (errorCallback) {
        errorCallback({ code, canisterError }, false);
      }
      throw err;
    }
  }
};

export const retryQueryInterceptor =
  (errorCallback: QueryRetryInterceptorErrorCallback = null) =>
  async <T, Args extends Array<unknown>>(call: (...args: Args) => Promise<T>, ...args: Args) => {
    return _retryQueryInterceptor(call, 0, args, errorCallback);
  };
