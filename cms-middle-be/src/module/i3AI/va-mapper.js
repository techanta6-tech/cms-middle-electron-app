'use strict';

const fs = require('fs');
const path = require('path');

// ─── Đường dẫn mặc định ─────────────────────────────────────────────────────
const VA_CFG_PATH = path.resolve(__dirname, '../../config/va.cfg');

// ─── Bảng B: (type_id, alarm_status) → event_type (cố định theo CMS) ────────
// alarm_status: 0 = bắt đầu/tức thời, 1 = kết thúc
const EVENT_TYPE_MAP = {
  10: { 0: { event_type: 7,  cms_name: 'ai.alarm'      },
        1: { event_type: 8,  cms_name: 'ai.region.end' } },
  29: { 0: { event_type: 15, cms_name: 'safe.alarm'    },
        1: { event_type: 16, cms_name: 'safe.fall.end' } },
  // type_id 11 (Door count) - bỏ qua theo yêu cầu
  // type_id 12 (Traffic & Dwell) - chưa ánh xạ
};

// ─── Build Bảng A: va_elem_id → metadata ────────────────────────────────────
function buildVaMap(cfgPath = VA_CFG_PATH) {
  const raw = fs.readFileSync(cfgPath, 'utf-8');
  const cfg = JSON.parse(raw);

  const map = new Map();

  for (const camera of cfg.vas) {
    const cameraId = camera.id;
    for (const va of camera.va) {
      // Bỏ qua Door count (type_id 11)
      if (va.type_id === 11) continue;

      const displayName = va.para?.name || va.alias_name;

      map.set(va.id, {
        va_elem_id:   va.id,
        alias_name:   va.alias_name,
        display_name: displayName,
        type_id:      va.type_id,
        camera_id:    cameraId,
        enabled:      va.enabled ?? true,
      });
    }
  }

  return map;
}

// ─── Resolve một alarm record ─────────────────────────────────────────────────
function resolveAlarm(alarm, vaMap) {
  const vaElemId = alarm.alarm_for_cms?.va_elem_id ?? alarm.va_elem_id;
  const alarmStatus = alarm.alarm_for_cms?.alarm_status ?? 0;

  if (!vaElemId) {
    return { ok: false, error: 'missing_va_elem_id' };
  }

  const vaInfo = vaMap.get(vaElemId);
  if (!vaInfo) {
    return { ok: false, error: 'va_elem_id_not_found', va_elem_id: vaElemId };
  }

  const eventMapping = EVENT_TYPE_MAP[vaInfo.type_id]?.[alarmStatus];

  return {
    ok: true,
    va_elem_id:   vaElemId,
    alias_name:   vaInfo.alias_name,
    display_name: vaInfo.display_name,
    type_id:      vaInfo.type_id,
    camera_id:    vaInfo.camera_id,
    enabled:      vaInfo.enabled,
    alarm_status: alarmStatus,
    event_type:   eventMapping?.event_type ?? null,
    cms_name:     eventMapping?.cms_name   ?? null,
  };
}

module.exports = { buildVaMap, resolveAlarm, VA_CFG_PATH };
