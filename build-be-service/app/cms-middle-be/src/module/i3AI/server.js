'use strict';

const http     = require('http');
const url      = require('url');
const path     = require('path');
const fs       = require('fs');
const { buildVaMap, resolveAlarm, VA_CFG_PATH } = require('./va-mapper');

const PORT = 3333;

// ─── Khởi tạo VA Map khi server start ───────────────────────────────────────
let vaMap = buildVaMap();
console.log(`[va-api] Loaded ${vaMap.size} VA entries from va.cfg`);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { pathname, query } = url.parse(req.url, true);
  const method = req.method.toUpperCase();

  // ── GET /health ──────────────────────────────────────────────────────────
  if (pathname === '/health' && method === 'GET') {
    return send(res, 200, { ok: true, entries: vaMap.size });
  }

  // ── POST /reload ─────────────────────────────────────────────────────────
  // Reload va.cfg vào memory mà không cần restart
  if (pathname === '/reload' && method === 'POST') {
    try {
      vaMap = buildVaMap();
      return send(res, 200, { ok: true, entries: vaMap.size, message: 'va.cfg reloaded' });
    } catch (err) {
      return send(res, 500, { ok: false, error: err.message });
    }
  }

  // ── GET /va/list ─────────────────────────────────────────────────────────
  // Trả toàn bộ danh sách đã build từ va.cfg
  if (pathname === '/va/list' && method === 'GET') {
    const list = [...vaMap.values()];
    return send(res, 200, { ok: true, count: list.length, data: list });
  }

  // ── GET /va/resolve?va_elem_id=<uuid>&alarm_status=<0|1> ─────────────────
  // API chính: tra cứu alias_name + display_name từ va_elem_id
  if (pathname === '/va/resolve' && method === 'GET') {
    const { va_elem_id, alarm_status } = query;
    if (!va_elem_id) {
      return send(res, 400, { ok: false, error: 'va_elem_id is required' });
    }
    const fakeAlarm = {
      va_elem_id,
      alarm_for_cms: { va_elem_id, alarm_status: parseInt(alarm_status ?? '0', 10) },
    };
    const result = resolveAlarm(fakeAlarm, vaMap);
    return send(res, result.ok ? 200 : 404, result);
  }

  // ── POST /va/resolve ──────────────────────────────────────────────────────
  // Resolve từ body alarm JSON đầy đủ (định dạng file trong cms/alarms/)
  if (pathname === '/va/resolve' && method === 'POST') {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { ok: false, error: 'Invalid JSON body' }); }

    const result = resolveAlarm(body, vaMap);
    return send(res, result.ok ? 200 : 404, result);
  }

  // ── POST /va/resolve-batch ────────────────────────────────────────────────
  // Resolve nhiều alarm cùng lúc, nhận mảng alarm objects
  if (pathname === '/va/resolve-batch' && method === 'POST') {
    let body;
    try { body = await parseBody(req); }
    catch { return send(res, 400, { ok: false, error: 'Invalid JSON body' }); }

    if (!Array.isArray(body)) {
      return send(res, 400, { ok: false, error: 'Body must be an array of alarm objects' });
    }

    const results = body.map(alarm => resolveAlarm(alarm, vaMap));
    const ok      = results.filter(r => r.ok).length;
    const failed  = results.length - ok;
    return send(res, 200, { ok: true, total: results.length, resolved: ok, failed, data: results });
  }

  // ── 404 ──────────────────────────────────────────────────────────────────
  send(res, 404, { ok: false, error: `Route not found: ${method} ${pathname}` });
});

server.listen(PORT, () => {
  console.log(`[va-api] Server running at http://localhost:${PORT}`);
  console.log(`[va-api] Config: ${VA_CFG_PATH}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /health`);
  console.log(`  POST /reload`);
  console.log(`  GET  /va/list`);
  console.log(`  GET  /va/resolve?va_elem_id=<uuid>[&alarm_status=0|1]`);
  console.log(`  POST /va/resolve         (body: alarm JSON object)`);
  console.log(`  POST /va/resolve-batch   (body: array of alarm objects)`);
});

module.exports = server;
