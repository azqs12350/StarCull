'use strict';
/* StarCull · 媒体层：图片类型与上传中间件
 *
 * 上传先收到内存 → 统一转成 JPG（超限自动压缩）→ 再写入 uploads 目录。
 */

const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR } = require('./config');
const image = require('./image');

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif'
};

const IMAGE_EXT = new Set(Object.values(MIME_EXT));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('Use a JPG, PNG, WEBP, AVIF or GIF image.'));
  }
});

/**
 * 保存上传文件：转 JPG 后写入 uploads（可指定子目录）
 * @param {Express.Multer.File} file  memoryStorage 的 file（含 buffer）
 * @param {string} folder  子目录名（可为空）
 * @returns {Promise<{filename: string, relPath: string, bytes: number}>}
 */
async function saveUploadAsJpg(file, folder) {
  const { buffer } = await image.toJpg(file.buffer);
  const dir = folder ? path.join(UPLOAD_DIR, folder) : UPLOAD_DIR;
  fs.mkdirSync(dir, { recursive: true });

  const filename = crypto.randomUUID() + '.jpg';
  fs.writeFileSync(path.join(dir, filename), buffer);

  return {
    filename,
    relPath: folder ? `/uploads/${folder}/${filename}` : `/uploads/${filename}`,
    bytes: buffer.length
  };
}

module.exports = { MIME_EXT, IMAGE_EXT, upload, saveUploadAsJpg };
