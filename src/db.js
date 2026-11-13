'use strict';
/* StarCull · 数据层：db.json 的加载、落盘与孤儿数据清理 */

const fs = require('fs');
const { DB_FILE } = require('./config');

function loadDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      users: parsed.users || [],
      sessions: parsed.sessions || {},
      products: parsed.products || [],
      draws: parsed.draws || [],
      pointsLogs: parsed.pointsLogs || [],
      messages: parsed.messages || [],
      settings: { winRate: 50, framedRate: 10, starWeight: 100, ...(parsed.settings || {}) },
      meta: parsed.meta || {}
    };
  } catch {
    return { users: [], sessions: {}, products: [], draws: [], pointsLogs: [], messages: [], settings: { winRate: 50, framedRate: 10, starWeight: 100 }, meta: {} };
  }
}

const db = loadDb();

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 10);
}

/* Drop records left behind by deleted accounts (draws, point logs, sessions). */
(function pruneOrphans() {
  const ids = new Set(db.users.map((u) => u.id));
  const before = db.draws.length + db.pointsLogs.length + Object.keys(db.sessions).length;
  db.draws = db.draws.filter((d) => ids.has(d.userId));
  db.pointsLogs = db.pointsLogs.filter((l) => ids.has(l.userId));
  for (const [token, session] of Object.entries(db.sessions)) {
    if (!session || !ids.has(session.userId)) delete db.sessions[token];
  }
  const after = db.draws.length + db.pointsLogs.length + Object.keys(db.sessions).length;
  if (before !== after) save();
})();

module.exports = { loadDb, db, save };
