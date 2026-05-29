import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/apiClient';
import { Camera, X, Eye, EyeOff } from 'lucide-react';

import type { ManualAddedCamera } from '../types';

interface CameraFormProps {
  onCancel: () => void;
  onSuccess: () => void;
  initialType?: 'sunell' | 'other';
  cameraToEdit?: ManualAddedCamera;
}

export const CameraForm = React.memo(function CameraForm({ onCancel, onSuccess, initialType = 'other', cameraToEdit }: CameraFormProps) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [addDeviceForm, setAddDeviceForm] = useState({
    name: cameraToEdit?.name || '',
    type: cameraToEdit?.type || initialType,
    cameraIp: cameraToEdit?.cameraIp || '192.168.1.208',
    controlPort: cameraToEdit?.cameraPort ? String(cameraToEdit.cameraPort) : '30001',
    rtspPort: '554',
    cameraUser: 'admin',
    cameraPass: 'admin1234',
    rtspUrl: cameraToEdit?.rtspUrl || 'rtsp://admin:admin1234@192.168.1.208:554/snl/live/1/1',
    snapshotUrl: cameraToEdit?.snapshotUrl || 'http://admin:admin1234@192.168.1.208/cgi-bin/image.cgi?cameraID=1&quality=5',
  });

  const [isCustomSnapshotUrl, setIsCustomSnapshotUrl] = useState(false);
  const [isCustomRtspUrl, setIsCustomRtspUrl] = useState(false);

  // Parse fields from cameraToEdit.rtspUrl if editing
  useEffect(() => {
    if (cameraToEdit && cameraToEdit.rtspUrl) {
      try {
        const match = cameraToEdit.rtspUrl.match(/rtsp:\/\/([^:]+):([^@]+)@([^:]+):(\d+)/);
        if (match) {
          const [, user, pass, ip, port] = match;
          const defaultTemplate = `rtsp://${user}:${pass}@${cameraToEdit.cameraIp}:${port}/snl/live/1/1`;
          const isCustom = cameraToEdit.rtspUrl !== defaultTemplate;
          setAddDeviceForm({
            name: cameraToEdit.name || '',
            type: cameraToEdit.type,
            cameraIp: cameraToEdit.cameraIp || ip,
            controlPort: String(cameraToEdit.cameraPort || '30001'),
            rtspPort: port,
            cameraUser: user,
            cameraPass: pass,
            rtspUrl: cameraToEdit.rtspUrl,
            snapshotUrl: cameraToEdit.snapshotUrl || `http://${user}:${pass}@${cameraToEdit.cameraIp || ip}/cgi-bin/image.cgi?cameraID=1&quality=5`
          });
          setIsCustomSnapshotUrl(!!cameraToEdit.snapshotUrl);
          setIsCustomRtspUrl(isCustom);
        } else {
          setAddDeviceForm({
            name: cameraToEdit.name || '',
            type: cameraToEdit.type,
            cameraIp: cameraToEdit.cameraIp,
            controlPort: String(cameraToEdit.cameraPort || '30001'),
            rtspPort: '554',
            cameraUser: 'admin',
            cameraPass: 'admin1234',
            rtspUrl: cameraToEdit.rtspUrl,
            snapshotUrl: cameraToEdit.snapshotUrl || `http://admin:admin1234@${cameraToEdit.cameraIp}/cgi-bin/image.cgi?cameraID=1&quality=5`
          });
          setIsCustomSnapshotUrl(!!cameraToEdit.snapshotUrl);
          setIsCustomRtspUrl(true);
        }
      } catch (e) {
        console.warn('Error parsing camera RTSP url:', e);
      }
    } else if (cameraToEdit) {
      setAddDeviceForm(prev => ({
        ...prev,
        name: cameraToEdit.name || '',
        type: cameraToEdit.type,
        cameraIp: cameraToEdit.cameraIp,
        controlPort: String(cameraToEdit.cameraPort || '30001'),
        snapshotUrl: cameraToEdit.snapshotUrl || `http://admin:admin1234@${cameraToEdit.cameraIp}/cgi-bin/image.cgi?cameraID=1&quality=5`,
      }));
      setIsCustomSnapshotUrl(!!cameraToEdit.snapshotUrl);
      setIsCustomRtspUrl(true);
    }
  }, [cameraToEdit]);

  // Unified state update to avoid double re-renders from useEffect
  const updateForm = (updates: Partial<typeof addDeviceForm>) => {
    setAddDeviceForm(prev => {
      const next = { ...prev, ...updates };
      if (!isCustomRtspUrl) {
        next.rtspUrl = `rtsp://${next.cameraUser}:${next.cameraPass}@${next.cameraIp}:${next.rtspPort}/snl/live/1/1`;
      }
      if (!isCustomSnapshotUrl) {
        next.snapshotUrl = `http://${next.cameraUser}:${next.cameraPass}@${next.cameraIp}/cgi-bin/image.cgi?cameraID=1&quality=5`;
      }
      return next;
    });
  };

  const handleCustomSnapshotUrlToggle = (checked: boolean) => {
    setIsCustomSnapshotUrl(checked);
    if (!checked) {
      setAddDeviceForm(prev => ({
        ...prev,
        snapshotUrl: `http://${prev.cameraUser}:${prev.cameraPass}@${prev.cameraIp}/cgi-bin/image.cgi?cameraID=1&quality=5`
      }));
    }
  };

  const handleCustomRtspUrlToggle = (checked: boolean) => {
    setIsCustomRtspUrl(checked);
    if (!checked) {
      setAddDeviceForm(prev => ({
        ...prev,
        rtspUrl: `rtsp://${prev.cameraUser}:${prev.cameraPass}@${prev.cameraIp}:${prev.rtspPort}/snl/live/1/1`
      }));
    }
  };

  const handleSubmitDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate
    if (!addDeviceForm.cameraIp || (addDeviceForm.type === 'sunell' && !addDeviceForm.controlPort) || !addDeviceForm.cameraUser || !addDeviceForm.cameraPass) {
      alert(t('app.camera_form.error_fill_all'));
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: addDeviceForm.name || `Cam ${addDeviceForm.cameraIp}`,
        type: addDeviceForm.type,
        cameraIp: addDeviceForm.cameraIp,
        cameraPort: parseInt(addDeviceForm.controlPort || '30001'),
        cameraUser: addDeviceForm.cameraUser,
        cameraPass: addDeviceForm.cameraPass,
        rtspUrl: addDeviceForm.rtspUrl,
        snapshotUrl: addDeviceForm.snapshotUrl
      };

      if (cameraToEdit) {
        await apiClient.patch(`/api/v1/cameras/${cameraToEdit.id}`, payload);
      } else {
        await apiClient.post('/api/v1/cameras', payload);
      }
      onSuccess();
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      console.error('Error saving camera:', err);
      alert(t('app.camera_form.error_save_failed') + ': ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="add-external-server-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 animate-in fade-in duration-300">
      <div
        className="add-external-server-container w-full max-w-md bg-surface-container-low border border-outline-variant/30 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.1)] overflow-hidden animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="add-external-server-header p-5 border-b border-outline-variant/20 bg-surface-container flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-8 bg-cyan-500 rounded-full shadow-[0_0_12px_rgba(6,182,212,0.5)]"></div>
            <div>
              <h3 className="text-sm font-black tracking-[0.2em] uppercase text-on-surface flex items-center gap-2">
                <Camera className="w-4 h-4 text-cyan-500" />
                {cameraToEdit ? 'CẬP NHẬT CAMERA' : t('app.camera_form.add_camera')}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container-highest transition-colors text-on-surface-variant hover:text-on-surface cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmitDevice} className="add-external-server-form p-8 space-y-6">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">{t('app.camera_form.type')}</label>
                <select
                  value={addDeviceForm.type}
                  onChange={e => updateForm({ type: e.target.value as 'sunell' | 'other' })}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all"
                >
                  <option value="sunell">{t('app.camera_form.sunell')}</option>
                  <option value="other">{t('app.camera_form.other_rtsp')}</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">{t('app.camera_form.name_optional')}</label>
                <input
                  value={addDeviceForm.name}
                  onChange={e => updateForm({ name: e.target.value })}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                  placeholder={t('app.camera_form.name_placeholder')}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">{t('app.camera_form.camera_ip')}</label>
                <input
                  value={addDeviceForm.cameraIp}
                  onChange={e => updateForm({ cameraIp: e.target.value })}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                  placeholder="192.168.1.xxx"
                />
              </div>

              {addDeviceForm.type === 'sunell' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">{t('app.camera_form.control_port')}</label>
                  <input
                    value={addDeviceForm.controlPort}
                    onChange={e => updateForm({ controlPort: e.target.value })}
                    className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                    placeholder="30001"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">{t('app.camera_form.rtsp_port')}</label>
                <input
                  value={addDeviceForm.rtspPort}
                  onChange={e => updateForm({ rtspPort: e.target.value })}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                  placeholder="554"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">{t('app.camera_form.username')}</label>
                <input
                  value={addDeviceForm.cameraUser}
                  onChange={e => updateForm({ cameraUser: e.target.value })}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                  placeholder="admin"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">{t('app.camera_form.password')}</label>
                <div className="relative flex items-center">
                  <input
                    value={addDeviceForm.cameraPass}
                    onChange={e => updateForm({ cameraPass: e.target.value })}
                    className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm pl-4 pr-10 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                    placeholder="admin1234"
                    type={showPassword ? "text" : "password"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 text-on-surface-variant/60 hover:text-cyan-500 transition-colors p-1 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* RTSP URL Field */}
              <div className="flex flex-col gap-1.5 col-span-2">
                <div className="flex items-center justify-between ml-1">
                  <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest">RTSP URL</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Custom RTSP URL</span>
                    <input
                      type="checkbox"
                      className="accent-cyan-500 w-3 h-3 cursor-pointer"
                      checked={isCustomRtspUrl}
                      onChange={(e) => handleCustomRtspUrlToggle(e.target.checked)}
                    />
                  </label>
                </div>
                <input
                  value={addDeviceForm.rtspUrl}
                  onChange={e => isCustomRtspUrl && setAddDeviceForm(prev => ({ ...prev, rtspUrl: e.target.value }))}
                  disabled={!isCustomRtspUrl}
                  className={`w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20 ${!isCustomRtspUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
                  placeholder="rtsp://admin:admin1234@192.168.1.208:554/snl/live/1/1"
                />
              </div>

              {/* Snapshot URL Field */}
              <div className="flex flex-col gap-1.5 col-span-2">
                <div className="flex items-center justify-between ml-1">
                  <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest">Snapshot URL</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Custom Snapshot URL</span>
                    <input
                      type="checkbox"
                      className="accent-cyan-500 w-3 h-3 cursor-pointer"
                      checked={isCustomSnapshotUrl}
                      onChange={(e) => handleCustomSnapshotUrlToggle(e.target.checked)}
                    />
                  </label>
                </div>
                <input
                  value={addDeviceForm.snapshotUrl}
                  onChange={e => isCustomSnapshotUrl && updateForm({ snapshotUrl: e.target.value })}
                  disabled={!isCustomSnapshotUrl}
                  className={`w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20 ${!isCustomSnapshotUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
                  placeholder="http://admin:admin1234@192.168.1.208/cgi-bin/image.cgi?cameraID=1&quality=5"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 flex gap-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-6 py-3 border border-outline-variant/30 text-[11px] font-black uppercase tracking-widest rounded-sm hover:bg-surface-container-high transition-all text-on-surface-variant cursor-pointer"
            >
              {t('app.camera_form.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !addDeviceForm.cameraIp || (addDeviceForm.type === 'sunell' && !addDeviceForm.controlPort) || !addDeviceForm.cameraUser || !addDeviceForm.cameraPass}
              className="flex-1 px-6 py-3 text-[11px] font-black uppercase tracking-widest rounded-sm transition-all bg-cyan-600 text-white hover:bg-cyan-700 shadow-[0_0_20px_rgba(6,182,212,0.2)] disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? t('app.camera_form.saving') : t('app.camera_form.save')}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
});
