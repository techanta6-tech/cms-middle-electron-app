import { io } from 'socket.io-client';

declare global {
  interface Window {
    electronAPI?: {
      getLocalIP: () => string;
      getBePort: () => number | null;
      getAppVersion: () => string;
    };
  }
}

const getBeHost = () => {
  // 1. Ưu tiên: User ghi đè qua localStorage
  const localHost = localStorage.getItem('BE_HOST');
  if (localHost) return localHost;

  // 2. Chạy trong vỏ Electron Production: Ưu tiên lấy IP thực tế qua IPC, nếu không lấy được mới fallback về 127.0.0.1
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.getLocalIP) {
    const detectedIP = window.electronAPI.getLocalIP();
    return detectedIP || '127.0.0.1';
  }

  // 3. Fallback cho Dev Web: Dùng giá trị build-time VITE_BE_HOST
  return import.meta.env.VITE_BE_HOST || '127.0.0.1';
};

const getBePort = () => {
  const localPort = localStorage.getItem('BE_PORT');
  if (localPort) return localPort;

  // Nếu chạy trong Electron vỏ Production, dùng cổng động do hệ điều hành cấp
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.getBePort) {
    const electronPort = window.electronAPI.getBePort();
    if (electronPort) return electronPort.toString();
  }

  return import.meta.env.VITE_BE_PORT || '5050';
};
const beURL = `http://${getBeHost()}:${getBePort()}`;

export const socket = io(beURL, {
  reconnection: true,             // Bật tính năng tự động kết nối lại
  reconnectionAttempts: Infinity, // Số lần thử kết nối (Infinity = vô hạn)
  reconnectionDelay: 3000,        // Thời gian chờ trươc khi thử lại (3s)
  reconnectionDelayMax: 3000,     // Thời gian chờ tối đa (để cố định ở 3s)
  randomizationFactor: 0          // Bỏ qua độ trễ ngẫu nhiên
});

// reset socket
export const updateSocketUrlAsync = (url: string): Promise<boolean> => {
  return new Promise((resolve) => {
    socket.disconnect();
    (socket.io as any).opts.timeout = 1000;
    (socket.io as any).uri = url;
    // Lắng nghe sự kiện kết nối thành công
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
