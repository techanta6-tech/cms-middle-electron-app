// ─── FEATURE NORMALIZER ──────────────────────────────────────────────────────
// Normalize feature value — hỗ trợ cả format cũ (boolean) và mới (object).
// Dùng chung cho cả mqtt.service.js và socketEvents.js.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a single feature entry.
 *
 * Supported inputs:
 *   undefined / null  → { enabled: true,  cameraId: null }  (default: cho phép, dùng camera mặc định)
 *   true / false      → { enabled: <val>, cameraId: null }  (format cũ — backward compat)
 *   { enabled, cameraId } → merge với defaults                (format mới)
 *
 * @param {boolean|object|undefined|null} value
 * @returns {{ enabled: boolean, cameraId: string|null }}
 */
function normalizeFeature(value) {
  if (value === undefined || value === null) {
    return { enabled: true, cameraId: null };
  }
  if (typeof value === 'boolean') {
    return { enabled: value, cameraId: null };
  }
  if (typeof value === 'object') {
    return {
      enabled: value.enabled ?? true,
      cameraId: value.cameraId || null,
    };
  }
  return { enabled: true, cameraId: null };
}

module.exports = { normalizeFeature };
