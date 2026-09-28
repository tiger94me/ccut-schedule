// 共享 UI 组件：toast、底部弹层（sheet）、确认框、极简 Markdown 渲染、SVG 图标

import { $, escapeHtml } from './util.js';

/* ---------- SVG 图标（stroke 风格，随文字颜色） ---------- */

const I = (paths, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  today: I('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 2.8V6M16 2.8V6"/><path d="M7.5 13h3v3h-3z" fill="currentColor" stroke="none"/>'),
  schedule: I('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 2.8V6M16 2.8V6"/><path d="M7.5 13.5h4M7.5 17h7"/>'),
  note: I('<path d="M6 3.5h9.5L19 7v13.5H6z"/><path d="M15 3.5V7h4M9 11.5h6M9 15h6"/>'),
  summary: I('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z"/>'),
  camera: I('<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 4.8h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>'),
  mic: I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  trash: I('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/>'),
  import: I('<path d="M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>'),
  export: I('<path d="M12 13V3m0 0L8.5 6.5M12 3l3.5 3.5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>'),
  bell: I('<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5H4.5z"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
  chevL: I('<path d="M14.5 5.5L8 12l6.5 6.5"/>'),
  chevR: I('<path d="M9.5 5.5L16 12l-6.5 6.5"/>'),
  edit: I('<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/>'),
  image: I('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17.5l5-5 4 4 2.5-2.5 4.5 4.5"/>'),
  clock: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  spark: I('<path d="M12 3l1.8 5.7L19.5 10l-5.7 1.8L12 17.5l-1.8-5.7L4.5 10l5.7-1.3z"/>'),
};

export function icon(name) {
  return ICONS[name] || '';
}

/* ---------- 系统通知 ---------- */

export async function requestNotifyPermission() {
  if (!('Notification' in window)) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

// 发送系统通知（已授权时）+ 应用内 toast 兜底
export async function sendNotification(title, body, { tab } = {}) {
  showToast(`${title}｜${body}`.slice(0, 90));
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, tag: 'ds-' + Date.now(), icon: './icons/icon-192.png', data: { tab } };
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch { /* ignore */ }
}

/* ---------- Toast ---------- */

let toastTimer = null;
export function showToast(message, type = 'info') {
  let root = $('#toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  root.innerHTML = `<div class="toast toast-${escapeHtml(type)}">${escapeHtml(message)}</div>`;
  root.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.classList.remove('show'), 2600);
}

/* ---------- 底部弹层 Sheet ---------- */

let sheetStack = [];

/**
 * 打开底部弹层。content 可为 HTML 字符串或 Node。
 * 返回 { root, close }
 */
export function openSheet({ title = '', content = '', full = false, onClose = null }) {
  closeSheet(); // 单层弹层，后开替前开（触发前一个的 onClose，如停止听写）
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-mask"></div>
    <div class="sheet ${full ? 'sheet-full' : ''}" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <button class="sheet-close" aria-label="关闭">${icon('close')}</button>
        <div class="sheet-title">${escapeHtml(title)}</div>
        <div class="sheet-header-spacer"></div>
      </div>
      <div class="sheet-body"></div>
    </div>`;
  const body = wrap.querySelector('.sheet-body');
  if (typeof content === 'string') body.innerHTML = content;
  else body.appendChild(content);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));

  const api = {
    root: wrap,
    body,
    close: () => closeSheet(),
  };
  wrap.querySelector('.sheet-close').addEventListener('click', () => api.close());
  wrap.querySelector('.sheet-mask').addEventListener('click', () => api.close());
  sheetStack = [{ wrap, onClose }];
  return api;
}

export function closeSheet(silent = false) {
  const top = sheetStack.pop();
  if (!top) return;
  top.wrap.classList.remove('open');
  setTimeout(() => top.wrap.remove(), 220);
  if (!silent && top.onClose) top.onClose();
}

/* ---------- 确认框（独立小对话框，不影响已打开的 sheet） ---------- */

export function confirmDialog(message, { danger = false, okText = '确定' } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'confirm-wrap';
    wrap.innerHTML = `
      <div class="confirm-mask"></div>
      <div class="confirm-box" role="alertdialog" aria-modal="true">
        <p class="confirm-msg">${escapeHtml(message)}</p>
        <div class="btn-row">
          <button class="btn btn-ghost" data-act="no">取消</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="yes">${escapeHtml(okText)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const done = val => {
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 180);
      resolve(val);
    };
    wrap.querySelector('[data-act="no"]').addEventListener('click', () => done(false));
    wrap.querySelector('[data-act="yes"]').addEventListener('click', () => done(true));
    wrap.querySelector('.confirm-mask').addEventListener('click', () => done(false));
  });
}

/* ---------- 极简 Markdown 渲染 ---------- */

export function renderMarkdown(md) {
  const esc = escapeHtml(String(md || ''));
  const lines = esc.split('\n');
  const out = [];
  let inList = false;
  let inQuote = false;
  const closeAll = () => {
    if (inList) { out.push('</ul>'); inList = false; }
    if (inQuote) { out.push('</blockquote>'); inQuote = false; }
  };
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) { closeAll(); out.push(`<h4>${inline(line.slice(4))}</h4>`); continue; }
    if (/^##\s+/.test(line)) { closeAll(); out.push(`<h3>${inline(line.slice(3))}</h3>`); continue; }
    if (/^#\s+/.test(line)) { closeAll(); out.push(`<h3>${inline(line.slice(2))}</h3>`); continue; }
    if (/^-\s+\[( |x|x)?\]\s*/i.test(line)) {
      if (!inList) { closeAll(); out.push('<ul class="md-tasks">'); inList = true; }
      const done = /^\-\s+\[[xX]\]/i.test(line);
      out.push(`<li class="${done ? 'done' : ''}"><span class="task-box">${done ? '☑' : '☐'}</span>${inline(line.replace(/^-\s*\[[ xX]?\]\s*/i, ''))}</li>`);
      continue;
    }
    if (/^-\s+/.test(line)) {
      if (!inList) { closeAll(); out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (/^&gt;\s?/.test(line)) {
      if (!inQuote) { closeAll(); out.push('<blockquote>'); inQuote = true; }
      out.push(inline(line.replace(/^&gt;\s?/, '')));
      continue;
    }
    closeAll();
    if (line.trim() === '') { out.push(''); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeAll();
  return out.join('\n');
}
