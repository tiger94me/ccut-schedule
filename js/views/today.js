// 今日页：晨间简报、当前/下一节课倒计时、今日课程时间线、今日笔记概览

import { loadSettings } from '../settings.js';
import { getDayTimeline, getNotes, getTomorrowClasses } from '../data.js';
import {
  fmtDate, cnDate, nowMinutes, weekNumber, fmtDuration, minutesOf,
  dayOfWeek, addDays, escapeHtml, courseColorIndex, DAY_NAMES,
} from '../util.js';
import { nowStatus } from '../model.js';
import { icon } from '../ui.js';

export async function render(root) {
  const now = new Date();
  const s = loadSettings();
  const week = weekNumber(now, s.semesterStart);
  const tl = await getDayTimeline(now);
  const st = nowStatus(tl, nowMinutes(now));
  const classes = tl.filter(t => t.entry);
  const notes = await getNotes(fmtDate(now));
  const nowMin = nowMinutes(now);

  const weekLabel = week
    ? `第 ${week} 周 · 共 ${s.totalWeeks} 周`
    : '未设置学期开始（去设置页填写）';

  /* ----- 状态卡 ----- */
  let statusHtml = '';
  if (st.current) {
    const left = minutesOf(st.current.end) - nowMin;
    statusHtml = `
      <div class="status-label now">${icon('clock')} 正在上课</div>
      <div class="status-course">${escapeHtml(st.current.entry.course)}</div>
      <div class="status-meta">${st.current.start}–${st.current.end}${st.current.entry.room ? ' · ' + escapeHtml(st.current.entry.room) : ''} · 还剩 ${fmtDuration(left)}</div>`;
  } else if (st.next) {
    statusHtml = `
      <div class="status-label next">${icon('clock')} 下一节课</div>
      <div class="status-course">${escapeHtml(st.next.entry.course)}</div>
      <div class="status-meta">${st.next.start} 开课${st.next.entry.room ? ' · ' + escapeHtml(st.next.entry.room) : ''} · 还有 ${fmtDuration(st.minutesToNext)}</div>`;
  } else if (classes.length) {
    statusHtml = `
      <div class="status-label done">${icon('check')} 今天的课都上完啦</div>
      <div class="status-meta">共 ${classes.length} 节课。记得课后记笔记，晚上生成总结 ✍️</div>`;
  } else {
    let tmHtml = '';
    try {
      const tm = await getTomorrowClasses(now);
      if (tm.length) {
        const items = tm.map(t =>
          `<li>${t.start} ${escapeHtml(t.course)}${t.room ? ' · ' + escapeHtml(t.room) : ''}</li>`).join('');
        tmHtml = `<div class="tm-preview"><div class="status-label">${DAY_NAMES[dayOfWeek(addDays(now, 1))]}预告</div><ul>${items}</ul></div>`;
      }
    } catch { /* ignore */ }
    statusHtml = `
      <div class="status-label done">${icon('check')} 今天没有排课 🎉</div>
      ${tmHtml}`;
  }

  /* ----- 今日课程（连堂合并） ----- */
  const groups = [];
  for (const item of tl) {
    if (!item.entry) continue;
    const last = groups[groups.length - 1];
    if (last && last.entry.id === item.entry.id && last.endPeriod + 1 === item.id) {
      last.endPeriod = item.id;
      last.end = item.end;
    } else {
      groups.push({ entry: item.entry, start: item.start, end: item.end, startPeriod: item.id, endPeriod: item.id });
    }
  }
  const timelineHtml = groups.length ? groups.map(g => {
    const startMin = minutesOf(g.start);
    const endMin = minutesOf(g.end);
    const state = nowMin >= endMin ? 'past' : (nowMin >= startMin ? 'now' : 'future');
    const ci = courseColorIndex(g.entry.course);
    return `
      <li class="tl-item tl-${state}">
        <div class="tl-time">${g.start}<span>${g.end}</span></div>
        <div class="tl-course c${ci}">${escapeHtml(g.entry.course)}</div>
        <div class="tl-room">${g.entry.room ? escapeHtml(g.entry.room) : ''}<span>第${g.startPeriod}${g.endPeriod > g.startPeriod ? '-' + g.endPeriod : ''}节</span></div>
      </li>`;
  }).join('') : '<li class="tl-empty">今天全天没有课</li>';

  /* ----- 今日笔记 ----- */
  const notesHtml = notes.length
    ? `<ul class="mini-notes">${notes.map(n => `
        <li>
          <span class="chip c${courseColorIndex(n.course)}">${escapeHtml(n.course || '未分类')}</span>
          <span class="mn-text">${escapeHtml((n.text || '照片笔记').slice(0, 40))}</span>
          ${(n.images || []).length ? `<span class="mn-imgs">${icon('image')} ${n.images.length}</span>` : ''}
        </li>`).join('')}
      </ul>`
    : '<p class="hint">今天还没有笔记。上完课拍个照、说两句，晚上才能总结得更准。</p>';

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>${cnDate(now)}</h1>
        <div class="sub">${weekLabel}</div>
      </div>
    </header>

    <div class="card status-card">${statusHtml}</div>

    <div class="quick-actions">
      <button class="btn btn-primary" id="qa-note">${icon('note')} 记笔记</button>
      <button class="btn btn-ghost" id="qa-summary">${icon('summary')} 今日总结</button>
    </div>

    <section class="card">
      <h2>今日课程</h2>
      <ul class="timeline">${timelineHtml}</ul>
    </section>

    <section class="card">
      <h2>今日笔记（${notes.length}）</h2>
      ${notesHtml}
    </section>
  `;

  root.querySelector('#qa-note').addEventListener('click', () => {
    sessionStorage.setItem('ds-auto-new-note', '1');
    location.hash = '#/notes';
  });
  root.querySelector('#qa-summary').addEventListener('click', () => {
    location.hash = '#/summary';
  });
}
