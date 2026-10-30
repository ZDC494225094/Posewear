export const yuan = (cents) => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
export const number = (n) => Number(n || 0).toLocaleString("zh-CN");

const pad = (n) => String(n).padStart(2, "0");
export function dateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function date(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function relative(ts) {
  if (!ts) return "";
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return date(ts);
}

// Library labels arrive as { key, zh, en, ja }; the UI is Chinese.
export const label = (obj) => (obj ? obj.zh || obj.key || "" : "");

export const STATUS_TEXT = { queued: "排队中", running: "生成中", succeeded: "已完成", failed: "失败" };
export const QUALITY_TEXT = { low: "草稿", medium: "标准", high: "精细" };
