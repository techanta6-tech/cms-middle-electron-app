const path = require('path');
const { CameraDevice } = require('./cameraModule');

const SDK_PATH = process.env.IS_PACKAGED === 'true'
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'cms-middle-be', 'src', 'module', 'sunell')
  : path.join(__dirname, 'cms-middle-be', 'src', 'module', 'sunell');

console.log('--- TEST SUNELL CAMERA LPR ---');
console.log('Using SDK Path:', SDK_PATH);

const testCamera = new CameraDevice({
  id: 'test-camera-lpr',
  rtspUrl: 'rtsp://192.168.1.208:554/snl/live/1/1',
  snapshotDir: path.join(__dirname, 'test-snapshots'),
  sdkPath: SDK_PATH,
  cameraIp: '192.168.1.208',
  cameraPort: 30001, // Port SDK Sunell mac dinh
  cameraUser: 'admin',
  cameraPass: 'admin1234',
  logger: (direction, label, data) => {
    const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const arrow = direction === 'IN' ? '⬇️' : '⬆️';
    console.log(`[${ts}] ${arrow} | ${label}`, data ? JSON.stringify(data).substring(0, 200) + '...' : '');
  },
  onAlarm: (rawJsonStr) => {
    console.log('\n=============================================');
    console.log(`🚨 [NHẬN SỰ KIỆN THÔNG MINH]`);
    
    try {
      // In ra dạng object đẹp
      const data = typeof rawJsonStr === 'string' ? JSON.parse(rawJsonStr) : rawJsonStr;
      console.log(JSON.stringify(data, null, 2));
    } catch (e) {
      console.log('Du lieu raw:', rawJsonStr);
    }
    console.log('=============================================\n');
  }
});

async function run() {
  console.log('Dang ket noi den camera...');
  try {
    const result = await testCamera.connectCamera();
    console.log('\n✅ Ket qua ket noi:', result);

    if (result.online) {
      console.log('🚀 DANG LANG NGHE SU KIEN (Nhan dien khuon mat / Bien so xe)...');
      console.log('Nhan Ctrl+C de thoat va ngat ket noi.\n');

      // Cho nghe su kien trong 5 phut (hoac bam Ctrl+C de dung)
      setTimeout(async () => {
        console.log('Het thoi gian chay thu (5 phut). Dang ngat ket noi...');
        await testCamera.disconnectCamera();
        process.exit(0);
      }, 5 * 60 * 1000);

    } else {
      console.error('❌ Khong the ket noi den camera. Kiem tra lai IP, Port, Username, Password.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Loi khi chay:', error);
    process.exit(1);
  }
}

// Xy ly khi bam Ctrl+C
process.on('SIGINT', async () => {
  console.log('\nNhan duoc lenh dung (Ctrl+C). Dang ngat ket noi camera...');
  try {
    await testCamera.disconnectCamera();
    console.log('Ngat ket noi thanh cong. Thoat chuong trinh.');
  } catch (e) {
    console.error('Loi khi ngat ket noi:', e);
  }
  process.exit(0);
});

run();
