// 通用工具函数：日期时间、DOM、格式化。无业务依赖，可在 Node 环境中测试。

/* ---------- DOM ---------- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $all = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 触发全局刷新（视图层数据变化后调用，main.js 监听后重渲染当前页）
export function refreshApp() {
  try { globalThis.dispatchEvent(new Event('ds-refresh')); } catch { /* Node 环境 */ }
}

/* ---------- 日期时间 ---------- */

export const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// 1=周一 … 7=周日
export function dayOfWeek(d) {
  return d.getDay() || 7;
}

// '08:05' -> 485
export function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function nowMinutes(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

// 95 -> '1小时35分'
export function fmtDuration(mins) {
  if (mins < 0) return '已开始';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}小时${m}分`;
  if (h) return `${h}小时`;
  return `${m}分钟`;
}

// '9月28日 周一'
export function cnDate(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日 ${DAY_NAMES[dayOfWeek(d)]}`;
}

// 学期周次：semesterStart 为第一周周一的 'YYYY-MM-DD'；开学前或未设置返回 0
export function weekNumber(date, semesterStart) {
  if (!semesterStart) return 0;
  const start = parseDate(semesterStart);
  const cur = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((cur - start) / 86400000);
  if (days < 0) return 0;
  return Math.floor(days / 7) + 1;
}

// 课程名 -> 稳定的柔和配色索引（课表格子着色用）
const COURSE_COLORS = 8;
export function courseColorIndex(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % COURSE_COLORS;
}
