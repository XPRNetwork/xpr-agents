export type NetworkId = 'mainnet' | 'testnet';

export interface NetworkConfig {
  id: NetworkId;
  name: string;
  rpc: string;
  chainId: string;
  explorer: string;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: 'mainnet',
    name: 'Mainnet',
    rpc: 'https://proton.eosusa.io',
    chainId: '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0',
    explorer: 'https://explorer.xprnetwork.org',
  },
  testnet: {
    id: 'testnet',
    name: 'Testnet',
    rpc: 'https://tn1.protonnz.com',
    chainId: '71ee83bcf20daefb060b14f72ad1dab3f84b588d12b4571f9b662a13a6f61f82',
    explorer: 'https://testnet.explorer.xprnetwork.org',
  },
};

export function getSelectedNetwork(): NetworkId {
  const envNetwork = process.env.NEXT_PUBLIC_NETWORK;
  if (envNetwork === 'testnet' || envNetwork === 'mainnet') return envNetwork;
  return 'mainnet';
}

export function getNetworkConfig(): NetworkConfig {
  return NETWORKS[getSelectedNetwork()];
}
