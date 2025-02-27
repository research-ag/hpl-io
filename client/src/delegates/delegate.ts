import { Principal } from '@dfinity/principal';
import { IDL } from '@dfinity/candid';
import { Actor, ActorSubclass, HttpAgent, Identity, RequestId } from '@dfinity/agent';
import {
  CallInterceptor,
  hplErrorInterceptor,
  QueryRetryInterceptorErrorCallback,
  retryQueryInterceptor,
} from './call-interceptors';
import { unpackOptResponse } from '../utils/unpack-opt.util';
import { unpackRes } from '../utils/unpack-res.util';
import { ActorMethodExtended, FunctionWithArgsAndReturn } from '@dfinity/agent/lib/cjs/actor';
import { Certificate } from '@dfinity/agent/lib/cjs/certificate';
import { HttpDetailsResponse } from '@dfinity/agent/lib/cjs/agent';
import { getCanisterTimestamp } from '../utils/get-canister-timestamp-from-certificate';

export type DelegateCallOptions = {
  retryErrorCallback?: QueryRetryInterceptorErrorCallback;
};

export interface LazyRequest<Res> {
  requestId: RequestId;
  call: () => Promise<Res>;
}

// fixed version of agent-js ActorMethodMappedExtendedFixed: does not produce Promise<Promise<T>> return type
export type ActorMethodMappedExtendedFixed<T> = {
  [K in keyof T]: T[K] extends FunctionWithArgsAndReturn<infer Args, Promise<infer Ret>>
    ? ActorMethodExtended<Args, Ret>
    : never;
};

export type CallExtraData = {
  canisterTimestamp: number;
};

export type ActorMethodExtendedReturnType<R> = {
  certificate?: Certificate;
  httpDetails?: HttpDetailsResponse;
  result: R;
};

export const mapResponse = <T>(response: ActorMethodExtendedReturnType<T>): [T, CallExtraData] => [
  response.result,
  {
    canisterTimestamp: response.certificate ? getCanisterTimestamp(response.certificate) : 0,
  },
];

export const defaultIcAgent: HttpAgent = new HttpAgent({
  host: 'https://ic0.app',
  retryTimes: 5,
});

export abstract class Delegate<T> {
  protected constructor(
    protected readonly idl: IDL.InterfaceFactory,
    protected readonly _canisterPrincipal: Principal | string,
    public readonly network: 'ic' | 'local',
  ) {
    this._canisterPromise = (async (): Promise<ActorSubclass<ActorMethodMappedExtendedFixed<T>>> => {
      let agent = defaultIcAgent;
      if (network === 'local') {
        agent = new HttpAgent({
          host: 'http://127.0.0.1:4943',
          retryTimes: 5,
        });
        await agent.fetchRootKey();
      }
      return Actor.createActorWithExtendedDetails<T>(
        idl,
        { agent, canisterId: _canisterPrincipal },
        { certificate: true, httpDetails: true },
      ) as any;
    })();
  }

  public get canisterPrincipal(): Principal {
    return this._canisterPrincipal instanceof Principal
      ? this._canisterPrincipal
      : Principal.fromText(this._canisterPrincipal);
  }

  private _service: ActorSubclass<ActorMethodMappedExtendedFixed<T>> | null = null;
  private _canisterPromise: Promise<ActorSubclass<ActorMethodMappedExtendedFixed<T>>>;

  public get service(): Promise<ActorSubclass<ActorMethodMappedExtendedFixed<T>>> {
    return this._service ? Promise.resolve(this._service) : this._canisterPromise;
  }

  public get agent(): Promise<HttpAgent | undefined> {
    return this.service!.then(s => Actor.agentOf(s) as HttpAgent);
  }

  public async replaceIdentity(identity: Identity) {
    (await this.agent)!.replaceIdentity(identity);
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
  protected query<Args extends Array<unknown>, R>(
    call: ActorMethodExtended<Args, R>,
    options: DelegateCallOptions = {},
    ...args: Args
  ): Promise<R> {
    return this.queryWithExtras(call, options, ...args).then(([r, _]) => r);
  }

  protected async queryWithExtras<Args extends Array<unknown>, R>(
    call: ActorMethodExtended<Args, R>,
    options: DelegateCallOptions = {},
    ...args: Args
  ): Promise<[R, CallExtraData]> {
    return this.wrapCall<ActorMethodExtendedReturnType<R>, Args>(
      call,
      [retryQueryInterceptor(options.retryErrorCallback), hplErrorInterceptor],
      ...args,
    ).then(mapResponse);
  }

  // run query returning result. Encapsulates error handling, retrying query
  protected resQuery<Args extends Array<unknown>, Ok, Err>(
    call: ActorMethodExtended<Args, { ok?: Ok; err?: Err }>,
    options: DelegateCallOptions = {},
    ...args: Args
  ): Promise<Ok> {
    return unpackRes(this.queryWithExtras(call, options, ...args));
  }

  // run query returning optional result. Encapsulates error handling, retrying query
  protected optQuery<Args extends Array<unknown>, R>(
    call: ActorMethodExtended<Args, [R] | []>,
    options: DelegateCallOptions = {},
    ...args: Args
  ): Promise<R | null> {
    return unpackOptResponse(this.query(call, options, ...args));
  }

  // run update. Encapsulates error handling
  protected update<Args extends Array<unknown>, R>(call: ActorMethodExtended<Args, R>, ...args: Args): Promise<R> {
    return this.updateWithExtras(call, ...args).then(([r, _]) => r);
  }

  protected async updateWithExtras<Args extends Array<unknown>, R>(
    call: ActorMethodExtended<Args, R>,
    ...args: Args
  ): Promise<[R, CallExtraData]> {
    return this.wrapCall<ActorMethodExtendedReturnType<R>, Args>(call, [hplErrorInterceptor], ...args).then(
      mapResponse,
    );
  }

  // run update returning result. Encapsulates error handling
  protected resUpdate<Args extends Array<unknown>, Ok, Err>(
    call: ActorMethodExtended<Args, { ok?: Ok; err?: Err }>,
    ...args: Args
  ): Promise<Ok> {
    return unpackRes(this.updateWithExtras(call, ...args));
  }

  // public async prepareUpdateRequest<Args extends Array<unknown>, Res>(
  //   methodName: string,
  //   ...args: Args
  // ): Promise<LazyRequest<Res>> {
  //   return (await this.service)!.prepareUpdateRequest(methodName, ...args);
  // }
}
