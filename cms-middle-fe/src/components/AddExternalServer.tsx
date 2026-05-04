import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AddExternalServerProps, MqttServerConfig } from '../types';
import { TriangleAlert, Inbox, Send, Cloud, Terminal, Radio, X } from 'lucide-react';

export function AddExternalServer({ onSave, onSaveMqtt, onClose, initialIp = '', initialPort = '', initialMode = 'receive', initialConnectionType = 'svms' }: AddExternalServerProps) {
  const { t } = useTranslation();
  // Connection type: 'svms' or 'mqtt'
  const [connectionType, setConnectionType] = useState<'svms' | 'mqtt'>(initialConnectionType);

  // SVMS fields
  const [ip, setIp] = useState(initialIp);
  const [port, setPort] = useState(initialPort);
  const [mode, setMode] = useState<'receive' | 'send'>(initialMode);

  // MQTT fields — placeholders from current .env defaults
  const [mqttProtocol, setMqttProtocol] = useState<'mqtt' | 'mqtts'>('mqtt');
  const [mqttHost, setMqttHost] = useState('192.168.1.93');
  const [mqttPort, setMqttPort] = useState('1883');
  const [mqttTopic, setMqttTopic] = useState('');
  const [useDefaultTopic, setUseDefaultTopic] = useState(false);
  const defaultTopicTemplate = 'application/32dc910f-33ae-4526-ac0b-6344e378f00f/device/24e124806e515126/event/up';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (connectionType === 'svms') {
      onSave(ip, port, mode);
    } else if (connectionType === 'mqtt' && onSaveMqtt) {
      const config: MqttServerConfig = {
        id: '', // BE will generate
        brokerHost: mqttHost,
        brokerPort: mqttPort,
        protocol: mqttProtocol,
        topic: useDefaultTopic ? defaultTopicTemplate : mqttTopic,
        defaultTopic: defaultTopicTemplate,
      };
      onSaveMqtt(config);
    }
    onClose();
  };

  return (
    <div className="add-external-server-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-300">
      <div
        className="add-external-server-container w-full max-w-md bg-surface-container-low border border-outline-variant/30 rounded-lg shadow-[0_0_50px_rgba(192,132,252,0.1)] overflow-hidden animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="add-external-server-header p-5 border-b border-outline-variant/20 bg-surface-container flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-8 bg-primary rounded-full shadow-[0_0_12px_rgba(192,132,252,0.5)]"></div>
            <div>
              <h3 className="text-sm font-black tracking-[0.2em] uppercase text-on-surface">{t('app.add_server.title')}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container-highest transition-colors text-on-surface-variant hover:text-on-surface"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="add-external-server-form p-8 space-y-6">
          {/* Connection Type Switcher */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-primary uppercase tracking-widest block ml-1">
              {t('app.add_server.conn_type')}
            </label>
            <div className="flex bg-black/40 p-1 rounded-sm border border-outline-variant/30">
              <button
                type="button"
                onClick={() => setConnectionType('svms')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xs text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${connectionType === 'svms'
                  ? 'bg-secondary text-white shadow-lg shadow-secondary/20'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
              >
                <Terminal className={`w-3.5 h-3.5 ${connectionType === 'svms' ? 'animate-pulse' : ''}`} />
                SVMS
              </button>
              <button
                type="button"
                onClick={() => setConnectionType('mqtt')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xs text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${connectionType === 'mqtt'
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
              >
                <Radio className={`w-3.5 h-3.5 ${connectionType === 'mqtt' ? 'animate-pulse' : ''}`} />
                MQTT
              </button>
            </div>
          </div>

          {/* ─── SVMS Form ─────────────────────────────────────────────── */}
          {connectionType === 'svms' && (
            <>
              {/* Mode Switcher */}
              <div className="space-y-3">
                <label className="text-[10px] font-black text-primary uppercase tracking-widest block ml-1 transition-colors group-focus-within:text-primary">
                  {t('app.add_server.op_mode')}
                </label>
                <div className="flex bg-black/40 p-1 rounded-sm border border-outline-variant/30">
                  <button
                    type="button"
                    onClick={() => setMode('receive')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xs text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${mode === 'receive'
                      ? 'bg-primary text-primary-container shadow-lg shadow-primary/20'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                      }`}
                  >
                    <Inbox className={`w-3.5 h-3.5 ${mode === 'receive' ? 'animate-bounce' : ''}`} />
                    {t('app.add_server.receive')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('send')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xs text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${mode === 'send'
                      ? 'bg-primary text-primary-container shadow-lg shadow-primary/20'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                      }`}
                  >
                    <Send className={`w-3.5 h-3.5 ${mode === 'send' ? 'animate-pulse' : ''}`} />
                    {t('app.add_server.send')}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 group">
                <label className="text-[10px] font-black text-primary uppercase tracking-widest block ml-1">
                  {t('app.add_server.target_ip')}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={ip}
                    onChange={(e) => setIp(e.target.value)}
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
                <label className="text-[10px] font-black text-primary uppercase tracking-widest block ml-1">
                  {t('app.add_server.access_port')}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="5000"
                    className="w-full bg-black/40 border border-outline-variant/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                    required
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20 pointer-events-none">
                    <Terminal className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ─── MQTT Form ─────────────────────────────────────────────── */}
          {connectionType === 'mqtt' && (
            <>
              {/* Protocol */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">
                  {t('app.add_server.protocol')}
                </label>
                <div className="flex bg-black/40 p-1 rounded-sm border border-outline-variant/30">
                  <button
                    type="button"
                    onClick={() => setMqttProtocol('mqtt')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xs text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${mqttProtocol === 'mqtt'
                      ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                      }`}
                  >
                    mqtt://
                  </button>
                  <button
                    type="button"
                    onClick={() => setMqttProtocol('mqtts')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xs text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${mqttProtocol === 'mqtts'
                      ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                      }`}
                  >
                    mqtts:// (TLS)
                  </button>
                </div>
              </div>

              {/* Host + Port row */}
              <div className="flex gap-3">
                <div className="space-y-1.5 flex-[2]">
                  <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">
                    {t('app.add_server.broker_host')}
                  </label>
                  <input
                    type="text"
                    value={mqttHost}
                    onChange={(e) => setMqttHost(e.target.value)}
                    placeholder="192.168.1.93"
                    className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                    required
                  />
                </div>
                <div className="space-y-1.5 flex-1">
                  <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">
                    {t('app.add_server.port')}
                  </label>
                  <input
                    type="text"
                    value={mqttPort}
                    onChange={(e) => setMqttPort(e.target.value)}
                    placeholder="1883"
                    className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                    required
                  />
                </div>
              </div>

              {/* Topic */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">
                    {t('app.add_server.sub_topic')}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setUseDefaultTopic(!useDefaultTopic);
                      if (!useDefaultTopic) setMqttTopic(defaultTopicTemplate);
                      else setMqttTopic('');
                    }}
                    className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded transition-all ${useDefaultTopic
                      ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-600/30'
                      : 'text-on-surface-variant hover:text-cyan-400 border border-transparent hover:border-outline-variant/30'
                      }`}
                  >
                    {useDefaultTopic ? t('app.add_server.default_active') : t('app.add_server.use_default')}
                  </button>
                </div>
                <input
                  type="text"
                  value={useDefaultTopic ? defaultTopicTemplate : mqttTopic}
                  onChange={(e) => { setMqttTopic(e.target.value); setUseDefaultTopic(false); }}
                  placeholder="application/xxxxx/device/xxxxx/event/up"
                  className={`w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20 ${useDefaultTopic ? 'opacity-60' : ''}`}
                  disabled={useDefaultTopic}
                />
              </div>
            </>
          )}

          <div className="pt-4 flex gap-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-outline-variant/30 text-[11px] font-black uppercase tracking-widest rounded-sm hover:bg-surface-container-high transition-all text-on-surface-variant"
            >
              {t('app.add_server.cancel')}
            </button>
            <button
              type="submit"
              className={`flex-1 px-6 py-3 text-[11px] font-black uppercase tracking-widest rounded-sm transition-all ${connectionType === 'mqtt'
                ? 'bg-cyan-600 text-white hover:bg-cyan-700 shadow-[0_0_20px_rgba(6,182,212,0.2)]'
                : 'bg-primary text-primary-container hover:bg-primary/90 shadow-[0_0_20px_rgba(192,132,252,0.2)]'
                }`}
            >
              {connectionType === 'mqtt' ? t('app.add_server.connect_mqtt') : t('app.add_server.confirm')}
            </button>
          </div>
        </form>

        <div className="px-8 pb-6 text-center">
          <p className="text-[9px] text-on-surface-variant/40 font-mono italic">
            {connectionType === 'mqtt'
              ? t('app.add_server.mqtt_note')
              : t('app.add_server.svms_note')}
          </p>
        </div>
      </div>
    </div>
  );
}
