import type { LogData } from '../types';
import { useTranslation } from 'react-i18next';
import { TriangleAlert, Info, AlertCircle } from 'lucide-react';

export function LogEntry({ log, onClick }: { log: LogData, onClick: () => void }) {
  const { t } = useTranslation();
  let Icon = Info;
  const colorClass = 'text-primary';
  const bgBorderClass = 'bg-primary';

  const logType = typeof log.log_type === 'string' ? log.log_type.toLowerCase() : 'info';

  if (logType.includes('event') || logType.includes('error')) {
    Icon = AlertCircle;
  } else if (logType.includes('warning')) {
    Icon = TriangleAlert;
  }

  let displayDesc = log.description;
  if (displayDesc) {
    const descKey = displayDesc.toLowerCase().replace(/ /g, '_').replace(/\./g, '');
    displayDesc = t(`app.logtype.${descKey}`, { defaultValue: displayDesc });
  }

  if (log.source === 'mqtt') {
    let evt = log.raw?.event;
    if (!evt && log.raw?.payload?.object?.events?.length > 0) {
      evt = log.raw.payload.object.events[0];
    }
    if (evt) {
      const typeVal = evt.alarm_type !== undefined ? evt.alarm_type : evt.type;
      if (typeVal !== undefined) {
        displayDesc = t(`app.mqtt_alarm_type.${typeVal}`, { defaultValue: String(typeVal) });
      }
    }
  }

  let displayType = typeof log.log_type === 'string' ? t(`app.logtype.${log.log_type.toLowerCase()}`, { defaultValue: log.log_type.toUpperCase() }).toUpperCase() : 'INFO';
  if (log.source === 'mqtt' && log.log_type === 'data') {
    displayType = t('app.alert_wall.alert');
  }

  const timeStr = new Date(log.time * 1000).toLocaleTimeString();

  return (
    <div
      onClick={() => onClick()}
      className="log-entry-item
      flex items-center justify-between gap-3
      relative bg-surface-container-high/40 rounded-r-sm group hover:bg-surface-container-high transition-colors border-l-0 cursor-pointer py-1"
    >
      <div className='h-full flex flex-col pl-3 flex-1 min-w-0'>
        <div className={`log-entry-indicator absolute left-0 top-0 bottom-0 w-1 ${bgBorderClass}`}></div>
        <div className="flex items-start mb-1 gap-4">
          <span className={`log-entry-type text-[10px] font-bold ${colorClass} uppercase flex items-center gap-1.5 shrink-0`}>
            <Icon className="w-3.5 h-3.5" />
            {displayType}
          </span>
        </div>
        <p className="text-[11px] text-on-surface mb-1 font-medium leading-relaxed truncate uppercase">{displayDesc}</p>
        <div className="text-[9px] font-mono text-on-surface-variant/70 italic truncate">{log.server.server_id} // {log.device_name} // {timeStr}</div>
      </div>
      {log.snapshot && (
        <div className="rounded-sm overflow-hidden border border-outline-variant/20 shrink-0 w-24 mr-2">
          <img
            src={log.snapshot.startsWith('data:image') ? log.snapshot : `data:image/jpeg;base64,${log.snapshot}`}
            alt="Snapshot"
            className="w-full h-auto object-contain max-h-20 bg-black/20"
          />
        </div>
      )}
    </div>
  );
}
