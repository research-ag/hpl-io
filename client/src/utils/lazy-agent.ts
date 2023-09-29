import { Principal } from '@dfinity/principal';
import {
  CallRequest,
  Cbor,
  Expiry,
  HttpAgent,
  HttpAgentSubmitRequest,
  Identity,
  RequestId,
  requestIdOf,
  SubmitRequestType,
  SubmitResponse,
} from '@dfinity/agent';

export function httpHeadersTransform(headers: Headers): [string, string][] {
  const headerFields: [string, string][] = [];
  headers.forEach((value, key) => {
    headerFields.push([key, value]);
  });
  return headerFields;
}

// Default delta for ingress expiry is 5 minutes.
const DEFAULT_INGRESS_EXPIRY_DELTA_IN_MSECS = 5 * 60 * 1000;

/**
 * The HTTP agent for calling canister, but have ability to prepare request and return request id before perfoming actual call
 * */
export class LazyAgent extends HttpAgent {
  public async prepareRequest(
    canisterId: Principal | string,
    options: {
      methodName: string;
      arg: ArrayBuffer;
      effectiveCanisterId?: Principal | string;
    },
    identity?: Identity | Promise<Identity>,
  ): Promise<{
    requestId: RequestId;
    call: () => Promise<SubmitResponse>;
  }> {
    // copy-paste from HttpAgent::call
    const id = await (identity !== undefined ? await identity : await this['_identity']);
    if (!id) {
      throw new Error( //IdentityInvalidError(
        "This identity has expired due this application's security policy. Please refresh your authentication.",
      );
    }
    const canister = Principal.from(canisterId);
    const ecid = options.effectiveCanisterId ? Principal.from(options.effectiveCanisterId) : canister;
    const sender: Principal = id.getPrincipal() || Principal.anonymous();
    let ingress_expiry: any = new Expiry(DEFAULT_INGRESS_EXPIRY_DELTA_IN_MSECS);

    // If the value is off by more than 30 seconds, reconcile system time with the network
    if (Math.abs(this['_timeDiffMsecs']) > 1_000 * 30) {
      ingress_expiry = new Expiry(DEFAULT_INGRESS_EXPIRY_DELTA_IN_MSECS + this['_timeDiffMsecs']);
    }

    const submit: CallRequest = {
      request_type: SubmitRequestType.Call,
      canister_id: canister,
      method_name: options.methodName,
      arg: options.arg,
      sender,
      ingress_expiry,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let transformedRequest: any = (await this._transform({
      request: {
        body: null,
        method: 'POST',
        headers: {
          'Content-Type': 'application/cbor',
          ...(this['_credentials'] ? { Authorization: 'Basic ' + btoa(this['_credentials']) } : {}),
        },
      },
      endpoint: 'call' as any,
      body: submit as any,
    })) as unknown as HttpAgentSubmitRequest;

    // Apply transform for identity.
    transformedRequest = await id.transformRequest(transformedRequest);

    const body = Cbor.encode(transformedRequest.body);

    const requestId = await requestIdOf(submit);

    return {
      requestId,
      call: async (): Promise<SubmitResponse> => {
        const response = await this['_requestAndRetry'](() =>
          this['_fetch']('' + new URL(`/api/v2/canister/${ecid.toText()}/call`, this['_host']), {
            ...this['_callOptions'],
            ...transformedRequest.request,
            body,
          }),
        );
        const responseBuffer = await response.arrayBuffer();
        const responseBody = (
          response.status === 200 && responseBuffer.byteLength > 0 ? Cbor.decode(responseBuffer) : null
        ) as SubmitResponse['response']['body'];
        return {
          requestId,
          response: {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            body: responseBody,
            headers: httpHeadersTransform(response.headers),
          },
        };
      },
    };
  }
}
