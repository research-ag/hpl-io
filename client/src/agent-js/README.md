This directory contains patches to some of the agent-js source code, used by hpl-io client library.
Files here are fully copied from https://github.com/dfinity/agent-js
revision `2e9efe251f4ebe98e7d946259be3376eeef4fa65`.

## What's changed:

### http-agent.js

- **PATCH**: split `call` function into two parts: `call0` and `call1`. Use them sequentally in `call` function
- **PATCH**: added `prepareCall` function which executes `call0` and returns function which executes `call1`

### actor.ts

- **FIX**: fixed type `ActorMethodMappedExtended` to not produce `Promise<Promise<Ret>>` return type
- **FIX**: `decodeReturnValue` now uses `new Uint8Array(msg)` instead of `Buffer.from(msg)` because of wrong buffer used
  in test environment when using local actor.ts instead of baked into library. Problem with dependencies?
- **PATCH**: added `signatures` to `ActorMethodExtended` return type
- **PATCH**: exposed `signatures` in `_createActorMethod::query::replied` return value
- **PATCH**: put `certificate` in thrown `UpdateCallRejectedError` instance on update call rejection
- **PATCH**: split `caller` func in `_createActorMethod` for update calls into:
    - `caller__prepareOptions`: setup needed variables for a call, such as canister id, request id etc.
    - `caller__pollResponse`: poll response from the IC
    - `caller__renderResponse`: transform received response to actor method return value
    - `caller__handleAgentResponse`: everything that runs after getting initial response from the http agent.
      Incapsulates `caller__renderResponse` and `caller__pollResponse` (in case of 202 http status)

  Final **caller** function runs them sequentally:
    - `caller__prepareOptions`
    - http agent call
    - `caller__handleAgentResponse`

  New **lazyCaller** function runs:
    - `caller__prepareOptions`
    - return request id and function, which executes http agent call and `caller__handleAgentResponse`

  New **resultFetcher** runs:
    - `caller__prepareOptions`
    - `caller__pollResponse`
    - `caller__renderResponse`


- **PATCH**: added `prepare` and `fetchResponse` functions to `ActorMethod` and `ActorMethodExtended`
