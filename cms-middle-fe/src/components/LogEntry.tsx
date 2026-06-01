import type { LogData } from '../types';
import { useTranslation } from 'react-i18next';
import { TriangleAlert, Info, AlertCircle } from 'lucide-react';

export function LogEntry({ log, onClick, mqttServers }: { log: LogData, onClick: () => void, mqttServers?: any[] }) {
  const { t } = useTranslation();

  let serverName = log.server_unique_id;
  if (log.log_source === 'milesight-radar' || log.log_source === 'milesight-button' || serverName.startsWith('mqtt-')) {
    const cleanId = serverName.replace('mqtt-', '').toLowerCase();
    const mqttSrv = (mqttServers || []).find(s => s.id?.toLowerCase() === cleanId);
    if (mqttSrv) {
      serverName = mqttSrv.name || `${mqttSrv.brokerHost}:${mqttSrv.brokerPort}`;
    } else if (log.raw?.brokerHost) {
      serverName = log.raw.brokerPort ? `${log.raw.brokerHost}:${log.raw.brokerPort}` : log.raw.brokerHost;
    }
  }
  let Icon = Info;
  const colorClass = 'text-primary';
  const bgBorderClass = 'bg-primary';

  const logType = typeof log.log_type === 'string' ? log.log_type.toLowerCase() : 'info';

  if (logType.includes('event') || logType.includes('error')) {
    Icon = AlertCircle;
  } else if (logType.includes('warning')) {
    Icon = TriangleAlert;
  }

  let displayType;
  let displayDesc;
  const source = String(log.log_source);
  switch (source) {
    case 'svms': {
      const normalizedType = log.log_type.replace(/\./g, '_');
      displayType = t(`app.logtype.svms_${normalizedType}`);
      displayDesc = t(`app.logtype.svms_${normalizedType}_description`);
      break;
    }
    case 'milesight-radar': {
      const normalizedType = log.log_type.replace(/\./g, '_');
      const descKey = log.log_description?.toLowerCase().replace(/ /g, '_').replace(/\./g, '').replace(/-/g, '_');
      displayType = t(`app.logtype.${normalizedType.startsWith('milesight_') ? normalizedType : `milesight_${normalizedType}`}`);
      const formattedKey = descKey?.startsWith('milesight_') ? descKey : `milesight_${descKey}`;
      displayDesc = descKey ? t(`app.logtype.${formattedKey}_description`, { defaultValue: log.log_description }) : t(`app.logtype.milesight_${normalizedType}_description`);
      break;
    }
    case 'milesight-button': {
      const normalizedType = log.log_type.replace(/\./g, '_');
      const descKey = log.log_description?.toLowerCase().replace(/ /g, '_').replace(/\./g, '').replace(/-/g, '_');
      displayType = t(`app.logtype.${normalizedType.startsWith('milesight_') ? normalizedType : `milesight_${normalizedType}`}`);
      const formattedKey = descKey?.startsWith('milesight_') ? descKey : `milesight_${descKey}`;
      displayDesc = descKey ? t(`app.logtype.${formattedKey}_description`, { defaultValue: log.log_description }) : undefined;
      break;
    }
    case 'sunell-camera': {
      const normalizedType = log.log_type.replace(/\./g, '_');
      displayType = t(`app.logtype.sunell_${normalizedType}`);
      displayDesc = t(`app.logtype.sunell_${normalizedType}_description`);
      break;
    }
    default:
      displayType = t(`app.logtype.${(log.log_type || log.raw?.body?.log_type).toLowerCase().replace(/ /g, '_').replace(/\./g, '_')}`)
      if (log.log_description) {
        const descKey = log.log_description.toLowerCase().replace(/ /g, '_').replace(/\./g, '').replace(/-/g, '_');
        displayDesc = t(`app.logtype.${descKey}`, { defaultValue: log.log_description });
      }
      console.log("cant find, use: ", displayType, displayDesc, log)
  }
  const timeStr = new Date(log.receive_time).toLocaleTimeString();

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
          <span className={`log-entry-type text-[10px] font-bold ${colorClass} uppercase flex items-center gap-1.5  shrink-0`}>
            <Icon className="displayType w-3.5 h-3.5 bg-red" />
            {displayType}
          </span>
        </div>
        <p className="displayDesc text-[11px] text-on-surface mb-1 font-medium leading-relaxed truncate uppercase">{displayDesc}</p>
        {/* <div className="text-[9px] font-mono text-on-surface-variant/70 italic truncate">{serverName} // {log.device_info.name} // {timeStr}</div> */}
        <div className="text-[9px] font-mono text-on-surface-variant/70 italic truncate">{log.device_info.name} / {timeStr}</div>
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
