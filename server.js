'use strict';
/* StarCull · 入口层：中间件、路由挂载、静态资源与启动 */

const express = require('express');
const path = require('path');
const { PORT, UPLOAD_DIR, PUBLIC_DIR, ROOT_DIR } = require('./src/config');
const { bootstrap, syncFolderProducts } = require('./src/catalog');
const { diffAndSync } = require('./src/sync');
const { detectCorrectZone } = require('./src/qiniu');
const { runStartupConvert } = require('./src/convert');

bootstrap();
syncFolderProducts();

// 先探测正确的 zone（list 返回空说明 zone 配错了）
detectCorrectZone().catch(() => {});

// 启动自检：存量图片里非 JPG 的统一转一次，并清理七牛上的旧格式
// 延迟 5 秒，先让 API listen 端口
setTimeout(() => {
  runStartupConvert().catch(e => console.warn('[convert] 启动自检失败:', e.message));
}, 5000);

// 启动时先跑一次全量 diff（把本地所有 uploads 同步到云存储）
// 延迟 15 秒，让 API 先 listen 端口，别跟上传抢带宽
setTimeout(() => {
  diffAndSync().catch(e => console.warn('[startup] diffAndSync failed:', e.message));
}, 15000);

// 每 10 分钟再跑一次 diff，补漏掉的
setInterval(() => {
  diffAndSync().catch(e => console.warn('[interval] diffAndSync failed:', e.message));
}, 10 * 60 * 1000);

const app = express();
app.use(express.json({ limit: '1mb' }));

/* ---------- api ---------- */
app.use(require('./src/routes/auth'));
app.use(require('./src/routes/collection'));
app.use(require('./src/routes/draws'));
app.use(require('./src/routes/studio'));
app.use(require('./src/routes/messages'));
app.use(require('./src/routes/admin'));  // ← 新增：admin 同步接口

/* ---------- static ---------- */
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.get('/1.jpeg', (req, res) => res.sendFile(path.join(ROOT_DIR, '1.jpeg'), { maxAge: '30d' }));
app.use(express.static(PUBLIC_DIR));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Something went wrong.' });
  next();
});

const server = app.listen(PORT, () => {
  console.log('StarCull running → http://localhost:' + PORT);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用。');
    console.error('请先关闭占用进程，或运行 start.bat 让它自动终止。');
    process.exit(1);
  } else {
    console.error('启动失败:', err.message);
    process.exit(1);
  }
});
