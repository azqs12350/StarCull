'use strict';
/*
 * StarCull 本地同步工具 · 配置
 *
 * 优先级（后者覆盖前者）：
 *   内置默认值 < config.local.json < 环境变量 < 命令行参数
 *
 * config.local.json 含 token，已被 .gitignore 忽略，不要提交。
 */

const path = require('path');
const fs = require('fs');

const TOOL_DIR = __dirname;
const PROJECT_DIR = path.resolve(TOOL_DIR, '..', '..');
const LOCAL_CONFIG_FILE = path.join(TOOL_DIR, 'config.local.json');

const DEFAULTS = {
  // 服务器地址（与小程序 utils/api.js 中的 BASE_URL 一致）
  serverUrl: 'http://45.64.75.15:4173',

  // 服务器 /api/admin/* 的 admin token。留空则启动时直接报错提示填写。
  adminToken: '',

  // 输出目录：直接覆盖本地 data/
  dataDir: path.join(PROJECT_DIR, 'data'),

  // 备份目录：放在 data/ 之外，且被 .gitignore 忽略，不会被服务端扫描或入库
  backupDir: path.join(PROJECT_DIR, '.backups', 'local-sync'),

  // db.json 备份保留份数（按文件名时间戳倒序保留最近 N 份）
  keepDbBackups: 5,

  // 是否备份被覆盖的图片。图片可从服务器重新拉取，默认不备份以免占用大量磁盘。
  backupImages: false,

  // 图片下载并发数
  concurrency: 4,

  // 单次请求超时（毫秒）
  timeoutMs: 30000
};

function readLocalConfig() {
  if (!fs.existsSync(LOCAL_CONFIG_FILE)) return {};
  let raw;
  try {
    raw = fs.readFileSync(LOCAL_CONFIG_FILE, 'utf8');
  } catch (e) {
    throw new Error('读取 config.local.json 失败：' + e.message);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('顶层必须是 JSON 对象');
    }
    return parsed;
  } catch (e) {
    throw new Error('config.local.json 解析失败：' + e.message);
  }
}

function load(args) {
  args = args || {};
  const local = readLocalConfig();
  const merged = Object.assign({}, DEFAULTS, local);

  // config.local.json 里的相对路径按工具目录解析，避免受运行时 cwd 影响
  ['dataDir', 'backupDir'].forEach((key) => {
    if (local[key]) merged[key] = path.resolve(TOOL_DIR, String(local[key]));
  });

  if (process.env.STARCULL_SYNC_SERVER) merged.serverUrl = process.env.STARCULL_SYNC_SERVER;
  if (process.env.STARCULL_ADMIN_TOKEN) merged.adminToken = process.env.STARCULL_ADMIN_TOKEN;
  if (process.env.STARCULL_SYNC_DATA_DIR) merged.dataDir = path.resolve(process.cwd(), process.env.STARCULL_SYNC_DATA_DIR);
  if (process.env.STARCULL_SYNC_BACKUP_DIR) merged.backupDir = path.resolve(process.cwd(), process.env.STARCULL_SYNC_BACKUP_DIR);
  if (args.out) merged.dataDir = path.resolve(process.cwd(), args.out);

  merged.serverUrl = String(merged.serverUrl || '').trim().replace(/\/+$/, '');
  merged.adminToken = String(merged.adminToken || '').trim();
  merged.dataDir = path.resolve(String(merged.dataDir));
  merged.backupDir = path.resolve(String(merged.backupDir));
  merged.keepDbBackups = Math.max(0, Number(merged.keepDbBackups) || 0);
  merged.concurrency = Math.max(1, Number(merged.concurrency) || 1);
  merged.timeoutMs = Math.max(1000, Number(merged.timeoutMs) || 30000);

  merged.uploadDir = path.join(merged.dataDir, 'uploads');
  merged.dbFile = path.join(merged.dataDir, 'db.json');
  merged.manifestFile = path.join(merged.backupDir, 'manifest.json');
  merged.configFile = LOCAL_CONFIG_FILE;

  return merged;
}

module.exports = { load, DEFAULTS, PROJECT_DIR, TOOL_DIR, LOCAL_CONFIG_FILE };
