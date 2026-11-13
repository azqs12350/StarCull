'use strict';
/* StarCull · 业务层：种子数据、上传目录同步、抽奖权重 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ADMIN_USER, ADMIN_PASSWORD, SESSION_DAYS, UPLOAD_DIR } = require('./config');
const { db, save } = require('./db');
const { hashPassword } = require('./security');
const { autoTitle, sanitizeFolderName } = require('./utils');
const { IMAGE_EXT } = require('./media');
const { pushFile } = require('./sync');

function seedProducts() {
  return [
    {
      titleZh: '01号 — 静', titleEn: 'No. 01 — Stillness',
      seriesZh: '静谧房间', seriesEn: 'Quiet Rooms',
      noteZh: '沙、骨与炭。一次关于留白的研究。', noteEn: 'Sand, bone and charcoal. A study of negative space.',
      image: '/art/01-stillness.svg'
    },
    {
      titleZh: '02号 — 雨后', titleEn: 'No. 02 — After Rain',
      seriesZh: '海岸笔记', seriesEn: 'Coastal Notes',
      noteZh: '淡色地平线笼罩在蓝灰色雾霭中。', noteEn: 'A pale horizon held in blue-grey haze.',
      image: '/art/02-after-rain.svg'
    },
    {
      titleZh: '03号 — 黄金时刻', titleEn: 'No. 03 — Golden Hour',
      seriesZh: '低日', seriesEn: 'Low Sun',
      noteZh: '赭石色与焦褐色，自西方点亮。', noteEn: 'Ochre and burnt sienna, lit from the west.',
      image: '/art/03-golden-hour.svg'
    },
    {
      titleZh: '04号 — 线条习作', titleEn: 'No. 04 — Line Study',
      seriesZh: '单笔画', seriesEn: 'Single Stroke',
      noteZh: '一根连续的线，绘制时笔不离开纸面。', noteEn: 'One continuous line, drawn without lifting the pen.',
      image: '/art/04-line-study.svg'
    },
    {
      titleZh: '05号 — 赤陶', titleEn: 'No. 05 — Terracotta',
      seriesZh: '黏土形态', seriesEn: 'Clay Forms',
      noteZh: '温暖的大地色调，切割成简单的形状。', noteEn: 'Warm earth tones, cut into simple shapes.',
      image: '/art/05-terracotta.svg'
    },
    {
      titleZh: '06号 — 冬日田野', titleEn: 'No. 06 — Winter Field',
      seriesZh: '苍白时刻', seriesEn: 'Pale Hours',
      noteZh: '骨白覆盖灰。几乎一无所有，却已足够。', noteEn: 'Bone white over grey. Almost nothing, and enough.',
      image: '/art/06-winter-field.svg'
    }
  ];
}

function bootstrap() {
  if (!db.users.some((u) => u.role === 'admin')) {
    const { salt, hash } = hashPassword(ADMIN_PASSWORD);
    db.users.push({
      id: crypto.randomUUID(),
      username: ADMIN_USER,
      salt,
      hash,
      role: 'admin',
      points: 0,
      lastLoginDate: null,
      freeDrawClaimed: false,
      registeredIp: '',
      createdAt: new Date().toISOString()
    });
    console.log(`Studio account ready → ${ADMIN_USER} / ${ADMIN_PASSWORD}`);
  }

  if (!db.meta.seeded) {
    const seeds = seedProducts();
    for (const seed of seeds) {
      db.products.push({
        id: crypto.randomUUID(),
        titleZh: seed.titleZh, titleEn: seed.titleEn,
        seriesZh: seed.seriesZh, seriesEn: seed.seriesEn,
        noteZh: seed.noteZh, noteEn: seed.noteEn,
        image: seed.image,
        starredBy: [],
        likedBy: [],
        dislikedBy: [],
        createdAt: new Date().toISOString()
      });
    }
    db.meta.seeded = true;
  }

  // Migrate legacy products that use old single-language fields (title/series/note)
  let migrated = false;
  for (const p of db.products) {
    if (!p.titleZh && !p.titleEn) {
      p.titleZh = p.title || '';
      p.titleEn = p.title || '';
      migrated = true;
    } else {
      p.titleZh = p.titleZh || '';
      p.titleEn = p.titleEn || '';
    }
    if (!p.seriesZh && !p.seriesEn) {
      p.seriesZh = p.series || '';
      p.seriesEn = p.series || '';
      migrated = true;
    } else {
      p.seriesZh = p.seriesZh || '';
      p.seriesEn = p.seriesEn || '';
    }
    if (!p.noteZh && !p.noteEn) {
      p.noteZh = p.note || '';
      p.noteEn = p.note || '';
      migrated = true;
    } else {
      p.noteZh = p.noteZh || '';
      p.noteEn = p.noteEn || '';
    }
    // Remove old single-language keys to avoid confusion
    delete p.title; delete p.series; delete p.note;
  }

  // Migrate legacy draws that still use the old `confirmed` status value.
  // (New state machine: pending / preparing / shipped / done)
  let migratedDraws = 0;
  for (const d of db.draws) {
    if (d.status === 'confirmed') { d.status = 'preparing'; migratedDraws++; }
  }

  const cutoff = Date.now() - SESSION_DAYS * 24 * 3600 * 1000;
  for (const [token, session] of Object.entries(db.sessions)) {
    if (!session || session.createdAt < cutoff) delete db.sessions[token];
  }
  if (migrated) console.log(`Migrated ${db.products.length} products to bilingual fields.`);
  if (migratedDraws) console.log(`Migrated ${migratedDraws} draw statuses from 'confirmed' → 'preparing'.`);
  save();
}

// 批量转码期间暂停目录扫描，避免读到中间状态生成重复产品
let scanLocked = false;
function setScanLock(v) { scanLocked = !!v; }

// Every sub-folder of data/uploads becomes a category in the collection.
function syncFolderProducts() {
  if (scanLocked) return;
  let changed = false;

  // NOTE: Do NOT auto-delete records for missing files — files can be in recycle bin
  // or temporarily unavailable. Only auto-ADD new records when new files appear on disk.

  let folders = [];
  try {
    folders = fs.readdirSync(UPLOAD_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    if (changed) save();
    return;
  }

  const known = new Set(db.products.map((p) => p.image));
  for (const dir of folders) {
    const folder = dir.name;
    let files = [];
    try {
      files = fs.readdirSync(path.join(UPLOAD_DIR, folder), { withFileTypes: true });
    } catch {
      continue;
    }

    files.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

    for (const file of files) {
      if (!file.isFile() || !IMAGE_EXT.has(path.extname(file.name).toLowerCase())) continue;
      const image = `/uploads/${folder}/${file.name}`;
      if (known.has(image)) continue;

      db.products.push({
        id: 'f_' + crypto.createHash('sha1').update(`${folder}/${file.name}`).digest('hex').slice(0, 14),
        titleZh: '', titleEn: autoTitle(file.name),
        seriesZh: '', seriesEn: folder,
        noteZh: '', noteEn: '',
        image,
        starredBy: [],
        likedBy: [],
        dislikedBy: [],
        createdAt: new Date().toISOString()
      });
      known.add(image);
      changed = true;

      // 新文件 → 立刻推七牛云（fire-and-forget，不阻塞扫描）
      // 推成功后把 db.products[i].image 更新成七牛云完整 URL
      pushFile(image).then(remoteUrl => {
        if (remoteUrl) {
          console.log(`[catalog] 新图片已同步七牛云: ${image} → ${remoteUrl}`);
          // 更新 image 为七牛云 URL
          const p = db.products.find(x => x.id === 'f_' + crypto.createHash('sha1').update(`${folder}/${file.name}`).digest('hex').slice(0, 14));
          if (p && !/^https?:\/\//i.test(p.image)) {
            p.image = remoteUrl;
            save();
          }
        }
      }).catch(e => console.warn(`[catalog] 同步七牛云失败 ${image}: ${e.message}`));
    }
  }

  if (changed) save();
}

function randomProduct(user) {
  if (db.products.length === 0) return null;
  const boost = 1 + Math.max(0, Number(db.settings.starWeight) || 0) / 100;
  const weights = db.products.map((p) => ((p.starredBy || []).includes(user.id) ? boost : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < db.products.length; i++) {
    r -= weights[i];
    if (r < 0) return db.products[i];
  }
  return db.products[db.products.length - 1];
}

module.exports = { seedProducts, bootstrap, syncFolderProducts, randomProduct, setScanLock };
