#!/usr/bin/env node
/**
 * 关键接口简单冒烟测试（需先启动服务）
 * 用法: node server/scripts/smoke-test.js [BASE_URL]
 * 默认 BASE_URL=http://localhost:3000
 * 测试: 健康检查、管理端登录、调账接口（需 token）
 */
const base = process.argv[2] || process.env.BASE_URL || 'http://localhost:3000';
let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log('  ✅', name);
}
function fail(name, msg) {
  failed++;
  console.log('  ❌', name, msg || '');
}

async function run() {
  console.log('Smoke test @', base, '\n');

  // 1. 健康检查
  try {
    const r = await fetch(base + '/api/health');
    const j = r.ok ? await r.json().catch(() => ({})) : {};
    if (r.status === 200 && j.success && j.data && j.data.status === 'ok') {
      ok('GET /api/health');
    } else if (r.status === 503 && j.data && j.data.status === 'unhealthy') {
      ok('GET /api/health (503 unhealthy, DB down - expected in some env)');
    } else {
      fail('GET /api/health', `status=${r.status} body=${JSON.stringify(j).slice(0, 80)}`);
    }
  } catch (e) {
    fail('GET /api/health', e.message);
  }

  // 2. 管理端登录
  let token = null;
  try {
    const r = await fetch(base + '/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.success && j.token) {
      token = j.token;
      ok('POST /api/auth/admin/login');
    } else {
      fail('POST /api/auth/admin/login', j.message || j.error || String(r.status));
    }
  } catch (e) {
    fail('POST /api/auth/admin/login', e.message);
  }

  // 3. 带 token 请求管理端（如 GET /api/admin/stats）
  if (token) {
    try {
      const r = await fetch(base + '/api/admin/stats', {
        headers: { Authorization: 'Bearer ' + token }
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.success) {
        ok('GET /api/admin/stats (with token)');
      } else {
        fail('GET /api/admin/stats', j.message || j.error || String(r.status));
      }
    } catch (e) {
      fail('GET /api/admin/stats', e.message);
    }
  }

  console.log('\n---');
  console.log('Passed:', passed, 'Failed:', failed);
  process.exit(failed > 0 ? 1 : 0);
}

run();
