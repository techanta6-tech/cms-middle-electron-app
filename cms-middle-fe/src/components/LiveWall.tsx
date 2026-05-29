/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CameraOff, X, Settings, ZoomIn, ZoomOut, Maximize, Minimize, RefreshCw, AlertTriangle, Activity } from 'lucide-react';
import apiClient from '../api/apiClient';

export type LiveGridItem = {
  gridID: number;
  camera?: {
    id: string;
    name: string;
    cameraIp: string;
    rtspUrl: string;
    type: string;
  };
};

export function LiveWall({
  cameraDevices,
  isFullscreen,
  setIsFullscreen
}: {
  cameraDevices: any[];
  isFullscreen?: boolean;
  setIsFullscreen?: (val: boolean) => void;
}) {
  const { t } = useTranslation();
  const [showGridSettings, setShowGridSettings] = useState(false);
  const [gridCols, setGridCols] = useState<number>(() => {
    const saved = localStorage.getItem('LIVE_WALL_GRID_COLS');
    return saved ? Number(saved) : 3;
  });

  const [grids, setGrids] = useState<LiveGridItem[]>(() => {
    const saved = localStorage.getItem('LIVE_WALL_GRIDS');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse LIVE_WALL_GRIDS', e);
      }
    }
    return [];
  });

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem('LIVE_WALL_GRID_COLS', String(gridCols));
  }, [gridCols]);

  useEffect(() => {
    localStorage.setItem('LIVE_WALL_GRIDS', JSON.stringify(grids));
  }, [grids]);

  const baseURL = useMemo(() => {
    return String(apiClient.defaults.baseURL || '').replace(/\/$/, '');
  }, []);

  const handleDecGrid = () => {
    if (gridCols > 1) setGridCols(gridCols - 1);
  };

  const handleIncGrid = () => {
    if (gridCols < 6) setGridCols(gridCols + 1);
  };

  const handleFullscreenToggle = () => {
    const nextVal = !isFullscreen;
    if (nextVal) {
      document.documentElement.requestFullscreen().catch(err => console.error('Error entering fullscreen:', err));
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(err => console.error('Error exiting fullscreen:', err));
    }
    setIsFullscreen?.(nextVal);
  };

  // Drag and drop cameras into grid cells
  const handleDrop = (e: React.DragEvent, gridIndex: number) => {
    e.preventDefault();
    e.currentTarget.classList.remove('ring-2', 'ring-primary', 'ring-inset');
    const rawData = e.dataTransfer.getData('application/json');
    if (!rawData) return;

    try {
      const data = JSON.parse(rawData);
      // Filter out non-camera devices if dragged
      if (data.device_type !== 'sunell' && data.device_type !== 'camera' && data.device_type !== 'vms') {
        return;
      }

      // Find the corresponding camera configuration
      const camConfig = cameraDevices.find(c => c.id === data.device_ip || c.id === data.id);
      if (!camConfig) return;

      const newCamera = {
        id: camConfig.id,
        name: camConfig.name || camConfig.cameraIp,
        cameraIp: camConfig.cameraIp,
        rtspUrl: camConfig.rtspUrl || '',
        type: camConfig.type || 'vms'
      };

      setGrids(prev => {
        const clone = [...prev];
        const nextItem = { gridID: gridIndex, camera: newCamera };
        clone[gridIndex] = nextItem;
        return clone;
      });

      // Send REST request to backend to start the RTSP stream
      apiClient.post('/api/v1/rtsp-streams', {
        id: newCamera.id,
        rtspUrl: newCamera.rtspUrl
      }).catch(err => {
        console.error(`Failed to start RTSP stream for ${newCamera.id}:`, err);
      });

    } catch (err) {
      console.error('Drag drop error:', err);
    }
  };

  const handleRemoveCamera = useCallback((gridIndex: number, cameraId: string) => {
    setGrids(prev => {
      const clone = [...prev];
      delete clone[gridIndex];
      return clone;
    });

    // Optionally notify backend to stop this connection to save CPU
    apiClient.delete(`/api/v1/rtsp-streams/${cameraId}`).catch(err => {
      console.error(`Failed to stop RTSP stream for ${cameraId}:`, err);
    });
  }, []);

  return (
    <div className="LiveWall flex-1 p-2 overflow-y-auto custom-scrollbar bg-surface-container-low/20 flex flex-col">
      <div
        className="relative h-full w-full grid gap-1.5 flex-1"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridCols}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: Math.pow(gridCols, 2) }).map((_, idx) => {
          const gridItem = grids[idx];
          const hasCamera = !!gridItem?.camera;

          return (
            <div
              key={idx}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('ring-2', 'ring-primary', 'ring-inset');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('ring-2', 'ring-primary', 'ring-inset');
              }}
              onDrop={(e) => handleDrop(e, idx)}
              className={`relative group camera-feed-item h-full w-full bg-surface-container-low/50 border border-outline-variant/10 rounded-sm overflow-hidden transition-all flex flex-col`}
            >
              {hasCamera && gridItem.camera ? (
                <LiveStreamPlayer
                  camera={gridItem.camera}
                  onRemove={() => handleRemoveCamera(idx, gridItem.camera!.id)}
                />
              ) : (
                <div className="no-camera w-full h-full flex flex-col items-center justify-center opacity-30 gap-2 text-center px-4 py-2 select-none">
                  <CameraOff className={`w-8 h-8 transition-all`} />
                  <span className="text-[10px] uppercase tracking-widest font-bold">
                    {t('app.alert_wall.drag_to_assign', 'Kéo camera vào đây')}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {/* Floating Settings Panels */}
        <div className="absolute bottom-4 right-4 opacity-25 hover:opacity-100 transition-all duration-300 z-50 flex flex-col gap-2">
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
              <div className="flex flex-col gap-1">
                <button
                  onClick={handleDecGrid}
                  className="p-2.5 bg-surface-container hover:bg-surface-container-highest text-on-surface rounded-full transition-colors group cursor-pointer"
                  title={t('app.alert_wall.dec_grid')}
                >
                  <ZoomIn className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>
                <button
                  onClick={handleIncGrid}
                  className="p-2.5 bg-surface-container hover:bg-surface-container-highest text-on-surface rounded-full transition-colors group cursor-pointer"
                  title={t('app.alert_wall.inc_grid')}
                >
                  <ZoomOut className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>
                <button
                  onClick={handleFullscreenToggle}
                  className="p-2.5 bg-surface-container hover:bg-surface-container-highest text-on-surface rounded-full transition-colors group cursor-pointer"
                  title={isFullscreen ? t('app.alert_wall.exit_fullscreen', 'Thoát toàn màn hình') : t('app.alert_wall.enter_fullscreen', 'Toàn màn hình')}
                >
                  {isFullscreen ? <Minimize className="w-4 h-4 group-hover:scale-110 transition-transform" /> : <Maximize className="w-4 h-4 group-hover:scale-110 transition-transform" />}
                </button>
              </div>
              <div className="h-[1px] w-full bg-outline-variant/20 my-0.5" />
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

// Subcomponent responsible for loading specific stream frames and monitoring status
function LiveStreamPlayer({
  camera,
  onRemove
}: {
  camera: { id: string; name: string; cameraIp: string; rtspUrl: string; type: string };
  onRemove: () => void;
}) {
  const [streamInfo, setStreamInfo] = useState<any>(null);
  const [frameUrl, setFrameUrl] = useState<string>('');
  const [checkInterval, setCheckInterval] = useState<number>(2000);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [fetchErrorCount, setFetchErrorCount] = useState(0);

  // Monitor the stream connection state periodically from backend
  useEffect(() => {
    let active = true;

    // Fast initial check, then periodic
    const checkState = async () => {
      try {
        const { data } = await apiClient.get(`/api/v1/rtsp-streams/${camera.id}`);
        if (!active) return;
        if (data.success && data.stream) {
          setStreamInfo(data.stream);
          setFetchErrorCount(0);

          // If running, set fast interval for smooth rendering
          if (data.stream.status === 'running') {
            setCheckInterval(2000); // Check status less often if already running
          } else {
            setCheckInterval(3000);
          }
        }
      } catch {
        if (!active) return;
        setFetchErrorCount(prev => prev + 1);
        if (fetchErrorCount > 3) {
          setStreamInfo({ status: 'error', lastError: 'Could not fetch stream status from BE' });
        }
      }
    };

    checkState();
    const timer = setInterval(checkState, checkInterval);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [camera.id, checkInterval, fetchErrorCount]);

  // Fetch the actual image frames securely via POST with blob response
  useEffect(() => {
    if (streamInfo?.status !== 'running') return;

    let active = true;
    let timer: any = null;

    const fetchFrame = async () => {
      try {
        const response = await apiClient.post(`/api/v1/rtsp-streams/${camera.id}/snapshot?format=image`, {}, {
          responseType: 'blob',
          headers: {
            'Accept': 'image/jpeg'
          }
        });
        
        if (!active) return;
        
        const blob = response.data;
        const objectUrl = URL.createObjectURL(blob);
        
        setFrameUrl(prev => {
          if (prev) URL.revokeObjectURL(prev); // clean up old memory
          return objectUrl;
        });
      } catch (err) {
        console.warn('Failed to fetch snapshot frame:', err);
      }
    };

    fetchFrame();
    timer = setInterval(fetchFrame, 1000); // 1 FPS refresh rate on frontend

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [streamInfo?.status, camera.id]);

  // Cleanup objectUrl on unmount
  useEffect(() => {
    return () => {
      if (frameUrl) {
        URL.revokeObjectURL(frameUrl);
      }
    };
  }, [frameUrl]);

  // Re-probe / Re-connect helper
  const handleReconnect = useCallback(() => {
    apiClient.post('/api/v1/rtsp-streams', {
      id: camera.id,
      rtspUrl: camera.rtspUrl
    }).then(() => {
      setStreamInfo(prev => prev ? { ...prev, status: 'connecting' } : null);
    }).catch(err => {
      console.error('Failed to manually trigger reconnect:', err);
    });
  }, [camera.id, camera.rtspUrl]);

  const streamStatus = streamInfo?.status || 'connecting';
  const showStreamImage = streamStatus === 'running' && !!frameUrl;

  return (
    <div className="LiveStreamPlayer flex-1 relative bg-black flex flex-col justify-between overflow-hidden h-full w-full">
      {/* Video stream container */}
      <div className="flex-1 w-full h-full relative overflow-hidden flex items-center justify-center">
        {showStreamImage ? (
          <img
            src={frameUrl}
            alt={camera.name}
            className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-30'}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageLoaded(false)}
            key={camera.id}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-3 select-none text-center bg-zinc-950/90 text-on-surface/60">
            {streamStatus === 'connecting' ? (
              <div className="flex flex-col items-center gap-3">
                <Activity className="w-7 h-7 text-primary animate-pulse" />
                <span className="text-[10px] uppercase font-bold tracking-widest text-primary animate-pulse">Connecting RTSP Stream...</span>
                <span className="text-[9px] opacity-70 truncate max-w-[200px]">{camera.cameraIp}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 max-w-[90%]">
                <AlertTriangle className="w-7 h-7 text-error" />
                <span className="text-[10px] uppercase font-bold tracking-widest text-error">Stream Connection Failed</span>
                <p className="text-[9px] opacity-70 line-clamp-2 mt-1 break-all bg-error/10 border border-error/20 p-1.5 rounded-sm max-h-[50px] overflow-y-auto">
                  {streamInfo?.lastError || 'Unknown connection error'}
                </p>
                <button
                  onClick={handleReconnect}
                  className="mt-2 text-[9px] font-bold uppercase tracking-widest bg-primary/20 hover:bg-primary text-white border border-primary/30 px-3 py-1 rounded-sm flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Retry Connect
                </button>
              </div>
            )}
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
      </div>

      {/* Floating Header & Labels */}
      <div className="absolute top-2 left-2 z-10 flex flex-col max-w-[80%] pointer-events-none">
        <span className="text-[9px] font-bold text-white tracking-widest bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-sm border border-outline-variant/10 truncate">
          {camera.name.toUpperCase()}
        </span>
        <span className="text-[8px] text-zinc-400 font-mono mt-0.5 drop-shadow-md ml-1 truncate">
          {camera.cameraIp}
        </span>
      </div>

      {/* Connection Indicator Icon */}
      {showStreamImage && (
        <div className="absolute top-2 right-12 z-10 flex items-center gap-1 pointer-events-none bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-sm border border-outline-variant/10">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
          </span>
          <span className="text-[7.5px] font-black uppercase text-emerald-400 tracking-wider">LIVE</span>
        </div>
      )}

      {/* Close button to clear the grid cell */}
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 absolute top-0 right-0 z-25 w-9 h-9 bg-gradient-to-bl from-black/90 from-[50%] to-transparent to-[50%] hover:from-error/90 transition-all duration-200 cursor-pointer text-zinc-300 hover:text-white flex items-start justify-end p-1.5"
        title="Remove camera stream"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
