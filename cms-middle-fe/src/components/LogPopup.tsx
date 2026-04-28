import React, { useState } from 'react';
import type { LogData } from '../types';
import { TriangleAlert, Cloud, X } from 'lucide-react';

export function LogPopup({ log, onClose }: { log: LogData, onClose: () => void }) {
  const rawSnapshot = log.snapshot || log.raw?.body?.snapshot;
  const snapshot = rawSnapshot
    ? (rawSnapshot.startsWith('data:') ? rawSnapshot : `data:image/jpeg;base64,${rawSnapshot}`)
    : null;
  const onClickOutside = (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose() }
  // console.log("log ", log)
  const [isShowImgRaw, setIsShowImgRaw] = useState<Boolean>(false)
  return (
    <div onClick={onClickOutside} className="log-popup-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="log-popup-container relative w-full max-w-3xl bg-surface-container-low border border-outline-variant/30 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in scale-up">
        {/* Header */}
        <div className="log-popup-header p-4 border-b border-outline-variant/20 bg-surface-container flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* <div className={`w-2 h-10 rounded-full ${log.type === 'error' ? 'bg-tertiary' :
              log.type === 'warning' ? 'bg-amber-400' :
                log.type === 'success' ? 'bg-secondary' : 'bg-primary'
              }`}></div> */}
            <div>
              <h3 className="text-sm font-black tracking-widest uppercase text-on-surface">{log.raw?.body?.server?.serial} / {log.raw?.body?.device_name} / DETAILED_REPORT</h3>
              <p className="text-[10px] text-on-surface-variant font-mono">{log.time} • {log.cameraIp || 'SYSTEM'}</p>
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
        <div className="log-popup-content flex-1 overflow-y-auto p-6 bg-[#0d0d0f] custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Info & Metadata */}
            <div className="space-y-6">
              <section>
                <h4 className="text-[10px] font-black uppercase text-primary tracking-[0.2em] mb-3">Event Summary</h4>
                <div className="p-4 bg-surface-container-lowest/50 border border-outline-variant/10 rounded-sm">
                  <p className="text-[12px] font-mono text-on-surface font-medium leading-relaxed">
                    {log.raw?.body?.log_type?.toLowerCase()} : {log.raw?.body?.description?.toLowerCase()}
                  </p>
                </div>
              </section>

              <section>
                <h4 className="text-[10px] font-black uppercase text-primary tracking-[0.2em] mb-3">System Metadata</h4>
                <div className="space-y-2">
                  {[
                    { label: 'Server ID', value: log.server?.server_id || log.raw?.body?.server?.server_id },
                    { label: 'Server Serial', value: log.server?.serial || log.raw?.body?.server?.serial },
                    { label: 'Device Name', value: log.device_name || log.raw?.body?.device_name },
                    { label: 'Device IP', value: log.cameraIp || log.device_ip || 'Internal' },
                    { label: 'Device Port', value: log.raw?.body?.device_port },
                    { label: 'Device Index', value: log.device_index ?? log.raw?.body?.device_index },
                    { label: 'Device Type', value: log.device_type || log.raw?.body?.device_type },
                    { label: 'Log Type', value: log.log_type || log.raw?.body?.log_type },
                    { label: 'Description', value: log.description || log.raw?.body?.description },
                    { label: 'Source IP', value: log.ip || log.raw?.ip },
                    { label: 'Timestamp', value: log.time ? new Date(log.time * 1000).toLocaleString() : '—' },
                  ].filter(item => item.value !== undefined && item.value !== null && item.value !== '').map(item => (
                    <div key={item.label} className="flex justify-between items-center py-1.5">
                      <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider">{item.label}</span>
                      <span className="text-[10px] font-mono text-on-surface font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Right: Media Evidence */}
            <div className="space-y-6">
              <section>
                <div className="aspect-video bg-black rounded-sm overflow-hidden border border-outline-variant/20 relative shadow-inner">
                  {snapshot ? (
                    <img
                      src={snapshot}
                      alt="Event Evidence"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center opacity-20 gap-2">
                      <Cloud className="w-10 h-10" />
                      <span className="text-[9px] uppercase font-black">No media packet attached</span>
                    </div>
                  )}
                </div>
              </section>
              {log.raw && (
                <section>
                  <h4 className="text-[10px] font-black uppercase text-primary tracking-[0.2em] mb-3">Raw Data Packet</h4>
                  <div className="p-3 bg-black/40 rounded-sm border border-outline-variant/10">
                    <pre onClick={() => setIsShowImgRaw(!isShowImgRaw)} className="cursor-pointer text-[9px] font-mono text-secondary-dim overflow-x-auto custom-scrollbar leading-tight whitespace-pre-wrap">
                      {JSON.stringify(log.raw.body || log.raw, (key, value) => (key === 'snapshot' && !isShowImgRaw) ? '[IMAGE_BUFFER]' : value, 2)}
                    </pre>
                  </div>
                </section>
              )}
            </div>
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
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
}
