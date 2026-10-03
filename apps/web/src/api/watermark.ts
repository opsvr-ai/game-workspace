import http from './client';

/** 客户微信隐形水印「溯源」：把可疑文本交给服务端解码（老板 2026-10-04）。 */
export const watermarkApi = {
  decode: (text: string) => http.post('/watermark/decode', { text }),
};