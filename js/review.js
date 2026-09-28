// 周末复习计划生成（纯函数，可在 Node 测试）
// 按本周各课程的笔记量、疑问数、最近记录时间排出优先级，生成周六/周日时间块计划。

import { splitSentences, extractTodos, topSentences, termFreq } from './summarize.js';

// 复习时间块（周六、周日各 5 块）
const BLOCKS = {
  6: [['09:00', '10:00'], ['10:30', '11:30'], ['14:30', '15:30'], ['16:00', '17:00'], ['19:30', '20:30']],
  7: [['09:00', '10:00'], ['10:30', '11:30'], ['14:30', '15:30'], ['16:00', '17:00'], ['19:30', '20:30']],
};

/**
 * 汇总一周笔记：按课程统计
 * weekNotes: [{ course, text, images, date: 'YYYY-MM-DD' }]
 * attendedCourses: 本周实际上过课、但可能没笔记的课程名列表
 */
export function weekCourseStats(weekNotes, attendedCourses = [], today = '2026-01-01') {
  const map = new Map();
  for (const c of attendedCourses) {
    map.set(c, { course: c, noteCount: 0, points: [], todos: [], lastDate: null });
  }
  for (const note of weekNotes || []) {
    const course = note.course || '未分类';
    if (!map.has(course)) map.set(course, { course, noteCount: 0, points: [], todos: [], lastDate: null });
    const g = map.get(course);
    g.noteCount++;
    const text = [note.text, ...(note.images || []).map(im => im.ocrText)].filter(Boolean).join('\n');
    g.texts = (g.texts || []).concat(text);
    if (!g.lastDate || note.date > g.lastDate) g.lastDate = note.date;
  }
  for (const g of map.values()) {
    const all = (g.texts || []).join('\n');
    const sentences = splitSentences(all);
    g.points = sentences.length ? topSentences(sentences, termFreq(all), 3) : [];
    g.todos = [...new Set(extractTodos(all))].slice(0, 4);
    g.daysSince = g.lastDate
      ? Math.max(0, Math.round((new Date(today) - new Date(g.lastDate)) / 86400000))
      : 99;
  }
  // 优先级：没笔记 > 有疑问 > 笔记多 > 久未复习
  const list = [...map.values()];
  for (const g of list) {
    g.priority = (g.noteCount === 0 ? 8 : 0)
      + g.todos.length * 3
      + Math.min(g.noteCount, 5) * 2
      + Math.min(g.daysSince, 7) * 0.5;
  }
  list.sort((a, b) => b.priority - a.priority);
  return list;
}

/**
 * 生成周末复习计划 Markdown
 * stats: weekCourseStats() 的结果
 */
export function buildReviewPlan({ weekLabel, stats, isSunday }) {
  const lines = [];
  lines.push(`## 📚 ${weekLabel} · 周末复习计划`);
  lines.push('');

  if (!stats.length) {
    lines.push('本周还没有课程和笔记记录。先去「课表」导入课表、平时课后记点笔记，周末就能自动生成复习计划。');
    return lines.join('\n');
  }

  // 课程分配到时间块：
  // 第一轮每门课一块（优先填周六，溢出到周日）；第二轮给优先级前几名补一块（填周日）
  const sat = BLOCKS[6], sun = BLOCKS[7];
  const dayBlocks = [];
  let idx = 0;
  for (let i = 0; i < stats.length && idx < sat.length; i++) {
    dayBlocks.push({ day: 6, b: sat[idx++], course: stats[i].course, round: 1 });
  }
  for (let i = dayBlocks.length; i < stats.length && (idx - sat.length) < sun.length; i++) {
    dayBlocks.push({ day: 7, b: sun[idx++ - sat.length], course: stats[i].course, round: 1 });
  }
  let sunUsed = dayBlocks.filter(x => x.day === 7).length;
  for (let i = 0; i < stats.length && sunUsed < sun.length && i < 5; i++) {
    dayBlocks.push({ day: 7, b: sun[sunUsed++], course: stats[i].course, round: 2 });
  }

  const dayName = d => (d === 6 ? '周六' : '周日');
  for (const d of [6, 7]) {
    const blocks = dayBlocks.filter(x => x.day === d);
    if (!blocks.length) continue;
    lines.push(`### ${dayName(d)}`);
    for (const { b, course, round } of blocks) {
      const g = stats.find(s => s.course === course);
      const focus = round === 1
        ? (g.points.length ? `回顾要点：${g.points.slice(0, 2).join('；').slice(0, 60)}` : '翻看本周笔记与课本，整理知识框架')
        : (g.todos.length ? `攻克疑问与作业：${g.todos.slice(0, 2).join('；').slice(0, 60)}` : '做题巩固，检验复习效果');
      lines.push(`- **${b[0]}–${b[1]}** ${course}：${focus}`);
    }
    lines.push('');
  }

  const noNotes = stats.filter(s => s.noteCount === 0).map(s => s.course);
  if (noNotes.length) {
    lines.push(`> ⚠️ 这些课上过但本周没记笔记，建议优先补上：${noNotes.join('、')}`);
    lines.push('');
  }
  if (isSunday) {
    lines.push('> 🌙 周日晚记得看一眼「明日准备」，把明天的课本和材料放进书包。');
  }
  return lines.join('\n');
}
