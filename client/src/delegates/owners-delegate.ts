import { Principal } from '@dfinity/principal';
import { _SERVICE as OwnersAPI } from '../../candid/owners';
import { idlFactory as ownersIDLFactory } from '../../candid/owners.idl';
import { Delegate } from './delegate';

export class OwnersDelegate extends Delegate<OwnersAPI> {
  constructor(
    protected readonly _canisterPrincipal: Principal | string,
    network: 'ic' | 'local',
  ) {
    super(ownersIDLFactory, _canisterPrincipal, network);
  }

  async get(ownerId: bigint): Promise<Principal> {
    return this.query((await this.service).get, {}, ownerId);
  }

  async lookup(principal: Principal | string): Promise<bigint | null> {
    const p = typeof principal === 'string' ? Principal.fromText(principal) : principal;
    return this.optQuery((await this.service).lookup, {}, p);
  }
}
