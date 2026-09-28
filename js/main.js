// 应用入口：hash 路由、Tab 切换、Service Worker 注册、提醒引擎启动

import { $ } from './util.js';
import { getDayTimeline } from './data.js';
import { startReminderEngine } from './reminders.js';
import { sendNotification } from './ui.js';
import { render as renderToday } from './views/today.js';
import { render as renderSchedule } from './views/schedule.js';
import { render as renderNotes } from './views/notes.js';
import { render as renderSummary } from './views/summary.js';
import { render as renderSettings } from './views/settings.js';

const ROUTES = {
  today: renderToday,
  schedule: renderSchedule,
  notes: renderNotes,
  summary: renderSummary,
  settings: renderSettings,
};

let currentRoute = 'today';
let rendering = false;

function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const name = h.split('?')[0].split('/')[0];
  return ROUTES[name] ? name : 'today';
}

async function render() {
  if (rendering) return;
  rendering = true;
  try {
    currentRoute = parseHash();
    document.querySelectorAll('#tabbar button').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === currentRoute));
    const root = $('#app');
    root.innerHTML = '';
    await ROUTES[currentRoute](root);
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    $('#app').innerHTML = `
      <div class="card hint-card">
        <p>页面加载出错：${String(err?.message || err)}</p>
        <button class="btn btn-primary" onclick="location.reload()">重新加载</button>
      </div>`;
  } finally {
    rendering = false;
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('ds-refresh', render);

// 底部 Tab 导航
document.querySelectorAll('#tabbar button').forEach(btn => {
  btn.addEventListener('click', () => {
    location.hash = '#/' + btn.dataset.tab;
  });
});

// 今日页每 30 秒自动刷新（倒计时/当前课状态）
setInterval(() => {
  if (currentRoute === 'today' && !document.querySelector('.sheet-wrap')) render();
}, 30000);

// Service Worker（PWA：离线 + 通知点击）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* 离线功能不可用不影响使用 */ });
  navigator.serviceWorker.addEventListener('message', ev => {
    if (ev.data && ev.data.tab) location.hash = '#/' + ev.data.tab;
  });
}

// 提醒引擎（晨报 / 课前 40 分钟 / 课后记笔记 / 晚间总结 / 周末复习）
startReminderEngine({
  getDayTimeline: (date, day, week) => getDayTimeline(date, week),
  notify: (title, body, opts) => sendNotification(title, body, opts),
});

render();
