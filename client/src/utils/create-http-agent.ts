import { HttpAgent, HttpAgentOptions } from '@dfinity/agent';

export async function createHttpAgent(network: 'ic' | 'local', options?: HttpAgentOptions): Promise<HttpAgent> {
  const agent = new HttpAgent({
    host: network == 'ic' ? 'https://ic0.app' : 'http://127.0.0.1:4943',
    ...options,
  });
  if (network === 'local') {
    await agent.fetchRootKey();
  }
  return agent;
}
