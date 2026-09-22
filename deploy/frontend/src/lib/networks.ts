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
    rpc: 'https://api-xprnetwork-main.saltant.io',
    chainId: '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0',
    explorer: 'https://explorer.xprnetwork.org',
  },
  testnet: {
    id: 'testnet',
    name: 'Testnet',
    rpc: 'https://tn1.protonnz.com',
    chainId: '71ee83bcf52142d61019d95f9cc5427ba6a0d7ff8accd9e2088ae2abeaf3d3dd',
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
