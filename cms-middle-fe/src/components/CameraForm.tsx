import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/apiClient';
import { Camera, X } from 'lucide-react';

interface CameraFormProps {
  onCancel: () => void;
  onSuccess: () => void;
}

export function CameraForm({ onCancel, onSuccess }: CameraFormProps) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addDeviceForm, setAddDeviceForm] = useState({
    name: '',
    type: 'other' as 'sunell' | 'other',
    cameraIp: '192.168.1.207',
    cameraPort: '554',
    cameraUser: 'admin',
    cameraPass: 'admin1234',
    // rtspUrl: 'rtsp://fake-camera:554/stream'
    rtspUrl: 'rtsp://192.168.1.207:554/snl/live/1/1'
  });

  const handleSubmitDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate
    if (!addDeviceForm.cameraIp || !addDeviceForm.cameraPort || !addDeviceForm.cameraUser || !addDeviceForm.cameraPass) {
      alert("Vui lòng điền đầy đủ: Camera IP, Port, Username, Password!");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post('/api/v1/cameras', {
        name: addDeviceForm.name || `Cam ${addDeviceForm.cameraIp}`,
        type: addDeviceForm.type,
        cameraIp: addDeviceForm.cameraIp,
        cameraPort: parseInt(addDeviceForm.cameraPort || '30001'),
        cameraUser: addDeviceForm.cameraUser,
        cameraPass: addDeviceForm.cameraPass,
        rtspUrl: addDeviceForm.rtspUrl
      });
      onSuccess();
    } catch (err: any) {
      console.error('Lỗi khi lưu Camera:', err);
      alert('Không thể lưu Camera: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="add-external-server-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-300">
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
                {t('app.camera_form.add_camera')}
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
                  onChange={e => setAddDeviceForm(f => ({ ...f, type: e.target.value as 'sunell' | 'other' }))}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all"
                >
                  <option value="other">{t('app.camera_form.other_rtsp')}</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">{t('app.camera_form.name_optional')}</label>
                <input
                  value={addDeviceForm.name}
                  onChange={e => setAddDeviceForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                  placeholder={t('app.camera_form.name_placeholder')}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">Camera IP (*)</label>
                <input
                  value={addDeviceForm.cameraIp}
                  onChange={e => setAddDeviceForm(f => ({ ...f, cameraIp: e.target.value }))}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                  placeholder="192.168.1.xxx"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">Camera Port (*)</label>
                <input
                  value={addDeviceForm.cameraPort}
                  onChange={e => setAddDeviceForm(f => ({ ...f, cameraPort: e.target.value }))}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                  placeholder={addDeviceForm.type === 'sunell' ? "30001" : "554"}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">Username (*)</label>
                <input
                  value={addDeviceForm.cameraUser}
                  onChange={e => setAddDeviceForm(f => ({ ...f, cameraUser: e.target.value }))}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                  placeholder="admin"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">Password (*)</label>
                <input
                  value={addDeviceForm.cameraPass}
                  onChange={e => setAddDeviceForm(f => ({ ...f, cameraPass: e.target.value }))}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                  placeholder="admin1234"
                  type="password"
                />
              </div>

              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-[10px] font-black text-cyan-500 uppercase tracking-widest block ml-1">{t('app.camera_form.rtsp_optional')}</label>
                <input
                  value={addDeviceForm.rtspUrl}
                  onChange={e => setAddDeviceForm(f => ({ ...f, rtspUrl: e.target.value }))}
                  className="w-full bg-black/40 border border-outline-variant/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 rounded-sm px-4 py-3 text-sm font-mono text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20"
                  placeholder="rtsp://..."
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
              disabled={isSubmitting || !addDeviceForm.cameraIp || !addDeviceForm.cameraPort || !addDeviceForm.cameraUser || !addDeviceForm.cameraPass}
              className="flex-1 px-6 py-3 text-[11px] font-black uppercase tracking-widest rounded-sm transition-all bg-cyan-600 text-white hover:bg-cyan-700 shadow-[0_0_20px_rgba(6,182,212,0.2)] disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? t('app.camera_form.saving') : t('app.camera_form.save')}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
