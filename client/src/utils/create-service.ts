import { Principal } from '@dfinity/principal';
import { IDL } from '@dfinity/candid';
import { Actor } from '@dfinity/agent';
import { createHttpAgent } from './create-http-agent';

export const createService: <T>(
  canisterId: Principal | string,
  idl: IDL.InterfaceFactory,
  network: 'ic' | 'local',
) => Promise<T> = async (canisterId, idl, network) => {
  const agent = await createHttpAgent(network, { retryTimes: 5 });
  return Actor.createActor(idl, { agent, canisterId });
};
