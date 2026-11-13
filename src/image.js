'use strict';
/* StarCull · 图片处理层：统一转 JPG + 超大自动压缩
 *
 * 上传的图片一律转成 JPG；超过 TARGET_BYTES 时逐级降尺寸/降质量，
 * 直到体积达标或降到最后一档。
 */

let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('[image] sharp 未安装，图片转 JPG / 压缩功能不可用（npm install sharp）');
}

// 输出的最大宽度（不放大）
const MAX_WIDTH = 1600;
// 目标体积上限：350KB
const TARGET_BYTES = 350 * 1024;

// 逐级压缩：先高质量，超标就往下走
const STEPS = [
  { width: 1600, quality: 85 },
  { width: 1400, quality: 78 },
  { width: 1200, quality: 70 },
  { width: 1000, quality: 62 },
  { width: 800, quality: 55 }
];

function available() {
  return !!sharp;
}

/**
 * 任意图片 buffer → JPG buffer（超限自动压缩）
 * @param {Buffer} input
 * @returns {Promise<{buffer: Buffer, width: number, quality: number, compressed: boolean}>}
 */
async function toJpg(input) {
  if (!sharp) {
    throw new Error('sharp 未安装，无法处理图片。请先在服务器执行 npm install sharp');
  }

  let best = null;
  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    const out = await sharp(input)
      .rotate()                              // 按 EXIF 摆正
      .flatten({ background: '#ffffff' })    // 透明背景铺白，转 JPG 不变黑
      .resize({ width: step.width, withoutEnlargement: true })
      .jpeg({ quality: step.quality, progressive: true })
      .toBuffer();

    if (!best || out.length < best.buffer.length) {
      best = { buffer: out, width: step.width, quality: step.quality };
    }
    if (out.length <= TARGET_BYTES) {
      return { ...best, compressed: i > 0 || false };
    }
  }
  // 全部档位都超标，返回最小的一档
  return { ...best, compressed: true };
}

/**
 * 读取图片元信息（宽度/高度/格式）
 */
async function metadata(input) {
  if (!sharp) return null;
  try {
    return await sharp(input).metadata();
  } catch {
    return null;
  }
}

module.exports = { available, toJpg, metadata, MAX_WIDTH, TARGET_BYTES };
