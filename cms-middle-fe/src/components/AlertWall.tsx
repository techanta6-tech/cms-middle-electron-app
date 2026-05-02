import { useState } from 'react';
import type { DeviceData, LogData, MqttDeviceConfig, MqttServerConfig } from '../types';
import { CameraOff, Plus, Minus, X, Settings, Camera } from 'lucide-react';
import { CameraFeed } from './CameraFeed';

export function AlertWall({
  logs,
  cameras,
  cameraDevices,
  mqttServers,
  onSelectLog,
  gridCols,
  setGridCols,
  grids,
  setGrids
}: {
  logs: LogData[],
  cameras: DeviceData[],
  cameraDevices: MqttDeviceConfig[],
  mqttServers: MqttServerConfig[],
  onSelectLog: (log: LogData) => void,
  gridCols: number,
  setGridCols: React.Dispatch<React.SetStateAction<number>>,
  grids: {
    gridID: number,
    device: {
      server_serial: string,
      server_id: string,
      device_ip: string,
      device_name: string,
      device_type: string
    }
  }[],
  setGrids: React.Dispatch<React.SetStateAction<{
    gridID: number,
    device: {
      server_serial: string,
      server_id: string,
      device_ip: string,
      device_name: string,
      device_type: string
    }
  }[]>>
}) {
  const [showGridSettings, setShowGridSettings] = useState(false);
  const colsBreakPoints = [5, 5];
  const cameraList = [
    ...cameras.flatMap(server =>
      (server.devices || []).map(dev => ({
        ...dev,
        server_serial: server.server.serial,
        server_id: server.server.server_id
      }))
    ).filter(dev => dev.type === "camera"),
    ...cameraDevices.map(cam => ({
      ip: cam.cameraIp,
      name: cam.id,
      server_serial: 'LOCAL_CAMERA',
      server_id: 'LOCAL_CAMERA',
      type: 'camera'
    }))
  ];
  // KHU VỰC 1: KHUNG CONTAINER & BỐ CỤC LƯỚI (GRID LAYOUT)
  // flex-1 để chiếm toàn bộ không gian. overflow-y-auto để cuộn nếu lưới bị quá to
  return (
    <div className="AlertWall flex-1 p-1 overflow-y-auto custom-scrollbar bg-surface-container-low/20">
      <div
        className="relative h-full w-full grid gap-0.5"
        style={{
          // Khởi tạo kích thước grid vuông dự theo state gridCols (Ví dụ: 3x3)
          gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridCols}, minmax(0, 1fr))`
        }}
      >
        {/* KHU VỰC 2: TẠO CÁC Ô TRONG LƯỚI VÀ MAP DỮ LIỆU CAMERA VÀO TỪNG Ô */}

        {/* Lặp tính toán số ô dựa theo gridCols^2 */}
        {Array.from({ length: Math.pow(gridCols, 2) }).map((_, idx) => {
          // gridItem: dữ liệu map cấu hình cho đúng ô chỉ số 'idx' hiện tại
          const gridItem = grids[idx];
          // camera: truy xuất chi tiết luồng video nếu ô này được gán device hợp lệ
          // const camera = gridItem
          //   ? logs.find(log =>
          //     log.server?.server_id === gridItem.device.server_id
          //     && log.device_ip === gridItem.device.device_ip
          //   )
          // Tìm camera trong mảng cameras (bản chất là các server -> bên trong có trường devices)
          const camera = gridItem
            ? cameraList.find(dev =>
              dev.ip === gridItem.device.device_ip
              && dev.name === gridItem.device.device_name
              && dev.server_id === gridItem.device.server_id
              && dev.server_serial === gridItem.device.server_serial
            )
            : undefined;

          let cameraLog = undefined;
          if (camera) {
            if (camera.server_id === 'LOCAL_CAMERA') {
              const matchingMqttServer = mqttServers.find(s => s.cameraId === camera.name);
              if (matchingMqttServer) {
                cameraLog = logs.find(log => log.mqttServerId === matchingMqttServer.id && log.snapshot);
              }
              if (!cameraLog) {
                // Fallback nếu chưa map nhưng có log snapshot
                cameraLog = logs.find(log => log.snapshot);
              }
            } else {
              cameraLog = logs.find((log) => log.device_ip === camera.ip && log.device_name === camera.name && log.server.server_id === camera.server_id && log.server.serial === camera.server_serial);
            }
          }
          // KHU VỰC 3: LOGIC SỰ KIỆN KÉO THẢ (DRAG & DROP) CHO TỪNG Ô COMPONENT
          return (
            <div
              key={idx}
              // Xác nhận có cho phép kéo để chuyển sang ô khác (!!! Chỉ cho phép khi có camera)
              draggable={!!camera}
              onDragStart={(e) => {
                // Sự kiện bắt đầu kéo: Đóng gói JSON mang thông tin thiết bị và vị trí gốc (sourceFieldIndex) đi
                if (!camera || !gridItem) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData('application/json', JSON.stringify({
                  ...gridItem.device,
                  sourceFieldIndex: idx
                }));
              }}
              onDragOver={(e) => {
                // PreventDefault làm cho phần Drop nhận biết được event "thả" hợp lệ
                e.preventDefault();
                // Bật sáng xanh (highlight class) của ô lưới lúc chuột đang lướt lên
                e.currentTarget.classList.add('ring-2', 'ring-primary', 'ring-inset');
              }}
              onDragLeave={(e) => {
                // Tắt sáng xanh highlight khi chuột rời đi khỏi ô
                e.currentTarget.classList.remove('ring-2', 'ring-primary', 'ring-inset');
              }}
              onDrop={(e) => {
                // Khi chuột chính thức nằm xuống / kết thúc thả
                e.preventDefault();
                e.currentTarget.classList.remove('ring-2', 'ring-primary', 'ring-inset'); // Xoá highlight

                // Trích xuất JSON data
                const data = e.dataTransfer.getData('application/json');
                if (data) {
                  try {
                    const parsed = JSON.parse(data);

                    // Cập nhật lại layout mảng grids
                    setGrids(prev => {
                      const clone = [...prev];
                      const sourceIndex = parsed.sourceFieldIndex;

                      if (sourceIndex !== undefined && sourceIndex !== idx) {
                        const targetItem = clone[idx];

                        // 1. Đặt thông tin từ nguồn vào đích
                        clone[idx] = {
                          gridID: idx,
                          device: {
                            server_serial: parsed.server_serial,
                            server_id: parsed.server_id,
                            device_ip: parsed.device_ip,
                            device_name: parsed.device_name,
                            device_type: parsed.device_type
                          }
                        };

                        // 2. Hoán đổi: Nếu ô đích có sẵn thiết bị, đưa thiết bị đó sang vị trí nguồn
                        if (targetItem) {
                          clone[sourceIndex] = {
                            ...targetItem,
                            gridID: sourceIndex
                          };
                        } else {
                          // Nếu đích trống, ta xoá vị trí cũ (thao tác di chuyển - Move)
                          delete clone[sourceIndex];
                        }
                      } else if (sourceIndex === undefined) {
                        // Trường hợp kéo từ sidebar danh sách bên ngoài thả vào
                        clone[idx] = {
                          gridID: idx,
                          device: {
                            server_serial: parsed.server_serial,
                            server_id: parsed.server_id,
                            device_ip: parsed.device_ip,
                            device_name: parsed.device_name,
                            device_type: parsed.device_type
                          }
                        };
                      }

                      return clone;
                    });
                  } catch (err) { }
                }
              }}
              className={`relative group camera-feed-item h-full w-full bg-surface-container-low/50 border border-outline-variant/10 rounded-xs overflow-hidden transition-all ${camera ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {/* KHU VỰC 4: RENDER GIAO DIỆN THEO TRẠNG THÁI (ĐÃ CÓ CAMERA HOẶC TRỐNG) */}
              {camera ? (
                <>
                  {/* Trạng Thái 1: Nếu có video -> Gọi Component CameraFeed để Stream live */}
                  {cameraLog && cameraLog.snapshot ? (
                    <CameraFeed key={idx} cam={cameraLog} onClick={() => onSelectLog(cameraLog)} />
                  ) : (
                    <div className="no-camera w-full h-full flex flex-col items-center justify-center opacity-30 gap-[10%] text-center px-4 py-2">
                      <Camera className={`${gridCols > colsBreakPoints[1] ? 'w-[80%] h-[80%]' : gridCols > colsBreakPoints[0] ? 'w-8 h-8' : 'w-12 h-12'} transition-all`} />
                      <span className={`text-[11px] uppercase tracking-widest font-bold line-clamp-1 transition-all ${gridCols > colsBreakPoints[1] ? 'hidden' : ''}`}>
                        Waiting for data stream
                      </span>
                    </div>
                  )}
                  {/* Nút (X): Nút bấm xoá Camera khỏi ô lưới đang hiển thị */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setGrids(prev => {
                        const clone = [...prev];
                        // Xoá vị trí ô và không làm dịch chuyển các ô (array shift)
                        delete clone[idx];
                        return clone;
                      });
                    }}
                    className={`opacity-0 group-hover:opacity-100 absolute top-0 right-0 z-10 w-10 h-10 bg-gradient-to-bl from-surface-container-high/90 from-[50%] to-transparent to-[50%] hover:from-primary/90 transition-all duration-300 ease-in-out cursor-pointer text-on-surface hover:text-white group flex items-start justify-end p-[6px]`}
                  >
                    <div className="w-3 h-3 group-hover:scale-110 transition-transform opacity-70 group-hover:opacity-100 flex items-center justify-center">
                      <X className="w-full h-full" />
                    </div>
                  </button>
                  {/* Footer hiển thị một số thông tin */}
                  <div
                    className={`opacity-0 group-hover:opacity-100 absolute bottom-0 left-0 z-10 w-full bg-surface-container-high/70 backdrop-blur-md shadow-[0_-5px_15px_rgba(0,0,0,0.2)] border-t border-outline-variant/10 transition-all duration-300 ease-in-out pointer-events-none text-on-surface hover:text-white px-3 py-1 text-[12px]`}
                  >
                    {camera.server_id} - {camera.name}
                  </div>
                </>
              ) : (
                <div className="no-camera w-full h-full flex flex-col items-center justify-center opacity-30 gap-[10%] text-center px-4 py-2">
                  <CameraOff className={`${gridCols > colsBreakPoints[1] ? 'w-[80%] h-[80%]' : gridCols > colsBreakPoints[0] ? 'w-8 h-8' : 'w-12 h-12'} transition-all`} />
                  <span className={`text-[11px] uppercase tracking-widest font-bold line-clamp-1 transition-all ${gridCols > colsBreakPoints[1] ? 'hidden' : ''}`}>
                    No incoming data streams detected
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {/* KHU VỰC 6: MENU TIỆN ÍCH NỔI BÊN GÓC PHẢI DƯỚI (SETTING GRID OVERLAY) */}
        <div className="absolute bottom-4 right-4 opacity-25 hover:opacity-100 transition-all duration-300 z-10 adlute bottom-4 right-4 flex flex-col gap-2">
          {!showGridSettings ? (
            <button
              onClick={() => setShowGridSettings(true)}
              className="p-2.5 bg-surface-container-high/90 hover:bg-primary/90 text-on-surface hover:text-white border border-outline-variant/30 rounded-full shadow-lg transition-all duration-300 group backdrop-blur-md cursor-pointer"
              title="Grid Settings"
            >
              <Settings className="w-5 h-5 group-hover:rotate-90 transition-transform duration-500" />
            </button>
          ) : (
            <div className="flex flex-col bg-surface-container-high/90 backdrop-blur-xl p-1.5 rounded-full border border-outline-variant/30 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 zoom-in-95 fade-in">
              <div className='flex flex-col gap-2'>
                {/* Nút Cộng: Tăng ma trận lưới thành (gridCols+1) x (gridCols+1) */}
                <button
                  onClick={() => setGridCols(gridCols + 1)}
                  className="p-2 bg-surface-container hover:bg-surface-container-highest text-on-surface rounded-full transition-colors group cursor-pointer"
                  title="Increase Grid Columns"
                >
                  <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>
                {/* Nút Trừ: Giảm ma trận lưới (Tối thiểu phải còn 1x1) */}
                <button
                  onClick={() => gridCols > 1 && setGridCols(gridCols - 1)}
                  className="p-2 bg-surface-container hover:bg-surface-container-highest text-on-surface rounded-full transition-colors group cursor-pointer"
                  title="Decrease Grid Columns"
                >
                  <Minus className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>
              </div>
              <div className="h-[1px] w-full bg-outline-variant/20 my-1" />
              {/* Nút (X): Ẩn panel Setting */}
              <button
                onClick={() => setShowGridSettings(false)}
                className="p-2 bg-error/10 hover:bg-surface-container-highest text-error hover:text-white rounded-full transition-all duration-300 group cursor-pointer"
                title="Close Settings"
              >
                <X className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
