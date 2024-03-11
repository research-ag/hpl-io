type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

export const unpackVariant = <T>(
  variant: T,
): [keyof UnionToIntersection<T>, UnionToIntersection<T>[keyof UnionToIntersection<T>]] => {
  if (variant instanceof Array && variant.length == 1) {
    variant = variant[0];
  }
  const key = Object.keys(variant as any)[0] as keyof T;
  return [key, variant[key as keyof T]] as any;
};
