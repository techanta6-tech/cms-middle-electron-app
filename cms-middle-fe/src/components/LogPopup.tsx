import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LogData } from '../types';
import { TriangleAlert, Cloud, X, ChevronRight, ChevronDown } from 'lucide-react';

export function LogPopup({ log, onClose }: { log: LogData, onClose: () => void }) {
  const { t } = useTranslation();
  const rawSnapshot = log.snapshot || log.raw?.body?.snapshot;
  const snapshot = rawSnapshot
    ? (rawSnapshot.startsWith('data:') ? rawSnapshot : `data:image/jpeg;base64,${rawSnapshot}`)
    : null;
  const onClickOutside = (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose() }
  // console.log("log ", log)
  const [isShowImgRaw, setIsShowImgRaw] = useState<boolean>(false);
  const [isShowRawData, setIsShowRawData] = useState<boolean>(false);
  const [isShowDetailed, setIsShowDetailed] = useState<boolean>(false);

  const isLPREvent = (log.log_type?.toUpperCase() === 'LPR_EVENT') || (log.raw?.body?.log_type?.toUpperCase() === 'LPR_EVENT');
  let plateNum;
  let plateConfidence;
  
  if (isLPREvent) {
    const targetList = log.raw?.body?.TargetDetectList || log.raw?.TargetDetectList;
    if (Array.isArray(targetList) && targetList.length > 0) {
      const firstPlate = targetList[0]?.PlateInfo;
      if (firstPlate) {
        plateNum = firstPlate.Plate_num;
        plateConfidence = firstPlate.Plate_confidence;
      }
    }
  }

  const allMetadata = [
    { label: 'Server ID', value: log.server?.server_id || log.raw?.body?.server?.server_id, isImportant: false },
    { label: 'Server Serial', value: log.server?.serial || log.raw?.body?.server?.serial, isImportant: true },
    { label: 'Device Name', value: log.device_name || log.raw?.body?.device_name, isImportant: true },
    { label: 'Device IP', value: log.cameraIp || log.device_ip || 'Internal', isImportant: false },
    { label: 'Device Port', value: log.raw?.body?.device_port, isImportant: false },
    { label: 'Device Index', value: log.device_index ?? log.raw?.body?.device_index, isImportant: false },
    { label: 'Device Type', value: log.device_type || log.raw?.body?.device_type, isImportant: true },
    { label: 'Log Type', value: (log.log_type || log.raw?.body?.log_type) ? t(`app.logtype.${(log.log_type || log.raw?.body?.log_type).toLowerCase()}`, { defaultValue: (log.log_type || log.raw?.body?.log_type) }) : undefined, isImportant: true },
    { label: t('app.log_popup.plate_number', { defaultValue: 'Plate Number' }), value: plateNum, isImportant: true },
    { label: t('app.log_popup.confidence', { defaultValue: 'Confidence' }), value: plateConfidence !== undefined ? `${plateConfidence}%` : undefined, isImportant: true },
    { label: 'Description', value: (log.description || log.raw?.body?.description) ? t(`app.logtype.${(log.description || log.raw?.body?.description).toLowerCase().replace(/ /g, '_').replace(/\./g, '')}`, { defaultValue: (log.description || log.raw?.body?.description) }) : undefined, isImportant: false },
    { label: 'Source IP', value: log.ip || log.raw?.ip, isImportant: false },
    { label: 'Timestamp', value: log.time ? new Date(log.time * 1000).toLocaleString() : '—', isImportant: true },
  ].filter(item => item.value !== undefined && item.value !== null && item.value !== '');

  const importantMetadata = allMetadata.filter(item => item.isImportant);
  const detailedMetadata = allMetadata.filter(item => !item.isImportant);

  const renderEventSummary = () => {
    if (log.raw?.payload?.object?.events?.length > 0) {
      return log.raw.payload.object.events.map((evt: any, idx: number) => {
        const typeVal = evt.alarm_type !== undefined ? evt.alarm_type : evt.type;
        const statusVal = evt.status !== undefined ? evt.status : evt.alarm_status;
        const typeStr = typeVal !== undefined ? t(`app.mqtt_alarm_type.${typeVal}`, { defaultValue: String(typeVal) }) : 'Unknown Type';
        const statusStr = statusVal !== undefined ? t(`app.mqtt_alarm_status.${statusVal}`, { defaultValue: String(statusVal) }) : 'Unknown Status';
        return (
          <span key={idx} className="flex items-center gap-2">
            {idx > 0 && <span className="text-on-surface-variant/50">•</span>}
            <span className="text-amber-400">{statusStr}</span>
            <span className="text-on-surface-variant/50">|</span>
            <span className="text-cyan-400">{typeStr}</span>
          </span>
        );
      });
    } else if (log.raw?.body?.log_type || log.log_type) {
      const typeStr = t(`app.logtype.${(log.raw?.body?.log_type || log.log_type).toLowerCase()}`, { defaultValue: (log.raw?.body?.log_type || log.log_type).toLowerCase() });
      const descStr = (log.raw?.body?.description || log.description) ? t(`app.logtype.${(log.raw?.body?.description || log.description).toLowerCase().replace(/ /g, '_').replace(/\./g, '')}`, { defaultValue: (log.raw?.body?.description || log.description).toLowerCase() }) : '';
      return (
        <span className="flex items-center gap-2">
          <span className="text-cyan-400">{typeStr}</span>
          {descStr && (
            <>
              <span className="text-on-surface-variant/50">:</span>
              <span className="text-amber-400">{descStr}</span>
            </>
          )}
        </span>
      );
    }
    return null;
  };

  const serverSerial = log.server?.serial || log.raw?.body?.server?.serial || 'UNKNOWN_SERVER';
  const deviceName = log.device_name || log.raw?.body?.device_name || 'UNKNOWN_DEVICE';
  const summaryContent = renderEventSummary();

  return (
    <div onClick={onClickOutside} className="log-popup-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="log-popup-container relative w-full max-w-6xl bg-surface-container-low border border-outline-variant/30 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in scale-up">
        {/* Header */}
        <div className="log-popup-header p-4 border-b border-outline-variant/20 bg-surface-container flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-sm font-black tracking-widest uppercase text-on-surface flex flex-wrap items-center gap-2">
                <span>{serverSerial} / {deviceName}</span>
                {summaryContent && (
                  <>
                    <span className="text-on-surface-variant/50">/</span>
                    {summaryContent}
                  </>
                )}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container-highest transition-colors text-on-surface-variant hover:text-on-surface"
          >
            <X className="w-4 h-4 text-white font-bold" />
          </button>
        </div>

        {/* Content */}
        <div className="log-popup-content flex-1 overflow-y-auto p-6 bg-[#0d0d0f] custom-scrollbar space-y-8">
          {/* Top: Media Evidence */}
          <section>
            <div className="bg-black rounded-sm overflow-hidden border border-outline-variant/20 relative shadow-inner max-h-[60vh] flex items-center justify-center">
              {snapshot ? (
                <img
                  src={snapshot}
                  alt="Event Evidence"
                  className="w-full h-full object-contain max-h-[60vh]"
                />
              ) : (
                <div className="w-full aspect-video flex flex-col items-center justify-center opacity-20 gap-2">
                  <Cloud className="w-10 h-10" />
                  <span className="text-[9px] uppercase font-black">{t('app.log_popup.no_media')}</span>
                </div>
              )}
            </div>
          </section>

          {/* Middle: Important Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Important System Metadata */}
            <section className="col-span-1 md:col-span-2">
              <h4 className="text-[10px] font-black uppercase text-primary tracking-[0.2em] mb-3">{t('app.log_popup.system_metadata')}</h4>
              <div className="space-y-2 p-4 bg-surface-container-lowest/30 border border-outline-variant/10 rounded-sm">
                {importantMetadata.map(item => (
                  <div key={item.label} className="flex justify-between items-center py-1.5 border-b border-outline-variant/5 last:border-0">
                    <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider">{item.label}</span>
                    <span className="text-[10px] font-mono text-on-surface font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Bottom: Detailed Metadata & Raw Data */}
          <div className="space-y-6 pt-4 border-t border-outline-variant/10">
            {/* Detailed Metadata */}
            {detailedMetadata.length > 0 && (
              <section>
                <h4
                  className="text-[10px] font-black uppercase text-primary tracking-[0.2em] mb-3 cursor-pointer flex items-center gap-1 hover:text-primary/80 transition-colors w-fit"
                  onClick={() => setIsShowDetailed(!isShowDetailed)}
                >
                  {isShowDetailed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {t('app.log_popup.detailed_metadata', { defaultValue: 'Detailed Data' })}
                </h4>
                {isShowDetailed && (
                  <div className="space-y-2 p-4 bg-black/40 rounded-sm border border-outline-variant/10 grid grid-cols-1 md:grid-cols-2 gap-x-8">
                    {detailedMetadata.map(item => (
                      <div key={item.label} className="flex justify-between items-center py-1.5 border-b border-outline-variant/5">
                        <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider">{item.label}</span>
                        <span className="text-[10px] font-mono text-on-surface font-medium">{item.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Raw Data */}
            {log.raw && (
              <section>
                <h4
                  className="text-[10px] font-black uppercase text-primary tracking-[0.2em] mb-3 cursor-pointer flex items-center gap-1 hover:text-primary/80 transition-colors w-fit"
                  onClick={() => setIsShowRawData(!isShowRawData)}
                >
                  {isShowRawData ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {t('app.log_popup.raw_data')}
                </h4>
                {isShowRawData && (
                  <div className="p-3 bg-black/40 rounded-sm border border-outline-variant/10">
                    <pre onClick={() => setIsShowImgRaw(!isShowImgRaw)} className="cursor-pointer text-[9px] font-mono text-secondary-dim overflow-x-auto custom-scrollbar leading-tight whitespace-pre-wrap">
                      {JSON.stringify(log.raw.body || log.raw, (key, value) => (key === 'snapshot' && !isShowImgRaw) ? '[IMAGE_BUFFER]' : value, 2)}
                    </pre>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="log-popup-footer p-4 bg-surface-container-lowest border-t border-outline-variant/20 flex justify-between items-center transition-all">
          <div className="flex items-center gap-2">

          </div>
          <button
            onClick={onClose}
            className="cursor-pointer px-6 py-2 bg-primary text-primary-container text-[11px] font-black uppercase tracking-widest rounded-sm hover:bg-primary/90 transition-all shadow-lg shadow-primary/10"
          >
            {t('app.log_popup.close_report')}
          </button>
        </div>
      </div>
    </div>
  );
}
