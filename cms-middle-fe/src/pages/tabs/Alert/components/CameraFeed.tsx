import type { LogData } from '../../../../types';

export function CameraFeed({ cam, onClick }: { cam: LogData, onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="camera-feed-container group relative bg-surface-container-lowest overflow-hidden rounded-sm border border-outline-variant/20 shadow-inner contain h-full cursor-pointer transition-all duration-300"
    >
      <img
        src={cam.snapshot?.startsWith('data:image') ? cam.snapshot : `data:image/jpeg;base64,${cam.snapshot}`}
        alt={cam.device_info?.name || cam.log_type}
        className="camera-feed-image w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-700"
        referrerPolicy="no-referrer"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40"></div>

      {/* <div className="absolute top-3 left-3 flex flex-col">
        <span className="text-[10px] font-bold text-primary tracking-widest bg-black/50 px-2 py-0.5 backdrop-blur-md rounded-sm border border-outline-variant/10">
          {cam.server?.serial?.toUpperCase() || 'UNKNOWN'} // {cam.device_name?.toUpperCase()}
        </span>
        <span className="text-[9px] text-on-surface-variant font-mono mt-1 ml-1 font-bold drop-shadow-md">
          {cam.device_ip}
        </span>
      </div> */}
    </div>
  );
}
