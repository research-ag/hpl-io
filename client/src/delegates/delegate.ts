import { Principal } from '@dfinity/principal';
import { IDL } from '@dfinity/candid';
import { ActorSubclass, Identity } from '@dfinity/agent';
import {
  CallInterceptor,
  hplErrorInterceptor,
  QueryRetryInterceptorErrorCallback,
  retryQueryInterceptor,
} from './call-interceptors';
import { unpackOptResponse } from '../utils/unpack-opt.util';
import { unpackRes } from '../utils/unpack-res.util';
import {
  ActorMethodMappedWithExtras,
  ActorMethodWithExtras,
  CallExtraData,
  HplActor,
  HplAgent,
  LazyRequest,
} from './hpl-agent';

export type DelegateCallOptions = {
  retryErrorCallback?: QueryRetryInterceptorErrorCallback;
};

export const defaultIcAgent: HplAgent = new HplAgent({
  host: 'https://ic0.app',
  retryTimes: 5,
});

export abstract class Delegate<T> {
  protected constructor(
    protected readonly idl: IDL.InterfaceFactory,
    protected readonly _canisterPrincipal: Principal | string,
    public readonly network: 'ic' | 'local',
  ) {
    this._canisterPromise = (async () => {
      let agent = defaultIcAgent;
      if (network === 'local') {
        agent = new HplAgent({
          host: 'http://127.0.0.1:4943',
          retryTimes: 5,
        });
        await agent.fetchRootKey();
      }
      return HplActor.createActor(idl, { agent, canisterId: _canisterPrincipal });
    })();
  }

  public get canisterPrincipal(): Principal {
    return this._canisterPrincipal instanceof Principal
      ? this._canisterPrincipal
      : Principal.fromText(this._canisterPrincipal);
  }

  private _service: ActorSubclass<ActorMethodMappedWithExtras<T> & HplActor> | null = null;
  private _canisterPromise: Promise<ActorSubclass<ActorMethodMappedWithExtras<T>> & HplActor>;

  public get service(): Promise<ActorSubclass<ActorMethodMappedWithExtras<T>> & HplActor> {
    return this._service ? Promise.resolve(this._service) : this._canisterPromise;
  }

  public get agent(): Promise<HplAgent | undefined> {
    return this.service!.then(s => HplActor.agentOf(s) as HplAgent);
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
    call: ActorMethodWithExtras<Args, R>,
    options: DelegateCallOptions = {},
    ...args: Args
  ): Promise<R> {
    return this.queryWithExtras(call, options, ...args).then(([r, _]) => r);
  }

  protected async queryWithExtras<Args extends Array<unknown>, R>(
    call: ActorMethodWithExtras<Args, R>,
    options: DelegateCallOptions = {},
    ...args: Args
  ): Promise<[R, CallExtraData]> {
    return this.wrapCall(
      call,
      [retryQueryInterceptor(options.retryErrorCallback), hplErrorInterceptor],
      ...args,
    ) as Promise<[R, CallExtraData]>;
  }

  // run query returning result. Encapsulates error handling, retrying query
  protected resQuery<Args extends Array<unknown>, Ok, Err>(
    call: ActorMethodWithExtras<Args, { ok?: Ok; err?: Err }>,
    options: DelegateCallOptions = {},
    ...args: Args
  ): Promise<Ok> {
    return unpackRes(this.queryWithExtras(call, options, ...args));
  }

  // run query returning optional result. Encapsulates error handling, retrying query
  protected optQuery<Args extends Array<unknown>, R>(
    call: ActorMethodWithExtras<Args, [R] | []>,
    options: DelegateCallOptions = {},
    ...args: Args
  ): Promise<R | null> {
    return unpackOptResponse(this.query(call, options, ...args));
  }

  // run update. Encapsulates error handling
  protected update<Args extends Array<unknown>, R>(call: ActorMethodWithExtras<Args, R>, ...args: Args): Promise<R> {
    return this.updateWithExtras(call, ...args).then(([r, _]) => r);
  }

  protected async updateWithExtras<Args extends Array<unknown>, R>(
    call: ActorMethodWithExtras<Args, R>,
    ...args: Args
  ): Promise<[R, CallExtraData]> {
    return this.wrapCall(call, [hplErrorInterceptor], ...args) as Promise<[R, CallExtraData]>;
  }

  // run update returning result. Encapsulates error handling
  protected resUpdate<Args extends Array<unknown>, Ok, Err>(
    call: ActorMethodWithExtras<Args, { ok?: Ok; err?: Err }>,
    ...args: Args
  ): Promise<Ok> {
    return unpackRes(this.updateWithExtras(call, ...args));
  }

  public async prepareUpdateRequest<Args extends Array<unknown>, Res>(
    methodName: string,
    ...args: Args
  ): Promise<LazyRequest<Res>> {
    return (await this.service)!.prepareUpdateRequest(methodName, ...args);
  }
}
