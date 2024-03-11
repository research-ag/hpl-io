import {
  Actor,
  ActorConfig,
  ActorMethod,
  ActorSubclass,
  Agent,
  CallConfig,
  CreateCertificateOptions,
  FunctionWithArgsAndReturn,
  getDefaultAgent,
  HttpDetailsResponse,
  polling,
  QueryCallRejectedError,
  SubmitResponse,
  UpdateCallRejectedError,
} from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
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
  public static createActorClass(interfaceFactory: IDL.InterfaceFactory): ActorConstructor<any> {
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
      call: async (): Promise<Res> => {
        const { response } = await call();
        if (!response.ok || response.body /* IC-1462 */) {
          throw new UpdateCallRejectedError(cid, methodName, requestId, response);
        }
        const pollStrategy = (pollingStrategyFactory || polling.defaultStrategy)();
        const [responseBytes, timestamp] = await pollForResponseWithTimestamp(
          agent,
          ecid,
          requestId,
          pollStrategy,
          null,
          blsVerify,
        );
        return this.parseResponse(methodName, responseBytes, response as any, timestamp);
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

      const result = await agent.query(cid, { methodName, arg });

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
      const { requestId, response } = await agent.call(cid, {
        methodName,
        arg,
        effectiveCanisterId: ecid,
      });

      if (!response.ok || response.body /* IC-1462 */) {
        throw new UpdateCallRejectedError(cid, methodName, requestId, response);
      }

      const pollStrategy = pollingStrategyFactory();
      const [responseBytes, timestamp] = await pollForResponseWithTimestamp(
        agent,
        ecid,
        requestId,
        pollStrategy,
        blsVerify,
      );
      if (responseBytes === undefined && func.retTypes.length != 0) {
        throw new Error(`Call was returned undefined, but type [${func.retTypes.join(',')}].`);
      }
      return [
        responseBytes ? decodeReturnValue(func.retTypes, responseBytes) : undefined,
        {
          canisterTimestamp: timestamp,
          httpDetails: response,
        },
      ];
    };
  }

  const handler = (...args: unknown[]) => caller({}, ...args);
  handler.withOptions =
    (options: CallConfig) =>
    (...args: unknown[]) =>
      caller(options, ...args);
  return handler as ActorMethodWithExtras;
}
