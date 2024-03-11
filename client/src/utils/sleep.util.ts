export const sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms));
