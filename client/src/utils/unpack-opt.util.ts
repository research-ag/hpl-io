export const unpackOptResponse: <T>(call: Promise<[T] | []>) => Promise<T | null> = async call => {
  return unpackOpt(await call);
};

export const unpackOpt: <T>(value: [T] | []) => T | null = value => {
  return value.length > 0 ? value[0]! : null;
};
