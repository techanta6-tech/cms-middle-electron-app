const net = require('net');
const cron = require('node-cron');
const { servers } = require('../socketState');
const { port: defaultPort, SVMS_PORT_LIST } = require('../config');

// Sử dụng SVMS_PORT_LIST từ config (đọc từ .env hoặc fallback)
const TARGET_PORTS = SVMS_PORT_LIST;
let monitorTask = null;

/**
 * Pings a server using TCP connection
 * @param {string} ip 
 * @param {number} port 
 * @returns {Promise<{online: boolean, duration?: number, port: number}>}
 */
const pingServer = (ip, port) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const startTime = Date.now();

    // 3 seconds timeout for ping
    socket.setTimeout(3000);

    socket.on('connect', () => {
      const duration = Date.now() - startTime;
      socket.destroy();
      resolve({ online: true, duration, port });
    });

    socket.on('error', () => {
      socket.destroy();
      resolve({ online: false, port });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ online: false, port });
    });
    socket.connect(port, ip);
  });
};

/**
 * Starts the background monitoring task
 */
const startMonitoring = () => {
  if (monitorTask) return monitorTask;
  console.log(`⏲️  Monitoring service initialized (30s interval). Testing ports: ${TARGET_PORTS.join(', ')}`);

  // Run every 30 seconds
  monitorTask = cron.schedule('*/30 * * * * *', async () => {
    const timestamp = new Date().toLocaleString();

    if (servers.size === 0) {
      // console.log(`[${timestamp}] [MONITOR] No servers registered to ping.`);
      return;
    }

    console.log(`\n[${timestamp}] 📡 MULTI-PORT HEALTH CHECK (${servers.size} servers)`);

    const checkPromises = [];

    for (const [id, serverData] of servers.entries()) {
      const ip = serverData.svms_ipv4_ip || serverData.server_ip || serverData.sender_ip;
      const name = serverData.server_name || id;

      // Với mỗi server, tạo promise kiểm tra cho tất cả các port mục tiêu
      TARGET_PORTS.forEach(port => {
        checkPromises.push(
          pingServer(ip, port).then(res => ({
            Server: name,
            IP: ip,
            Port: port,
            Status: res.online ? '✅ ONLINE' : '❌ OFFLINE',
            Latency: res.duration ? `${res.duration}ms` : '-'
          }))
        );
      });
    }

    // Chờ tất cả các kết quả hoàn tất song song
    const allResults = await Promise.all(checkPromises);

    // Sắp xếp kết quả để dễ quan sát
    allResults.sort((a, b) => a.Server.localeCompare(b.Server) || a.Port - b.Port);

    console.table(allResults);
  });

  return monitorTask;
};

const stopMonitoring = () => {
  if (!monitorTask) return;
  monitorTask.stop();
  monitorTask = null;
};

module.exports = { startMonitoring, stopMonitoring };

