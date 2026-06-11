// ─── FEATURE NORMALIZER ──────────────────────────────────────────────────────
// Normalize feature value — hỗ trợ cả format cũ (boolean) và mới (object).
// Dùng chung cho cả mqtt.service.js và socketEvents.js.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a single feature entry.
 *
 * Supported inputs:
 *   undefined / null  → { enabled: <default>,  cameraId: null }
 *   true / false      → { enabled: <val>, cameraId: null }
 *   { enabled, cameraId } → merge với defaults
 *
 * @param {boolean|object|undefined|null} value
 * @param {string} code - Mã sự kiện (e.g. 'fall', 'occupied', etc.)
 * @returns {{ enabled: boolean, cameraId: string|null }}
 */
function normalizeFeature(value, code) {
  // Default on for fall and unknown-event bucket.
  const defaultEnabled = code === 'fall' || code === '__other_events__';

  if (value === undefined || value === null) {
    return { enabled: defaultEnabled, cameraId: null };
  }
  if (typeof value === 'boolean') {
    return { enabled: value, cameraId: null };
  }
  if (typeof value === 'object') {
    return {
      enabled: value.enabled ?? defaultEnabled,
      cameraId: value.cameraId || null,
    };
  }
  return { enabled: defaultEnabled, cameraId: null };
}

module.exports = { normalizeFeature };
