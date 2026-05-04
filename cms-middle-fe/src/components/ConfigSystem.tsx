import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SystemConfig } from '../types';
import { Send, Cloud, Terminal } from 'lucide-react';
import { updateSocketUrlAsync } from '../socket';

export function ConfigSystem({ onSave, onClose, initialConfig }: { onSave: (config: SystemConfig) => void, onClose: () => void, initialConfig: SystemConfig }) {
  const { t } = useTranslation();
  const [FE, setFE] = useState(initialConfig.fe);
  const [BE, setBE] = useState(initialConfig.be);
  const [mode, setMode] = useState<'interface' | 'system'>('system');

  const [isConnecting, setIsConnecting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    console.log("BE: ", BE)
    const url = `http://${BE.ip}:${BE.port}`;
    setIsConnecting(true);
    const result = await updateSocketUrlAsync(url);

    // Always update system config to reflect the user's intended target
    onSave({ fe: FE, be: BE });

    if (result) {
      onClose();
    } else {
      // Connection failed, but the config is saved so the UI shows the intended target.
      // We don't close the modal so the user can easily edit and try again.
      console.warn(`[CONNECT_FAILED] Target ${url} is unreachable.`);
    }
    setIsConnecting(false);
  };

  return (
    <div className="config-system-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-300">
      <div
        className="config-system-container w-full max-w-md bg-surface-container-low border border-outline-variant/30 rounded-lg shadow-[0_0_50px_rgba(192,132,252,0.1)] overflow-hidden animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="config-system-header p-5 border-b border-outline-variant/20 bg-surface-container flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-8 bg-primary rounded-full shadow-[0_0_12px_rgba(192,132,252,0.5)]"></div>
            <div>
              <h3 className="text-sm font-black tracking-[0.2em] uppercase text-on-surface">{t('app.config_system.title')}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container-highest transition-colors text-on-surface-variant hover:text-on-surface"
          >
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="config-system-form p-8 space-y-6">
          {/* Mode Switcher */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-primary uppercase tracking-widest block ml-1 transition-colors group-focus-within:text-primary">
              {t('app.config_system.operation_mode')}
            </label>
            <div className="flex bg-black/40 p-1 rounded-sm border border-outline-variant/30">
              {/* <button
                type="button"
                onClick={() => setMode('interface')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xs text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${mode === 'interface'
                  ? 'bg-primary text-primary-container shadow-lg shadow-primary/20'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
              >
                <Inbox className={`w-3.5 h-3.5 ${mode === 'interface' ? 'animate-bounce' : ''}`} />
                Interface
              </button> */}
              <button
                disabled={initialConfig.fe.ip && initialConfig.fe.port ? false : false}
                type="button"
                onClick={() => setMode('system')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xs text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${mode === 'system'
                  ? 'bg-primary text-primary-container shadow-lg shadow-primary/20'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
              >
                <Send className={`w-3.5 h-3.5`} />
                {t('app.config_system.system')}
              </button>
            </div>
          </div>

          <div className="space-y-1.5 group">
            <label className="text-[10px] font-black text-primary uppercase tracking-widest block ml-1 transition-colors group-focus-within:text-primary">
              {t('app.config_system.target_ip')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={mode === 'interface' ? FE.ip : BE.ip}
                onChange={(e) => mode === 'interface' ? setFE({ ...FE, ip: e.target.value }) : setBE({ ...BE, ip: e.target.value })}
                placeholder="0.0.0.0"
                className="w-full bg-black/40 border border-outline-variant/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                required
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20 pointer-events-none">
                <Cloud className="w-4 h-4" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5 group">
            <label className="text-[10px] font-black text-primary uppercase tracking-widest block ml-1 transition-colors group-focus-within:text-primary">
              {t('app.config_system.access_port')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={mode === 'interface' ? FE.port : BE.port}
                onChange={(e) => mode === 'interface' ? setFE({ ...FE, port: e.target.value }) : setBE({ ...BE, port: e.target.value })}
                placeholder="5000"
                className="w-full bg-black/40 border border-outline-variant/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                required
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20 pointer-events-none">
                <Terminal className="w-4 h-4" />
              </div>
            </div>
          </div>

          <div className="pt-4 flex gap-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-outline-variant/30 text-[11px] font-black uppercase tracking-widest rounded-sm hover:bg-surface-container-high transition-all text-on-surface-variant"
            >
              {t('app.config_system.cancel')}
            </button>
            <button
              disabled={isConnecting}
              type="submit"
              className="flex-1 px-6 py-3 bg-primary text-primary-container text-[11px] font-black uppercase tracking-widest rounded-sm hover:bg-primary/90 transition-all shadow-[0_0_20px_rgba(192,132,252,0.2)]"
            >
              {isConnecting ? t('app.config_system.connecting') : t('app.config_system.confirm')}
            </button>
          </div>
        </form>

        <div className="px-8 pb-6 text-center">
          <p className="text-[9px] text-on-surface-variant/40 font-mono italic">
            {t('app.config_system.note')}
          </p>
        </div>
      </div>
    </div>
  );
}
