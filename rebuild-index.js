'use strict';
/* 从 db.json 提取所有图片 key → 写入本地 qiniu-index.json
 * （避开七牛云 SDK listPrefixV2 的 bug）
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.resolve(__dirname, 'data', 'db.json');
const INDEX_FILE = path.resolve(__dirname, 'data', 'qiniu-index.json');

function extractKeys(obj, keys = new Set()) {
  if (!obj || typeof obj !== 'object') return keys;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.startsWith('/uploads/')) {
      // /uploads/xxx.jpg → uploads/xxx.jpg（去掉开头的 /）
      keys.add(v.replace(/^\//, ''));
    } else if (k === 'image' && typeof v === 'string' && v.startsWith('/')) {
      keys.add(v.replace(/^\//, ''));
    } else if (k === 'images' && Array.isArray(v)) {
      v.forEach(i => { if (typeof i === 'string' && i.startsWith('/')) keys.add(i.replace(/^\//, '')); });
    } else {
      extractKeys(v, keys);
    }
  }
  return keys;
}

try {
  if (!fs.existsSync(DB_FILE)) { console.error(`❌ ${DB_FILE} 不存在`); process.exit(1); }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const keys = [...extractKeys(db)].sort();

  console.log(`========== 从 db.json 提取 ==========`);
  console.log(`db.json 里找到 ${keys.length} 个 /uploads/ 开头的路径`);

  if (keys.length === 0) {
    console.error('❌ db.json 里没有 /uploads/ 路径！');
    process.exit(1);
  }

  const dir = path.dirname(INDEX_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify({ keys }, null, 2));

  console.log(`✅ 已写入 ${INDEX_FILE}`);
  console.log(`前 5 个:`);
  keys.slice(0, 5).forEach(k => console.log(`  ${k}`));
  console.log(`\n下次 server 启动会读这个索引文件，不会再调 listPrefixV2 了！`);

} catch (e) {
  console.error('❌ 出错:', e.message);
  process.exit(1);
}
