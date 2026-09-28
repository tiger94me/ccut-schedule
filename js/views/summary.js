// 总结页：生成今日总结（含明日准备）、周末复习计划、历史归档查看

import { loadSettings } from '../settings.js';
import {
  getNotes, getNotesBetween, getDayTimeline, getTomorrowClasses,
  getSummary, saveSummary, getAllSummaries, deleteSummary,
} from '../data.js';
import {
  fmtDate, cnDate, weekNumber, dayOfWeek, addDays, refreshApp, DAY_NAMES,
} from '../util.js';
import { buildDailySummary } from '../summarize.js';
import { weekCourseStats, buildReviewPlan } from '../review.js';
import { aiAvailable, aiSummarizeDay, aiReviewPlan } from '../ai.js';
import { openSheet, showToast, confirmDialog, renderMarkdown, icon } from '../ui.js';

export async function render(root) {
  const now = new Date();
  const todayStr = fmtDate(now);
  const s = loadSettings();
  const week = weekNumber(now, s.semesterStart);
  const monday = addDays(now, 1 - dayOfWeek(now));
  const saturday = addDays(monday, 5);
  const saturdayStr = fmtDate(saturday);

  const [daily, review, history, todayNotes] = await Promise.all([
    getSummary('daily', todayStr),
    getSummary('review', saturdayStr),
    getAllSummaries(),
    getNotes(todayStr),
  ]);

  const isWeekend = [6, 7].includes(dayOfWeek(now));
  const weekLabel = week ? `第 ${week} 周` : '本周';

  const dailyCard = daily
    ? `<div class="md-content">${renderMarkdown(daily.content)}</div>
       <div class="gen-meta">${daily.viaAI ? '🤖 大模型生成' : '📱 本地算法生成'} · ${(daily.generatedAt || '').slice(11, 16)}
         <button class="btn btn-ghost btn-sm" id="regen-daily">重新生成</button></div>`
    : `<p class="hint">${todayNotes.length
        ? `今天有 ${todayNotes.length} 条笔记，可以生成总结了。`
        : '今天还没有笔记（可在「记录」页拍课本照片，会自动转成文字）。'}</p>`;

  const reviewCard = review
    ? `<div class="md-content">${renderMarkdown(review.content)}</div>
       <div class="gen-meta">${review.viaAI ? '🤖 大模型生成' : '📱 本地算法生成'} · ${review.date}
         <button class="btn btn-ghost btn-sm" id="regen-review">重新生成</button></div>`
    : `<p class="hint">根据本周学习进度，安排周六、周日的复习时间块。</p>`;

  const historyHtml = history.length
    ? `<ul class="history-list">${history.map(h => `
        <li data-id="${h.id}">
          <span class="hl-icon">${h.type === 'daily' ? '📝' : '📚'}</span>
          <span class="hl-title">${h.type === 'daily' ? '学习总结' : '复习计划'}</span>
          <span class="hl-date">${h.date}</span>
          <span class="hl-via">${h.viaAI ? 'AI' : '本地'}</span>
        </li>`).join('')}
      </ul>`
    : '<p class="hint">还没有历史总结。</p>';

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>总结与复习</h1>
        <div class="sub">${cnDate(now)}${week ? ' · 第 ' + week + ' 周' : ''} · ${aiAvailable(s) ? '大模型增强已开启' : '本地总结模式'}</div>
      </div>
    </header>

    <section class="card">
      <h2>今日总结与明日准备</h2>
      ${dailyCard}
      <button class="btn btn-primary btn-block" id="gen-daily">${icon('spark')} 生成今日总结</button>
    </section>

    <section class="card ${isWeekend ? 'card-highlight' : ''}">
      <h2>${weekLabel} · 周末复习计划 ${isWeekend ? '（本周已到周末）' : ''}</h2>
      ${reviewCard}
      <button class="btn btn-primary btn-block" id="gen-review">${icon('spark')} 生成本周复习计划</button>
    </section>

    <section class="card">
      <h2>历史归档</h2>
      ${historyHtml}
    </section>
  `;

  const busy = btn => {
    btn.disabled = true;
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = '生成中，请稍候…';
    return () => { btn.disabled = false; btn.innerHTML = btn.dataset.orig; };
  };

  root.querySelector('#gen-daily').addEventListener('click', async ev => {
    const done = busy(ev.currentTarget);
    try { await generateDailySummary(); }
    finally { done(); }
  });
  root.querySelector('#gen-review').addEventListener('click', async ev => {
    const done = busy(ev.currentTarget);
    try { await generateReviewPlan(); }
    finally { done(); }
  });
  root.querySelector('#regen-daily')?.addEventListener('click', async ev => {
    const done = busy(ev.currentTarget);
    try { await generateDailySummary(); }
    finally { done(); }
  });
  root.querySelector('#regen-review')?.addEventListener('click', async ev => {
    const done = busy(ev.currentTarget);
    try { await generateReviewPlan(); }
    finally { done(); }
  });

  root.querySelectorAll('.history-list li').forEach(li => {
    li.addEventListener('click', () => {
      const h = history.find(x => x.id === li.dataset.id);
      if (h) openHistorySheet(h);
    });
  });
}

/* ---------- 生成今日总结 ---------- */

async function generateDailySummary() {
  const now = new Date();
  const todayStr = fmtDate(now);
  const s = loadSettings();
  const week = weekNumber(now, s.semesterStart);
  const notes = await getNotes(todayStr);
  const tomorrow = await getTomorrowClasses(now);

  // 今天上过课但没有笔记的课程
  const tl = await getDayTimeline(now);
  const todayCourses = [...new Set(tl.filter(t => t.entry).map(t => t.entry.course))];
  const noted = new Set(notes.map(n => n.course));
  const noNoteCourses = todayCourses.filter(c => !noted.has(c));

  let content = '';
  let viaAI = false;
  if (aiAvailable(s)) {
    try {
      const notesText = notes.map(n => {
        const imgs = (n.images || []).map(i => i.ocrText).filter(Boolean).join('\n');
        return `【${n.course}】\n${[n.text, imgs].filter(Boolean).join('\n')}`;
      }).join('\n\n');
      const tmDay = DAY_NAMES[dayOfWeek(addDays(now, 1))];
      const tomorrowText = tomorrow.map(t =>
        `${tmDay} ${t.start} ${t.course}${t.room ? ' ' + t.room : ''}`).join('\n');
      content = await aiSummarizeDay(s, {
        dateLabel: cnDate(now),
        weekLabel: week ? `（第${week}周）` : '',
        notesText,
        tomorrowText,
        noNoteCourses,
      });
      viaAI = true;
    } catch (err) {
      showToast(`大模型总结失败（${err.message}），已改用本地总结`, 'error');
    }
  }
  if (!content) {
    content = buildDailySummary({
      dateLabel: cnDate(now),
      weekLabel: week ? ` · 第${week}周` : '',
      notes: notes.map(n => ({
        course: n.course,
        text: n.text,
        images: n.images || [],
      })),
      tomorrow,
      noNoteCourses,
    });
  }
  await saveSummary({
    date: todayStr,
    type: 'daily',
    content,
    viaAI,
    generatedAt: new Date().toISOString(),
  });
  showToast('今日总结已生成 ✅');
  refreshApp();
}

/* ---------- 生成周末复习计划 ---------- */

async function generateReviewPlan() {
  const now = new Date();
  const s = loadSettings();
  const week = weekNumber(now, s.semesterStart);
  const monday = addDays(now, 1 - dayOfWeek(now));
  const mondayStr = fmtDate(monday);
  const todayStr = fmtDate(now);
  const saturdayStr = fmtDate(addDays(monday, 5));

  const weekNotes = await getNotesBetween(mondayStr, todayStr);

  // 本周（周一至今天）实际上过课的课程
  const attended = new Set();
  for (let d = new Date(monday); d <= now; d = addDays(d, 1)) {
    const tl = await getDayTimeline(d);
    for (const t of tl) if (t.entry) attended.add(t.entry.course);
  }

  let content = '';
  let viaAI = false;
  if (aiAvailable(s)) {
    try {
      const weekNotesText = weekNotes.map(n => {
        const imgs = (n.images || []).map(i => i.ocrText).filter(Boolean).join('\n');
        return `【${n.course} · ${n.date}】\n${[n.text, imgs].filter(Boolean).join('\n')}`;
      }).join('\n\n');
      content = await aiReviewPlan(s, {
        weekLabel: week ? `第 ${week} 周` : '本周',
        weekNotesText,
        coursesText: [...attended].join('、'),
      });
      viaAI = true;
    } catch (err) {
      showToast(`大模型生成失败（${err.message}），已改用本地算法`, 'error');
    }
  }
  if (!content) {
    const stats = weekCourseStats(weekNotes, [...attended], todayStr);
    content = buildReviewPlan({
      weekLabel: week ? `第 ${week} 周` : '本周',
      stats,
      isSunday: dayOfWeek(now) === 7,
    });
  }
  await saveSummary({
    date: saturdayStr,
    type: 'review',
    content,
    viaAI,
    generatedAt: new Date().toISOString(),
  });
  showToast('复习计划已生成 📚');
  refreshApp();
}

/* ---------- 历史查看 ---------- */

function openHistorySheet(h) {
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="md-content">${renderMarkdown(h.content)}</div>
    <div class="btn-row">
      <button class="btn btn-danger" id="h-delete">${icon('trash')} 删除</button>
    </div>`;
  const sheet = openSheet({
    title: `${h.type === 'daily' ? '学习总结' : '复习计划'} · ${h.date}`,
    content: div,
    full: true,
  });
  div.querySelector('#h-delete').addEventListener('click', async () => {
    if (await confirmDialog('删除这条总结？', { danger: true, okText: '删除' })) {
      await deleteSummary(h.id);
      sheet.close();
      showToast('已删除');
      refreshApp();
    }
  });
}
