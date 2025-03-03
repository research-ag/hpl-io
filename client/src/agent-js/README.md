This directory contains patches to some of the agent-js source code, used by hpl-io client library.
Files here are fully copied from https://github.com/dfinity/agent-js revision `2e9efe251f4ebe98e7d946259be3376eeef4fa65`.

## What's changed:

### http-agent.js
- **PATCH**: split `call` function into two parts: `call0` and `call1`. Use them sequentally in `call` function
- **PATCH**: added `prepareCall` function which executes `call0` and returns function which executes `call1`

### actor.ts
- **FIX**: fixed type `ActorMethodMappedExtended` to not produce `Promise<Promise<Ret>>` return type
- **FIX**: `decodeReturnValue` now uses `new Uint8Array(msg)` instead of `Buffer.from(msg)` because of wrong buffer used in test environment when using local actor.ts instead of baked into library. Problem with dependencies?
- **PATCH**: added `signatures` to `ActorMethodExtended` return type
- **PATCH**: exposed `signatures` in `_createActorMethod::query::replied` return value
- **PATCH**: put `certificate` in thrown `UpdateCallRejectedError` instance on update call rejection
- **PATCH**: added `prepare` function to `ActorMethod` and `ActorMethodExtended`
- **PATCH**: split `caller` func in `_createActorMethod` for update calls into `caller0` and `caller1`. Use them sequentally in `caller` function and separately for prepare call functionality
