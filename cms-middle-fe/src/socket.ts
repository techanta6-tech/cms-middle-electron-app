import { io } from 'socket.io-client';

declare global {
  interface Window {
    electronAPI?: {
      isElectron?: boolean;
    };
  }
}

export const getBeHost = () => {
  const localHost = localStorage.getItem('BE_HOST');
  if (localHost) return localHost;

  return import.meta.env.VITE_BE_HOST || '127.0.0.1';
};

export const getBePort = () => {
  const localPort = localStorage.getItem('BE_PORT');
  if (localPort) return localPort;

  return import.meta.env.VITE_BE_PORT || '5050';
};

export const getBeUrl = () => `http://${getBeHost()}:${getBePort()}`;
const beURL = getBeUrl();

export const socket = io(beURL, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 3000,
  reconnectionDelayMax: 3000,
  randomizationFactor: 0,
});

interface ReconfigurableSocketManager {
  opts: {
    timeout?: number;
  };
  uri: string;
}

export const updateSocketUrlAsync = (url: string): Promise<boolean> => {
  return new Promise((resolve) => {
    socket.disconnect();
    const manager = socket.io as unknown as ReconfigurableSocketManager;
    manager.opts.timeout = 1000;
    manager.uri = url;

    const onConnect = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      resolve(true);
    };

    const onError = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      resolve(false);
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
    socket.connect();
  });
};
