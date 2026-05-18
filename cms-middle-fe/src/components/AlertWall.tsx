import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceData, LogData, DeviceCameraLink } from '../types';
import { CameraOff, X, Settings, Camera, ZoomIn, ZoomOut } from 'lucide-react';
import { CameraFeed } from './CameraFeed';

export function AlertWall({
  logs,
  cameras,
  deviceCameraLinks,
  onSelectLog,
  gridCols,
  setGridCols,
  grids,
  setGrids
}: {
  logs: LogData[],
  cameras: DeviceData[],
  deviceCameraLinks: DeviceCameraLink[],
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
  const { t } = useTranslation();
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
          const isMqttSensor = gridItem?.device?.device_type === 'mqtt-sensor';

          // ── MQTT Sensor Device: 3-case render logic ──
          let mqttRenderState: 'waiting' | 'black' | 'snapshot' | null = null;
          let mqttCameraLog: LogData | undefined;

          if (isMqttSensor && gridItem) {
            const devEui = gridItem.device.device_ip;
            const mqttServerId = gridItem.device.server_serial;
            const link = deviceCameraLinks.find(l => l.devEui === devEui && l.mqttServerId === mqttServerId);
            const hasCamera = !!link?.cameraId;

            // Tìm log mới nhất từ device này (từ cuối mảng do logs lưu theo thứ tự cũ -> mới)
            let latestLog: LogData | undefined;
            for (let i = logs.length - 1; i >= 0; i--) {
              const log = logs[i];
              if (log.log_source === 'milesight-radar' && log.device_info?.id === devEui && log.server_unique_id === `mqtt-${mqttServerId}`) {
                latestLog = log;
                break;
              }
            }

            if (latestLog) {
              mqttCameraLog = latestLog;
            }

            if (latestLog && latestLog.snapshot) {
              // ƯU TIÊN 1: Có log + có snapshot → show ảnh (kể cả khi frontend chưa kịp đồng bộ link camera)
              mqttRenderState = 'snapshot';
            } else if (!hasCamera) {
              // TRƯỜNG HỢP 2: Chưa liên kết camera → background đen
              mqttRenderState = 'black';
            } else if (hasCamera && !latestLog) {
              // TRƯỜNG HỢP 3: Đã liên kết nhưng chưa có log → "Đang chờ Log"
              mqttRenderState = 'waiting';
            } else {
              // TRƯỜNG HỢP 4: Đã liên kết + có log nhưng log không có snapshot → background đen
              mqttRenderState = 'black';
            }
          }

          // ── SVMS / Sunell Camera logic ──
          let camera: any = undefined;
          if (!isMqttSensor && gridItem) {
            if (gridItem.device.device_type === 'sunell') {
              camera = {
                ip: gridItem.device.device_ip,
                name: gridItem.device.device_name,
                server_id: gridItem.device.server_id,
                server_serial: gridItem.device.server_serial,
                type: 'sunell'
              };
            } else {
              camera = cameraList.find(dev =>
                dev.ip === gridItem.device.device_ip
                && dev.name === gridItem.device.device_name
                && dev.server_id === gridItem.device.server_id
                && dev.server_serial === gridItem.device.server_serial
              );
            }
          }

          let cameraLog: LogData | undefined;
          if (camera) {
            for (let i = logs.length - 1; i >= 0; i--) {
              const log = logs[i];
              if (camera.type === 'sunell') {
                if (log.log_source === 'sunell-camera' && log.device_info?.id === camera.ip) {
                  cameraLog = log;
                  break;
                }
              } else {
                if (
                  log.device_info?.id === camera.ip &&
                  log.device_info?.name === camera.name &&
                  (log.server_unique_id === camera.server_id || log.server_unique_id === camera.server_serial)
                ) {
                  cameraLog = log;
                  break;
                }
              }
            }
          }

          const hasDevice = !!gridItem;

          // KHU VỰC 3: LOGIC SỰ KIỆN KÉO THẢ (DRAG & DROP) CHO TỪNG Ô COMPONENT
          return (
            <div
              key={idx}
              // Xác nhận có cho phép kéo để chuyển sang ô khác
              draggable={hasDevice}
              onDragStart={(e) => {
                if (!gridItem) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData('application/json', JSON.stringify({
                  ...gridItem.device,
                  sourceFieldIndex: idx
                }));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('ring-2', 'ring-primary', 'ring-inset');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('ring-2', 'ring-primary', 'ring-inset');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('ring-2', 'ring-primary', 'ring-inset');

                const data = e.dataTransfer.getData('application/json');
                if (data) {
                  try {
                    const parsed = JSON.parse(data);
                    setGrids(prev => {
                      const clone = [...prev];
                      const sourceIndex = parsed.sourceFieldIndex;

                      if (sourceIndex !== undefined && sourceIndex !== idx) {
                        const targetItem = clone[idx];
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
                        if (targetItem) {
                          clone[sourceIndex] = { ...targetItem, gridID: sourceIndex };
                        } else {
                          delete clone[sourceIndex];
                        }
                      } else if (sourceIndex === undefined) {
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
                  } catch { /* ignore invalid JSON */ }
                }
              }}
              className={`relative group camera-feed-item h-full w-full bg-surface-container-low/50 border border-outline-variant/10 rounded-xs overflow-hidden transition-all ${hasDevice ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {/* KHU VỰC 4: RENDER GIAO DIỆN THEO TRẠNG THÁI */}

              {/* ── MQTT Sensor rendering ── */}
              {isMqttSensor && mqttRenderState === 'snapshot' && mqttCameraLog ? (
                <>
                  <CameraFeed key={idx} cam={mqttCameraLog} onClick={() => onSelectLog(mqttCameraLog!)} />
                  {/* Remove button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setGrids(prev => { const c = [...prev]; delete c[idx]; return c; }); }}
                    className="opacity-0 group-hover:opacity-100 absolute top-0 right-0 z-10 w-10 h-10 bg-gradient-to-bl from-surface-container-high/90 from-[50%] to-transparent to-[50%] hover:from-primary/90 transition-all duration-300 cursor-pointer text-on-surface hover:text-white group flex items-start justify-end p-[6px]"
                  >
                    <div className="w-3 h-3 flex items-center justify-center"><X className="w-full h-full" /></div>
                  </button>
                  <div className="opacity-0 group-hover:opacity-100 absolute bottom-0 left-0 z-10 w-full bg-surface-container-high/70 backdrop-blur-md shadow-[0_-5px_15px_rgba(0,0,0,0.2)] border-t border-outline-variant/10 transition-all duration-300 pointer-events-none px-3 py-1 text-[12px]">
                    🔗 {gridItem?.device.device_name}
                  </div>
                </>
              ) : isMqttSensor && mqttRenderState === 'black' ? (
                <>
                  <div
                    className={`no-camera w-full h-full flex flex-col items-center justify-center gap-[10%] text-center px-4 py-2 bg-black ${mqttCameraLog ? 'cursor-pointer hover:bg-surface-container-highest/50' : ''}`}
                    onClick={() => mqttCameraLog && onSelectLog(mqttCameraLog)}
                  >
                    <Camera className={`opacity-30 ${gridCols > colsBreakPoints[1] ? 'w-[80%] h-[80%]' : gridCols > colsBreakPoints[0] ? 'w-8 h-8' : 'w-12 h-12'} transition-all`} />
                    <span className={`opacity-30 text-[9px] uppercase tracking-widest font-bold line-clamp-1 transition-all ${gridCols > colsBreakPoints[1] ? 'hidden' : ''}`}>
                      {gridItem?.device.device_name}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setGrids(prev => { const c = [...prev]; delete c[idx]; return c; }); }}
                    className="opacity-0 group-hover:opacity-100 absolute top-0 right-0 z-10 w-10 h-10 bg-gradient-to-bl from-surface-container-high/90 from-[50%] to-transparent to-[50%] hover:from-primary/90 transition-all duration-300 cursor-pointer text-on-surface hover:text-white group flex items-start justify-end p-[6px]"
                  >
                    <div className="w-3 h-3 flex items-center justify-center"><X className="w-full h-full" /></div>
                  </button>
                </>
              ) : isMqttSensor && mqttRenderState === 'waiting' ? (
                <>
                  <div className="no-camera w-full h-full flex flex-col items-center justify-center gap-[10%] text-center px-4 py-2">
                    <Camera className={`opacity-30 ${gridCols > colsBreakPoints[1] ? 'w-[80%] h-[80%]' : gridCols > colsBreakPoints[0] ? 'w-8 h-8' : 'w-12 h-12'} transition-all`} />
                    
                    <span className={`opacity-30 text-[11px] uppercase tracking-widest font-bold line-clamp-1 transition-all ${gridCols > colsBreakPoints[1] ? 'hidden' : ''}`}>
                      {t('app.alert_wall.waiting_data')}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setGrids(prev => { const c = [...prev]; delete c[idx]; return c; }); }}
                    className="opacity-0 group-hover:opacity-100 absolute top-0 right-0 z-10 w-10 h-10 bg-gradient-to-bl from-surface-container-high/90 from-[50%] to-transparent to-[50%] hover:from-primary/90 transition-all duration-300 cursor-pointer text-on-surface hover:text-white group flex items-start justify-end p-[6px]"
                  >
                    <div className="w-3 h-3 flex items-center justify-center"><X className="w-full h-full" /></div>
                  </button>
                </>

                /* ── SVMS Camera rendering (original logic) ── */
              ) : camera ? (
                <>
                  {cameraLog && cameraLog.snapshot ? (
                    <CameraFeed key={idx} cam={cameraLog} onClick={() => onSelectLog(cameraLog!)} />
                  ) : (
                    <div
                      className={`no-camera w-full h-full flex flex-col items-center justify-center gap-[10%] text-center px-4 py-2 bg-black ${cameraLog ? 'cursor-pointer hover:bg-surface-container-highest/50' : ''}`}
                      onClick={() => cameraLog && onSelectLog(cameraLog)}
                    >
                      <Camera className={`opacity-30 ${gridCols > colsBreakPoints[1] ? 'w-[80%] h-[80%]' : gridCols > colsBreakPoints[0] ? 'w-8 h-8' : 'w-12 h-12'} transition-all`} />
                      <span className={`opacity-30 text-[11px] uppercase tracking-widest font-bold line-clamp-1 transition-all ${gridCols > colsBreakPoints[1] ? 'hidden' : ''}`}>
                        {cameraLog ? t('app.alert_wall.has_event', 'Có sự kiện') : t('app.alert_wall.waiting_data')}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setGrids(prev => { const clone = [...prev]; delete clone[idx]; return clone; });
                    }}
                    className={`opacity-0 group-hover:opacity-100 absolute top-0 right-0 z-10 w-10 h-10 bg-gradient-to-bl from-surface-container-high/90 from-[50%] to-transparent to-[50%] hover:from-primary/90 transition-all duration-300 ease-in-out cursor-pointer text-on-surface hover:text-white group flex items-start justify-end p-[6px]`}
                  >
                    <div className="w-3 h-3 group-hover:scale-110 transition-transform opacity-70 group-hover:opacity-100 flex items-center justify-center">
                      <X className="w-full h-full" />
                    </div>
                  </button>
                  <div
                    className={`opacity-0 group-hover:opacity-100 absolute bottom-0 left-0 z-10 w-full bg-surface-container-high/70 backdrop-blur-md shadow-[0_-5px_15px_rgba(0,0,0,0.2)] border-t border-outline-variant/10 transition-all duration-300 ease-in-out pointer-events-none text-on-surface hover:text-white px-3 py-1 text-[12px]`}
                  >
                    {camera.server_id} - {camera.name}
                  </div>
                </>

                /* ── Empty cell (no device assigned) ── */
              ) : (
                <div className="no-camera w-full h-full flex flex-col items-center justify-center opacity-30 gap-[10%] text-center px-4 py-2">
                  <CameraOff className={`${gridCols > colsBreakPoints[1] ? 'w-[80%] h-[80%]' : gridCols > colsBreakPoints[0] ? 'w-8 h-8' : 'w-12 h-12'} transition-all`} />
                  <span className={`text-[11px] uppercase tracking-widest font-bold line-clamp-1 transition-all ${gridCols > colsBreakPoints[1] ? 'hidden' : ''}`}>
                    {t('app.alert_wall.no_incoming')}
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
              title={t('app.alert_wall.grid_settings')}
            >
              <Settings className="w-5 h-5 group-hover:rotate-90 transition-transform duration-500" />
            </button>
          ) : (
            <div className="flex flex-col bg-surface-container-high/50 backdrop-blur-xl p-1 rounded-full border border-outline-variant/30 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 zoom-in-95 fade-in">
              <div className='flex flex-col gap-1'>
                {/* Nút Phóng to (Zoom In): Giảm ma trận lưới (Tối thiểu phải còn 1x1) */}
                <button
                  onClick={() => gridCols > 1 && setGridCols(gridCols - 1)}
                  className="p-2.5 bg-surface-container hover:bg-surface-container-highest text-on-surface rounded-full transition-colors group cursor-pointer"
                  title={t('app.alert_wall.dec_grid')}
                >
                  <ZoomIn className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>
                {/* Nút Thu nhỏ (Zoom Out): Tăng ma trận lưới thành (gridCols+1) x (gridCols+1) */}
                <button
                  onClick={() => setGridCols(gridCols + 1)}
                  className="p-2.5 bg-surface-container hover:bg-surface-container-highest text-on-surface rounded-full transition-colors group cursor-pointer"
                  title={t('app.alert_wall.inc_grid')}
                >
                  <ZoomOut className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>
              </div>
              <div className="h-[1px] w-full bg-outline-variant/20 my-0.5" />
              {/* Nút (X): Ẩn panel Setting */}
              <button
                onClick={() => setShowGridSettings(false)}
                className="p-2.5 bg-error/10 hover:bg-surface-container-highest text-error hover:text-white rounded-full transition-all duration-300 group cursor-pointer"
                title={t('app.alert_wall.close_settings')}
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
