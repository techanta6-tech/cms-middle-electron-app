import { io } from 'socket.io-client';

declare global {
  interface Window {
    electronAPI?: {
      getLocalIP: () => string;
      getBePort: () => number | null;
    };
  }
}

export const getBeHost = () => {
  // 1. Ưu tiên: User ghi đè qua localStorage (Ví dụ kết nối tới Middle Server khác)
  const localHost = localStorage.getItem('BE_HOST');
  if (localHost) return localHost;

  // 2. Chạy trong vỏ Electron: Dùng 127.0.0.1 cho local sidecar là ổn định nhất
  if (typeof window !== 'undefined' && window.electronAPI) {
    return '127.0.0.1';
  }

  // 3. Fallback cho Dev Web: Dùng giá trị build-time VITE_BE_HOST
  return import.meta.env.VITE_BE_HOST || '127.0.0.1';
};

export const getBePort = () => {
  const localHost = localStorage.getItem('BE_HOST');
  const localPort = localStorage.getItem('BE_PORT');

  // Nếu đang chạy trong Electron, ưu tiên dùng cổng động do main process cấp nếu đang trỏ về local
  // Điều này giúp tránh dùng nhầm port cũ từ localStorage khi chạy production
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.getBePort) {
    if (!localHost || localHost === '127.0.0.1' || localHost === 'localhost') {
      const electronPort = window.electronAPI.getBePort();
      if (electronPort) return electronPort.toString();
    }
  }

  // Nếu user đã chủ động đổi host (kết nối remote), thì dùng luôn port đi kèm trong localStorage
  if (localHost && localPort) return localPort;

  if (localPort) return localPort;
  return import.meta.env.VITE_BE_PORT || '5050';
};
export const getBeUrl = () => `http://${getBeHost()}:${getBePort()}`;
const beURL = getBeUrl();

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
