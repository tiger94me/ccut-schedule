// 提醒引擎：应用运行期间每 30 秒检查一次
// - 晨间简报（当天课程汇总）
// - 课前提醒（默认提前 40 分钟；可按"每节课"或"每时段首节课"提醒）
// - 课后提醒记笔记
// - 晚间总结提醒、周六复习计划提醒
// 已提醒的当天去重（localStorage），历史 key 自动清理。

import { loadSettings } from './settings.js';
import { fmtDate, dayOfWeek, minutesOf, nowMinutes, weekNumber, fmtDuration } from './util.js';
import { firstClassOfSessions, sessionName } from './model.js';

const FIRED_PREFIX = 'ds-fired:';

function firedKey(key, date) {
  return FIRED_PREFIX + date + ':' + key;
}

function isFired(key, date) {
  try { return localStorage.getItem(firedKey(key, date)) === '1'; } catch { return true; }
}

function markFired(key, date) {
  try { localStorage.setItem(firedKey(key, date), '1'); } catch { /* ignore */ }
}

// 清理 7 天前的去重记录
export function cleanupFiredKeys() {
  try {
    const cutoff = fmtDate(new Date(Date.now() - 7 * 86400000));
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(FIRED_PREFIX)) {
        const date = k.slice(FIRED_PREFIX.length, FIRED_PREFIX.length + 10);
        if (date < cutoff) toRemove.push(k);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

/**
 * 启动提醒引擎。
 * getDayTimeline(date, day, week) -> Promise<timeline>（model.buildTimeline 的结果）
 * notify(title, body, opts) -> void（由 main 提供：系统通知 + 应用内 toast）
 */
export function startReminderEngine({ getDayTimeline, notify }) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const s = loadSettings();
      if (!s.reminder.enabled) return;

      const now = new Date();
      const date = fmtDate(now);
      const day = dayOfWeek(now);
      const week = weekNumber(now, s.semesterStart);
      const nowMin = nowMinutes(now);

      const tl = await getDayTimeline(date, day, week);
      const lead = Math.max(1, +s.reminder.lead || 40);

      // 1) 晨间简报：到达设定时间后触发一次（无课不打扰）
      if (nowMin >= minutesOf(s.reminder.morningTime) && nowMin < 21 * 60 && !isFired('morning', date)) {
        markFired('morning', date);
        const classes = tl.filter(t => t.entry);
        if (classes.length) {
          const body = classes.map(c =>
            `${c.start} ${c.entry.course}${c.entry.room ? ' · ' + c.entry.room : ''}`).join('；');
          notify('☀️ 今日课程', `今天有 ${classes.length} 节课：${body}`, { tab: 'today' });
        }
      }

      // 2) 课前提醒
      if (s.reminder.mode === 'perClass') {
        for (const item of tl) {
          if (!item.entry) continue;
          const start = minutesOf(item.start);
          if (nowMin >= start - lead && nowMin < start && !isFired(`class:${item.id}`, date)) {
            markFired(`class:${item.id}`, date);
            notify(`📖 上课提醒 · ${item.entry.course}`,
              `${item.start} 开课（还有 ${fmtDuration(start - nowMin)}）${item.entry.room ? '，教室 ' + item.entry.room : ''}`,
              { tab: 'today' });
          }
        }
      } else {
        // session 模式：上午 / 下午 / 晚上各提醒该时段第一节课
        for (const [session, item] of firstClassOfSessions(tl)) {
          const start = minutesOf(item.start);
          if (nowMin >= start - lead && nowMin < start && !isFired(`class:${item.id}`, date)) {
            markFired(`class:${item.id}`, date);
            notify(`📖 ${sessionName(session)}有课 · ${item.entry.course}`,
              `${item.start} 开课（还有 ${fmtDuration(start - nowMin)}）${item.entry.room ? '，教室 ' + item.entry.room : ''}`,
              { tab: 'today' });
          }
        }
      }

      // 3) 课后提醒记笔记
      if (s.reminder.afterClass) {
        for (const item of tl) {
          if (!item.entry) continue;
          const end = minutesOf(item.end);
          if (nowMin >= end && nowMin < end + 15 && !isFired(`after:${item.id}`, date)) {
            markFired(`after:${item.id}`, date);
            notify(`✏️ 刚下课 · ${item.entry.course}`, '花 1 分钟拍个照或记两句，存下上课进度', { tab: 'notes' });
          }
        }
      }

      // 4) 晚间总结提醒
      if (nowMin >= minutesOf(s.reminder.eveningTime) && nowMin < 23 * 60 && !isFired('evening', date)) {
        markFired('evening', date);
        notify('🌙 该总结啦', '打开「总结」，生成今日总结和明日准备', { tab: 'summary' });
      }

      // 5) 周六上午：复习计划提醒
      if (day === 6 && nowMin >= 9 * 60 && nowMin < 12 * 60 && !isFired('weekend', date)) {
        markFired('weekend', date);
        notify('📚 周末复习', '本周课程结束了，去「总结」生成本周复习计划', { tab: 'summary' });
      }
    } catch (err) {
      console.warn('提醒引擎异常：', err);
    } finally {
      running = false;
    }
  }

  cleanupFiredKeys();
  setInterval(tick, 30000);
  setTimeout(tick, 1500); // 启动后稍等片刻再首次检查
  return { tick };
}
