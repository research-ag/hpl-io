import { Principal } from '@dfinity/principal';
import { IDL } from '@dfinity/candid';
import { createService } from '../utils/create-service';
import {
  Actor,
  ACTOR_METHOD_WITH_HTTP_DETAILS,
  ActorConfig,
  Agent,
  AnonymousIdentity,
  polling,
  RequestId,
  SubmitResponse,
  UpdateCallRejectedError,
} from '@dfinity/agent';
import { CallInterceptor, hplErrorInterceptor, retryQueryInterceptor } from './call-interceptors';
import { unpackOptResponse } from '../utils/unpack-opt.util';
import { unpackRes } from '../utils/unpack-res.util';
import { LazyAgent } from '../utils/lazy-agent';

// import { idlFactory as certifiedLedgerIdlFactory } from '../../candid/ledger.certified.idl';

interface LazyRequest<Res> {
  requestId: RequestId;
  call: () => Promise<Res>;
}

function decodeReturnValue(types: IDL.Type[], msg: ArrayBuffer) {
  const returnValues = IDL.decode(types, Buffer.from(msg));
  switch (returnValues.length) {
    case 0:
      return undefined;
    case 1:
      return returnValues[0];
    default:
      return returnValues;
  }
}

export abstract class Delegate<T> {
  protected constructor(
    protected readonly idl: IDL.InterfaceFactory,
    protected readonly _canisterPrincipal: Principal | string,
    protected readonly network: 'ic' | 'local',
  ) {
    this._canisterPromise = createService<T & Actor>(_canisterPrincipal, idl, network).then(s => {
      this._service = s;
      return s;
    });
  }

  public get canisterPrincipal(): Principal {
    return this._canisterPrincipal instanceof Principal
      ? this._canisterPrincipal
      : Principal.fromText(this._canisterPrincipal);
  }

  private _service: (T & Actor) | null = null;
  private _canisterPromise: Promise<T & Actor>;

  public get service(): Promise<T & Actor> {
    return this._service ? Promise.resolve(this._service) : this._canisterPromise;
  }

  public get agent(): Promise<Agent | undefined> {
    return this.service!.then(s => Actor.agentOf(s));
  }

  protected wrapCall<R, Args extends Array<unknown>>(
    call: (...args: Args) => Promise<R>,
    interceptors: CallInterceptor<R, Args>[],
    ...args: Args
  ): Promise<R> {
    if (!interceptors.length) return call(...args);
    return interceptors.pop()!((...a: Args) => this.wrapCall(call, interceptors, ...args), ...args);
  }

  // run query. Encapsulates error handling, retrying query
  protected query<R, Args extends Array<unknown>>(call: (...args: Args) => Promise<R>, ...args: Args): Promise<R> {
    return this.wrapCall(call, [retryQueryInterceptor, hplErrorInterceptor], ...args);
  }

  // run query returning optional result. Encapsulates error handling, retrying query
  protected optQuery<R, Args extends Array<unknown>>(
    call: (...args: Args) => Promise<[R] | []>,
    ...args: Args
  ): Promise<R | null> {
    return unpackOptResponse(this.query(call, ...args));
  }

  // run update. Encapsulates error handling
  protected update<R, Args extends Array<unknown>>(call: (...args: Args) => Promise<R>, ...args: Args): Promise<R> {
    return this.wrapCall(call, [hplErrorInterceptor], ...args);
  }

  // run update returning result. Encapsulates error handling
  protected resUpdate<Ok, Err, Args extends Array<unknown>>(
    call: (...args: Args) => Promise<{
      ok?: Ok;
      err?: Err;
    }>,
    ...args: Args
  ): Promise<Ok> {
    return unpackRes(this.update(call, ...args));
  }

  public async getFunction(methodName: string): Promise<IDL.FuncClass | undefined> {
    const actor = await this.service!;
    const [_, func] =
      ((actor as any)[Symbol.for('ic-agent-metadata')].service as IDL.ServiceClass)._fields.find(
        x => x[0] === methodName,
      ) || [];
    return func;
  }

  public async parseResponse<T>(
    methodName: string,
    responseBytes: ArrayBuffer,
    httpDetails: SubmitResponse | null,
  ): Promise<T> {
    const func = await this.getFunction(methodName);
    if (!func) {
      throw new Error(`Function "${methodName} not found!`);
    }
    const shouldIncludeHttpDetails = func.annotations.includes(ACTOR_METHOD_WITH_HTTP_DETAILS);
    if (responseBytes !== undefined) {
      return (shouldIncludeHttpDetails
        ? {
            httpDetails,
            result: decodeReturnValue(func.retTypes, responseBytes),
          }
        : decodeReturnValue(func.retTypes, responseBytes)) as any as T;
    } else if (func.retTypes.length === 0) {
      return (shouldIncludeHttpDetails
        ? {
            httpDetails,
            result: undefined,
          }
        : undefined) as any as T;
    } else {
      throw new Error(`Call was returned undefined, but type [${func.retTypes.join(',')}].`);
    }
  }

  public async prepareUpdateRequest<Args extends Array<unknown>, Res>(
    methodName: string,
    ...args: Args
  ): Promise<LazyRequest<Res>> {
    const func = await this.getFunction(methodName);
    if (!func) {
      throw new Error(`Function "${methodName} not found!`);
    }

    const actor = await this.service!;
    const actorConfig = (actor as any)[Symbol.for('ic-agent-metadata')].config as ActorConfig;
    const { canisterId, effectiveCanisterId, pollingStrategyFactory, blsVerify } = actorConfig;
    const cid = Principal.from(canisterId);
    const ecid = effectiveCanisterId !== undefined ? Principal.from(effectiveCanisterId) : cid;
    const arg = IDL.encode(func.argTypes, args);

    const realAgent = await this.agent;
    const lazyAgent = new LazyAgent({
      host: this.network == 'ic' ? 'https://ic0.app' : 'http://127.0.0.1:4943',
      identity: ((realAgent as any) || {})['_identity'] || new AnonymousIdentity(),
    });
    if (this.network === 'local') {
      await lazyAgent.fetchRootKey();
    }

    const { requestId, call } = await lazyAgent.prepareRequest(cid, {
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
        const responseBytes = await polling.pollForResponse(
          lazyAgent as any,
          ecid,
          requestId,
          pollStrategy,
          null,
          blsVerify,
        );
        return this.parseResponse(methodName, responseBytes, response as any);
      },
    };
  }
}
