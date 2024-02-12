import { Principal } from '@dfinity/principal';
import { IDL } from '@dfinity/candid';
import { ActorMethodMappedWithExtras, HplActor, HplAgent } from '../delegates/hpl-agent';
import { ActorSubclass } from '@dfinity/agent';

export const createService: <T>(
  canisterId: Principal | string,
  idl: IDL.InterfaceFactory,
  network: 'ic' | 'local',
) => Promise<ActorSubclass<ActorMethodMappedWithExtras<T>> & HplActor> = async (canisterId, idl, network) => {
  const agent = new HplAgent({
    host: network == 'ic' ? 'https://ic0.app' : 'http://127.0.0.1:4943',
    retryTimes: 5,
  });
  if (network === 'local') {
    await agent.fetchRootKey();
  }
  return HplActor.createActor(idl, { agent, canisterId });
};
