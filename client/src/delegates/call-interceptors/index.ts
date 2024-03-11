export type CallInterceptor<T, Args extends Array<unknown>> = (
  call: (...args: Args) => Promise<T>,
  ...args: Args
) => Promise<T>;

export * from './hpl-error.interceptor';
export * from './query-retry.interceptor';
