import {
  Actor,
  ACTOR_METHOD_WITH_CERTIFICATE,
  ACTOR_METHOD_WITH_HTTP_DETAILS,
  ActorConfig,
  ActorMethod,
  ActorSubclass,
  Agent,
  CallConfig,
  Certificate,
  CreateActorClassOpts,
  CreateCertificateOptions,
  FunctionWithArgsAndReturn,
  getDefaultAgent,
  HttpDetailsResponse,
  lookupResultToBuffer,
  polling,
  QueryCallRejectedError,
  SubmitResponse,
  UpdateCallRejectedError,
  v2ResponseBody,
  v3ResponseBody,
} from '@dfinity/agent';
import { bufFromBufLike, IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { AgentError } from '@dfinity/agent/lib/cjs/errors';
import { defaultStrategy } from '@dfinity/agent/lib/cjs/polling';
import { pollForResponseWithTimestamp } from './hpl-polling';
import { HplAgent, LazyRequest } from './hpl-agent';

export type CallExtraData = {
  httpDetails: HttpDetailsResponse;
  canisterTimestamp: bigint;
};

type OptAwaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;
export interface ActorMethodWithExtras<Args extends unknown[] = unknown[], R = unknown>
  extends ActorMethod<Args, [OptAwaited<R>, CallExtraData]> {}

export type ActorMethodMappedWithExtras<T = unknown> = {
  [K in keyof T]: T[K] extends FunctionWithArgsAndReturn<infer Args, infer Ret>
    ? ActorMethodWithExtras<Args, Ret>
    : never;
};

const metadataSymbol = Symbol.for('ic-agent-metadata');

// Adds extra call info to responses, implements lazy call
export class HplActor extends Actor {
  // FIXME wrong types
  public static createActorClass(
    interfaceFactory: IDL.InterfaceFactory,
    options?: CreateActorClassOpts,
  ): ActorConstructor<any> {
    const service = interfaceFactory({ IDL });

    class CanisterActor extends HplActor {
      [x: string]: ActorMethodMappedWithExtras;

      constructor(config: ActorConfig) {
        if (!config.canisterId)
          throw new AgentError(
            `Canister ID is required, but received ${typeof config.canisterId} instead. If you are using automatically generated declarations, this may be because your application is not setting the canister ID in process.env correctly.`,
          );
        const canisterId =
          typeof config.canisterId === 'string' ? Principal.fromText(config.canisterId) : config.canisterId;

        super({
          config: {
            ...DEFAULT_ACTOR_CONFIG,
            ...config,
            canisterId,
          },
          service,
        });

        for (const [methodName, func] of service._fields) {
          if (options?.httpDetails) {
            func.annotations.push(ACTOR_METHOD_WITH_HTTP_DETAILS);
          }
          if (options?.certificate) {
            func.annotations.push(ACTOR_METHOD_WITH_CERTIFICATE);
          }

          this[methodName] = _createActorMethod(this as any, methodName, func, config.blsVerify);
        }
      }
    }

    return CanisterActor as any;
  }

  // FIXME wrong types
  public static createActor<T = Record<string, ActorMethod>>(
    interfaceFactory: IDL.InterfaceFactory,
    configuration: ActorConfig,
  ): ActorSubclass<T> {
    return new (this.createActorClass(interfaceFactory))(configuration) as unknown as ActorSubclass<
      ActorMethodMappedWithExtras<T>
    > as any;
  }

  protected constructor(metadata: { service: IDL.ServiceClass; agent?: Agent; config: ActorConfig }) {
    super(metadata);
  }

  protected async getFunction(methodName: string): Promise<IDL.FuncClass | undefined> {
    const [_, func] =
      ((this as any)[Symbol.for('ic-agent-metadata')].service as IDL.ServiceClass)._fields.find(
        x => x[0] === methodName,
      ) || [];
    return func;
  }

  public async parseResponse<T = [any, CallExtraData]>(
    methodName: string,
    responseBytes: ArrayBuffer,
    httpDetails: SubmitResponse | null,
    canisterTimestamp: bigint,
  ): Promise<T> {
    const func = await this.getFunction(methodName);
    if (!func) {
      throw new Error(`Function "${methodName} not found!`);
    }
    if (responseBytes === undefined && func.retTypes.length > 0) {
      throw new Error(`Call was returned undefined, but type [${func.retTypes.join(',')}].`);
    }
    return [
      responseBytes ? decodeReturnValue(func.retTypes, responseBytes) : undefined,
      {
        httpDetails,
        canisterTimestamp,
      },
    ] as any as T;
  }

  public async prepareUpdateRequest<Args extends Array<unknown>, Res>(
    methodName: string,
    ...args: Args
  ): Promise<LazyRequest<Res>> {
    const func = await this.getFunction(methodName);
    if (!func) {
      throw new Error(`Function "${methodName} not found!`);
    }

    const actorConfig = (this as any)[Symbol.for('ic-agent-metadata')].config as ActorConfig;
    const { canisterId, effectiveCanisterId, pollingStrategyFactory, blsVerify } = actorConfig;
    const cid = Principal.from(canisterId);
    const ecid = effectiveCanisterId !== undefined ? Principal.from(effectiveCanisterId) : cid;
    const arg = IDL.encode(func.argTypes, args);

    const agent: HplAgent = HplActor.agentOf(this) as HplAgent;
    const { requestId, call } = await agent.prepareRequest(cid, {
      methodName,
      arg,
      effectiveCanisterId: ecid,
    });

    return {
      requestId,
      call: async (): Promise<any> => {
        const { requestId, response, requestDetails } = await call();
        let reply: ArrayBuffer | undefined;
        let certificate: Certificate | undefined;
        if (response.body && (response.body as v3ResponseBody).certificate) {
          if (agent.rootKey == null) {
            throw new Error('Agent is missing root key');
          }
          const cert = (response.body as v3ResponseBody).certificate;
          certificate = await Certificate.create({
            certificate: bufFromBufLike(cert),
            rootKey: agent.rootKey,
            canisterId: Principal.from(canisterId),
            blsVerify,
          });
          const path = [new TextEncoder().encode('request_status'), requestId];
          const status = new TextDecoder().decode(lookupResultToBuffer(certificate.lookup([...path, 'status'])));

          switch (status) {
            case 'replied':
              reply = lookupResultToBuffer(certificate.lookup([...path, 'reply']));
              break;
            case 'rejected': {
              // Find rejection details in the certificate
              const rejectCode = new Uint8Array(lookupResultToBuffer(certificate.lookup([...path, 'reject_code']))!)[0];
              const rejectMessage = new TextDecoder().decode(
                lookupResultToBuffer(certificate.lookup([...path, 'reject_message']))!,
              );
              const error_code_buf = lookupResultToBuffer(certificate.lookup([...path, 'error_code']));
              const error_code = error_code_buf ? new TextDecoder().decode(error_code_buf) : undefined;
              throw new UpdateCallRejectedError(
                cid,
                methodName,
                requestId,
                response,
                rejectCode,
                rejectMessage,
                error_code,
              );
            }
          }
        } else if (response.body && 'reject_message' in response.body) {
          // handle v2 response errors by throwing an UpdateCallRejectedError object
          const { reject_code, reject_message, error_code } = response.body as v2ResponseBody;
          throw new UpdateCallRejectedError(
            cid,
            methodName,
            requestId,
            response,
            reject_code,
            reject_message,
            error_code,
          );
        }

        // Fall back to polling if we receive an Accepted response code
        if (response.status === 202) {
          const pollStrategy = pollingStrategyFactory!();
          // Contains the certificate and the reply from the boundary node
          const response = await pollForResponseWithTimestamp(agent, ecid, requestId, pollStrategy, blsVerify);
          certificate = response.certificate;
          reply = response.reply;
        }
        const shouldIncludeHttpDetails = func.annotations.includes(ACTOR_METHOD_WITH_HTTP_DETAILS);
        const shouldIncludeCertificate = func.annotations.includes(ACTOR_METHOD_WITH_CERTIFICATE);

        const httpDetails = { ...response, requestDetails } as HttpDetailsResponse;
        if (reply !== undefined) {
          if (shouldIncludeHttpDetails && shouldIncludeCertificate) {
            return {
              httpDetails,
              certificate,
              result: decodeReturnValue(func.retTypes, reply),
            } as any;
          } else if (shouldIncludeCertificate) {
            return {
              certificate,
              result: decodeReturnValue(func.retTypes, reply),
            };
          } else if (shouldIncludeHttpDetails) {
            return {
              httpDetails,
              result: decodeReturnValue(func.retTypes, reply),
            };
          }
          return decodeReturnValue(func.retTypes, reply);
        } else if (func.retTypes.length === 0) {
          return shouldIncludeHttpDetails
            ? {
                httpDetails: response,
                result: undefined,
              }
            : undefined;
        } else {
          throw new Error(`Call was returned undefined, but type [${func.retTypes.join(',')}].`);
        }
      },
    };
  }
}

export const decodeReturnValue = (types: IDL.Type[], msg: ArrayBuffer) => {
  const returnValues = IDL.decode(types, Buffer.from(msg));
  switch (returnValues.length) {
    case 0:
      return undefined;
    case 1:
      return returnValues[0];
    default:
      return returnValues;
  }
};

const DEFAULT_ACTOR_CONFIG = {
  pollingStrategyFactory: defaultStrategy,
};

enum QueryResponseStatus {
  Replied = 'replied',
  Rejected = 'rejected',
}

export type ActorConstructor<T> = new (config: ActorConfig) => ActorSubclass<ActorMethodMappedWithExtras<T>>;

function _createActorMethod(
  actor: HplActor & { [metadataSymbol]: any },
  methodName: string,
  func: IDL.FuncClass,
  blsVerify?: CreateCertificateOptions['blsVerify'],
): ActorMethodWithExtras {
  let caller: (options: CallConfig, ...args: unknown[]) => Promise<unknown>;
  if (func.annotations.includes('query') || func.annotations.includes('composite_query')) {
    caller = async (options, ...args) => {
      // First, if there's a config transformation, call it.
      options = {
        ...options,
        ...actor[metadataSymbol].config.queryTransform?.(methodName, args, {
          ...actor[metadataSymbol].config,
          ...options,
        }),
      };

      const agent = options.agent || actor[metadataSymbol].config.agent || getDefaultAgent();
      const cid = Principal.from(options.canisterId || actor[metadataSymbol].config.canisterId);
      const arg = IDL.encode(func.argTypes, args);

      const result = await agent.query(cid, {
        methodName,
        arg,
        effectiveCanisterId: options.effectiveCanisterId,
      });
      const httpDetails = {
        ...result.httpDetails,
        requestDetails: result.requestDetails,
      } as HttpDetailsResponse;

      switch (result.status) {
        case QueryResponseStatus.Rejected:
          const error = new QueryCallRejectedError(cid, methodName, result);
          (error as any as { callExtras: CallExtraData }).callExtras = {
            canisterTimestamp: BigInt(result.signatures[0].timestamp),
            httpDetails: result.httpDetails,
          };
          throw error;
        case QueryResponseStatus.Replied:
          return [
            decodeReturnValue(func.retTypes, result.reply.arg),
            {
              canisterTimestamp: BigInt(result.signatures[0].timestamp),
              httpDetails: result.httpDetails,
            },
          ];
      }
    };
  } else {
    caller = async (options, ...args) => {
      // First, if there's a config transformation, call it.
      options = {
        ...options,
        ...actor[metadataSymbol].config.callTransform?.(methodName, args, {
          ...actor[metadataSymbol].config,
          ...options,
        }),
      };

      const agent = options.agent || actor[metadataSymbol].config.agent || getDefaultAgent();
      const { canisterId, effectiveCanisterId, pollingStrategyFactory } = {
        ...DEFAULT_ACTOR_CONFIG,
        ...actor[metadataSymbol].config,
        ...options,
      } as any;
      const cid = Principal.from(canisterId);
      const ecid = effectiveCanisterId !== undefined ? Principal.from(effectiveCanisterId) : cid;
      const arg = IDL.encode(func.argTypes, args);

      const { requestId, response, requestDetails } = await agent.call(cid, {
        methodName,
        arg,
        effectiveCanisterId: ecid,
      });
      let reply: ArrayBuffer | undefined;
      let certificate: Certificate | undefined;
      if (response.body && (response.body as v3ResponseBody).certificate) {
        if (agent.rootKey == null) {
          throw new Error('Agent is missing root key');
        }
        const cert = (response.body as v3ResponseBody).certificate;
        certificate = await Certificate.create({
          certificate: bufFromBufLike(cert),
          rootKey: agent.rootKey,
          canisterId: Principal.from(canisterId),
          blsVerify,
        });
        const path = [new TextEncoder().encode('request_status'), requestId];
        const status = new TextDecoder().decode(lookupResultToBuffer(certificate.lookup([...path, 'status'])));

        switch (status) {
          case 'replied':
            reply = lookupResultToBuffer(certificate.lookup([...path, 'reply']));
            break;
          case 'rejected': {
            // Find rejection details in the certificate
            const rejectCode = new Uint8Array(lookupResultToBuffer(certificate.lookup([...path, 'reject_code']))!)[0];
            const rejectMessage = new TextDecoder().decode(
              lookupResultToBuffer(certificate.lookup([...path, 'reject_message']))!,
            );
            const error_code_buf = lookupResultToBuffer(certificate.lookup([...path, 'error_code']));
            const error_code = error_code_buf ? new TextDecoder().decode(error_code_buf) : undefined;
            throw new UpdateCallRejectedError(
              cid,
              methodName,
              requestId,
              response,
              rejectCode,
              rejectMessage,
              error_code,
            );
          }
        }
      } else if (response.body && 'reject_message' in response.body) {
        // handle v2 response errors by throwing an UpdateCallRejectedError object
        const { reject_code, reject_message, error_code } = response.body as v2ResponseBody;
        throw new UpdateCallRejectedError(
          cid,
          methodName,
          requestId,
          response,
          reject_code,
          reject_message,
          error_code,
        );
      }

      // Fall back to polling if we receive an Accepted response code
      if (response.status === 202) {
        const pollStrategy = pollingStrategyFactory();
        // Contains the certificate and the reply from the boundary node
        const response = await pollForResponseWithTimestamp(agent, ecid, requestId, pollStrategy, blsVerify);
        certificate = response.certificate;
        reply = response.reply;
      }
      const shouldIncludeHttpDetails = func.annotations.includes(ACTOR_METHOD_WITH_HTTP_DETAILS);
      const shouldIncludeCertificate = func.annotations.includes(ACTOR_METHOD_WITH_CERTIFICATE);

      const httpDetails = { ...response, requestDetails } as HttpDetailsResponse;
      if (reply !== undefined) {
        if (shouldIncludeHttpDetails && shouldIncludeCertificate) {
          return {
            httpDetails,
            certificate,
            result: decodeReturnValue(func.retTypes, reply),
          };
        } else if (shouldIncludeCertificate) {
          return {
            certificate,
            result: decodeReturnValue(func.retTypes, reply),
          };
        } else if (shouldIncludeHttpDetails) {
          return {
            httpDetails,
            result: decodeReturnValue(func.retTypes, reply),
          };
        }
        return decodeReturnValue(func.retTypes, reply);
      } else if (func.retTypes.length === 0) {
        return shouldIncludeHttpDetails
          ? {
              httpDetails: response,
              result: undefined,
            }
          : undefined;
      } else {
        throw new Error(`Call was returned undefined, but type [${func.retTypes.join(',')}].`);
      }
    };
  }

  const handler = (...args: unknown[]) => caller({}, ...args);
  handler.withOptions =
    (options: CallConfig) =>
    (...args: unknown[]) =>
      caller(options, ...args);
  return handler as ActorMethodWithExtras;
}
