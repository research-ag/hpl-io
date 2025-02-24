import {
  Agent,
  Certificate,
  CreateCertificateOptions,
  lookupResultToBuffer,
  RequestId,
  RequestStatusResponseStatus,
  toHex,
} from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { defaultStrategy, PollStrategy } from '@dfinity/agent/lib/cjs/polling';
import { lebDecode, PipeArrayBuffer } from '@dfinity/candid';
import { CallExtraData } from './hpl-actor';

// the same as regular pollForResponse function from @dfinity/agent, but adds canister timestamp to result object and error
export async function pollForResponseWithTimestamp(
  agent: Agent,
  canisterId: Principal,
  requestId: RequestId,
  strategy: PollStrategy = defaultStrategy(),
  // eslint-disable-next-line
  request?: any,
  blsVerify?: CreateCertificateOptions['blsVerify'],
): Promise<{
  certificate: Certificate;
  reply: ArrayBuffer;
  canisterTimestamp: bigint;
}> {
  const path = [new TextEncoder().encode('request_status'), requestId];
  const currentRequest = request ?? (await agent.createReadStateRequest?.({ paths: [path] }));

  const state = await agent.readState(canisterId, { paths: [path] }, undefined, currentRequest);
  if (agent.rootKey == null) throw new Error('Agent root key not initialized before polling');
  const cert = await Certificate.create({
    certificate: state.certificate,
    rootKey: agent.rootKey,
    canisterId: canisterId,
    blsVerify,
  });

  const maybeBuf = lookupResultToBuffer(cert.lookup([...path, new TextEncoder().encode('status')]));
  let status;
  if (typeof maybeBuf === 'undefined') {
    // Missing requestId means we need to wait
    status = RequestStatusResponseStatus.Unknown;
  } else {
    status = new TextDecoder().decode(maybeBuf);
  }

  switch (status) {
    case RequestStatusResponseStatus.Replied: {
      return {
        reply: lookupResultToBuffer(cert.lookup([...path, 'reply']))!,
        certificate: cert,
        canisterTimestamp: lebDecode(new PipeArrayBuffer(lookupResultToBuffer(cert.lookup(['time'])))),
      };
    }

    case RequestStatusResponseStatus.Received:
    case RequestStatusResponseStatus.Unknown:
    case RequestStatusResponseStatus.Processing:
      // Execute the polling strategy, then retry.
      await strategy(canisterId, requestId, status);
      return pollForResponseWithTimestamp(agent, canisterId, requestId, strategy, currentRequest, blsVerify);

    case RequestStatusResponseStatus.Rejected: {
      const rejectCode = new Uint8Array(lookupResultToBuffer(cert.lookup([...path, 'reject_code']))!)[0];
      const rejectMessage = new TextDecoder().decode(lookupResultToBuffer(cert.lookup([...path, 'reject_message']))!);
      const error = new Error(
        `Call was rejected:\n` +
          `  Request ID: ${toHex(requestId)}\n` +
          `  Reject code: ${rejectCode}\n` +
          `  Reject text: ${rejectMessage}\n`,
      );
      (error as any as { callExtras: CallExtraData }).callExtras = {
        canisterTimestamp: lebDecode(new PipeArrayBuffer(lookupResultToBuffer(cert.lookup(['time'])))),
        httpDetails: null!,
      };
      throw error;
    }

    case RequestStatusResponseStatus.Done:
      // This is _technically_ not an error, but we still didn't see the `Replied` status so
      // we don't know the result and cannot decode it.
      throw new Error(`Call was marked as done but we never saw the reply:\n` + `  Request ID: ${toHex(requestId)}\n`);
  }
  throw new Error('unreachable');
}
