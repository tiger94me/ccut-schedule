// 课表核心模型：周次过滤、单双周、连堂展开、当前/下一节课判断。纯函数，可在 Node 测试。

import { minutesOf } from './util.js';

/**
 * 课表条目结构：
 * { id, day: 1-7, periods: [1,2]（连堂）, course, room, teacher,
 *   weeks: { start: 1, end: 16, parity: 'all' | 'odd' | 'even' } }
 */

// 某条目在第 week 周是否生效（week 为 0/未设置学期时视为全部生效）
export function entryActive(entry, week) {
  if (!entry.weeks) return true;
  const { start = 1, end = 99, parity = 'all' } = entry.weeks;
  if (!week) return true;
  if (week < start || week > end) return false;
  if (parity === 'odd' && week % 2 === 0) return false;
  if (parity === 'even' && week % 2 === 1) return false;
  return true;
}

// 某天（第 week 周）生效的条目
export function dayEntries(entries, day, week) {
  return entries.filter(e => e.day === day && entryActive(e, week));
}

// 展开为按节次的列表：连堂课每个节次一项（引用同一 entry），按节次升序
export function expandPeriods(entriesForDay) {
  const out = [];
  for (const e of entriesForDay) {
    const ps = Array.isArray(e.periods) && e.periods.length ? e.periods : [e.periods].filter(Boolean);
    for (const p of ps) out.push({ period: p, entry: e });
  }
  out.sort((a, b) => a.period - b.period);
  return out;
}

// 今日时间线：把节次时间表与当天课程对齐
// 返回 [{ id, label, start, end, session, entry | null }]
export function buildTimeline(periods, entriesForDay) {
  const map = new Map(expandPeriods(entriesForDay).map(x => [x.period, x.entry]));
  return periods.map(p => ({ ...p, entry: map.get(p.id) || null }));
}

// 当前时刻状态：正在上的课 / 下一节有课的节次
// nowMin 为当前时刻的分钟数（如 8:05 -> 485）
export function nowStatus(timeline, nowMin) {
  let current = null;
  let next = null;
  for (const item of timeline) {
    if (!item.entry) continue;
    const s = minutesOf(item.start);
    const e = minutesOf(item.end);
    if (nowMin >= s && nowMin < e) current = item;
    else if (nowMin < s && !next) next = item;
  }
  return {
    current,
    next,
    minutesToNext: next ? minutesOf(next.start) - nowMin : null,
  };
}

// 记笔记时的课程推荐：正在上的课优先，其次最近一节刚下课的课
export function suggestCourse(timeline, nowMin) {
  let lastEnded = null;
  for (const item of timeline) {
    if (!item.entry) continue;
    const s = minutesOf(item.start);
    const e = minutesOf(item.end);
    if (nowMin >= s && nowMin < e) return item;
    if (e <= nowMin) lastEnded = item;
  }
  return lastEnded;
}

// 时段名称
export function sessionName(session) {
  return { morning: '上午', afternoon: '下午', evening: '晚上' }[session] || '';
}

// 每个时段的首个有课节次（提醒引擎 session 模式用）
// 返回 Map<session, timelineItem>
export function firstClassOfSessions(timeline) {
  const map = new Map();
  for (const item of timeline) {
    if (item.entry && !map.has(item.session)) map.set(item.session, item);
  }
  return map;
}
