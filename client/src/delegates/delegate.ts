import { Principal } from '@dfinity/principal';
import { IDL } from '@dfinity/candid';
import { HttpAgent, Identity, RequestId } from '@dfinity/agent';
import {
  CallInterceptor,
  hplErrorInterceptor,
  QueryRetryInterceptorErrorCallback,
  retryQueryInterceptor,
} from './call-interceptors';
import { unpackOptResponse } from '../utils/unpack-opt.util';
import { unpackRes } from '../utils/unpack-res.util';
import { Certificate } from '@dfinity/agent/lib/cjs/certificate';
import { HttpDetailsResponse } from '@dfinity/agent/lib/cjs/agent';
import { Actor, ActorMethodExtended, ActorMethodMappedExtended, ActorSubclass } from '../agent-js';
import { NodeSignature } from '@dfinity/agent/lib/cjs/agent/api';
import { CallExtraData, extractCallExtraData } from '../utils/call-extra-data';

export type DelegateCallOptions = {
  retryErrorCallback?: QueryRetryInterceptorErrorCallback;
};

export interface LazyRequest<Res> {
  requestId: RequestId;
  commit: () => Promise<Res>;
}

export type ActorMethodExtendedReturnType<R> = {
  certificate?: Certificate;
  httpDetails?: HttpDetailsResponse;
  signatures?: NodeSignature[];
  result: R;
};

export const mapResponse = <T>(response: ActorMethodExtendedReturnType<T>): [T, CallExtraData] => [
  response.result,
  extractCallExtraData(response),
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
    this._canisterPromise = (async (): Promise<ActorSubclass<ActorMethodMappedExtended<T>>> => {
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

  private _service: ActorSubclass<ActorMethodMappedExtended<T>> | null = null;
  private _canisterPromise: Promise<ActorSubclass<ActorMethodMappedExtended<T>>>;

  public get service(): Promise<ActorSubclass<ActorMethodMappedExtended<T>>> {
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

  public async prepareUpdateRequest<Args extends Array<unknown>, Res>(
    call: ActorMethodExtended<Args, Res>,
    ...args: Args
  ): Promise<LazyRequest<Res>> {
    const { requestId, commit } = await this.prepareUpdateRequestWithExtras(call, ...args);
    return {
      requestId,
      commit: () => commit().then(([res, _]) => res),
    };
  }

  public async prepareUpdateRequestWithExtras<Args extends Array<unknown>, Res>(
    call: ActorMethodExtended<Args, Res>,
    ...args: Args
  ): Promise<LazyRequest<[Res, CallExtraData]>> {
    const { requestId, commit } = await call.prepare(...args);
    return {
      requestId,
      commit: () => commit().then(mapResponse),
    };
  }
}
