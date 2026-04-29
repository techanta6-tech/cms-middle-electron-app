import React, { useState } from 'react';
import apiClient from '../api/apiClient';

interface CameraFormProps {
  onCancel: () => void;
  onSuccess: () => void;
}

export function CameraForm({ onCancel, onSuccess }: CameraFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addDeviceForm, setAddDeviceForm] = useState({
    name: '',
    type: 'sunell' as 'sunell' | 'other',
    cameraIp: '',
    cameraPort: '',
    cameraUser: '',
    cameraPass: '',
    rtspUrl: ''
  });

  const handleSubmitDevice = async () => {
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
    <div className="mt-2 p-3 bg-surface-container-lowest/60 border border-cyan-500/20 rounded-md">
      <div className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest mb-3">Thêm Camera Mới</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Type</label>
          <select
            value={addDeviceForm.type}
            onChange={e => setAddDeviceForm(f => ({ ...f, type: e.target.value as 'sunell' | 'other' }))}
            className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface focus:border-cyan-500/50 outline-none"
          >
            <option value="sunell">Sunell (SDK + RTSP)</option>
            <option value="other">Other (RTSP Only)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Tên (Tùy chọn)</label>
          <input
            value={addDeviceForm.name}
            onChange={e => setAddDeviceForm(f => ({ ...f, name: e.target.value }))}
            className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface focus:border-cyan-500/50 outline-none"
            placeholder="Tên gợi nhớ"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Camera IP (*)</label>
          <input
            value={addDeviceForm.cameraIp}
            onChange={e => setAddDeviceForm(f => ({ ...f, cameraIp: e.target.value }))}
            className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface focus:border-cyan-500/50 outline-none"
            placeholder="192.168.1.xxx"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Camera Port (*)</label>
          <input
            value={addDeviceForm.cameraPort}
            onChange={e => setAddDeviceForm(f => ({ ...f, cameraPort: e.target.value }))}
            className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface focus:border-cyan-500/50 outline-none"
            placeholder={addDeviceForm.type === 'sunell' ? "30001" : "554"}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Username (*)</label>
          <input
            value={addDeviceForm.cameraUser}
            onChange={e => setAddDeviceForm(f => ({ ...f, cameraUser: e.target.value }))}
            className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface focus:border-cyan-500/50 outline-none"
            placeholder="admin"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Password (*)</label>
          <input
            value={addDeviceForm.cameraPass}
            onChange={e => setAddDeviceForm(f => ({ ...f, cameraPass: e.target.value }))}
            className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface focus:border-cyan-500/50 outline-none"
            placeholder="admin1234"
            type="password"
          />
        </div>
        <div className="flex flex-col gap-1 col-span-2">
          <label className="text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">RTSP URL (Tùy chọn)</label>
          <input
            value={addDeviceForm.rtspUrl}
            onChange={e => setAddDeviceForm(f => ({ ...f, rtspUrl: e.target.value }))}
            className="text-[11px] font-mono bg-surface-container border border-outline-variant/20 rounded px-2 py-1.5 text-on-surface w-full focus:border-cyan-500/50 outline-none"
            placeholder="rtsp://..."
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleSubmitDevice}
          disabled={isSubmitting || !addDeviceForm.cameraIp || !addDeviceForm.cameraPort || !addDeviceForm.cameraUser || !addDeviceForm.cameraPass}
          className="px-4 py-1.5 bg-cyan-500 text-white text-[10px] font-bold uppercase tracking-widest rounded shadow-sm hover:opacity-80 transition-opacity disabled:opacity-40"
        >
          {isSubmitting ? 'Đang lưu...' : 'Lưu Camera'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-on-surface-variant text-[10px] font-bold uppercase tracking-widest rounded border border-outline-variant/20 hover:bg-surface-container transition-colors"
        >
          Hủy
        </button>
      </div>
    </div>
  );
}
