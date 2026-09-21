/**
 * 上传前压缩图片。
 *
 * 老板 2026-09-21 报「新电脑注册点了提交提示 Network Error」：身份证照片在手机上
 * 动辄 4~8MB，两张十几兆。弱网上传慢，而且这种大 body 很容易被安全软件/路由器的
 * 上网保护掐断（表现就是请求根本没到服务器，前端只看到 Network Error）。
 *
 * 这里统一缩到长边 1600、JPEG 质量 0.82：身份证信息看得清，体积通常只剩 100~400KB，
 * 注册又快又稳。压缩失败（原文件被移动/删除/来自网盘占位文件）时抛错，让调用方给出
 * 明确的「请把照片另存到桌面再选」提示，而不是一个看不懂的网络错误。
 */

const DEFAULT_MAX_SIDE = 1600;
const DEFAULT_QUALITY = 0.82;
/** 小于这个体积、尺寸也够小的话，不动它。 */
const ALREADY_SMALL_BYTES = 600 * 1024;

/** 浏览器解不开的格式（iPhone 的 HEIC 最常见），要单独给提示，不能让用户看到一个网络错误。 */
const UNDECODABLE = /\.(heic|heif|tif|tiff|dng|raw|cr2|cr3|nef|arw|psd)$/i;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (UNDECODABLE.test(file.name) || /heic|heif|tiff/i.test(file.type)) {
        reject(new Error(`照片格式不支持：${file.name}。请在手机上把这张照片另存/截图成 JPG，或发到电脑桌面后再上传。`));
      } else {
        reject(new Error(`照片读取失败：${file.name}。请把照片另存到电脑桌面后再重新选择。`));
      }
    };
    img.src = url;
  });
}

export async function compressImage(
  file: File,
  maxSide: number = DEFAULT_MAX_SIDE,
  quality: number = DEFAULT_QUALITY,
): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  const img = await loadImage(file);
  const width = img.naturalWidth || 0;
  const height = img.naturalHeight || 0;
  if (!width || !height) throw new Error(`照片尺寸异常：${file.name}`);

  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale >= 1 && file.size <= ALREADY_SMALL_BYTES) return file;

  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    } catch {
      resolve(null);
    }
  });
  if (!blob || blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}