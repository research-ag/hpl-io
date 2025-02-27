This directory contains patches to some of the agent-js source code, used by hpl-io client library.
Files here are fully copied from https://github.com/dfinity/agent-js revision `2e9efe251f4ebe98e7d946259be3376eeef4fa65`.

## What's changed:

### actor.ts
- **FIX**: fixed type `ActorMethodMappedExtended` to not produce `Promise<Promise<Ret>>` return type
- **FIX**: `decodeReturnValue` now uses `new Uint8Array(msg)` instead of `Buffer.from(msg)` because of wrong buffer used in test environment when using local actor.ts instead of baked into library. Problem with dependencies?