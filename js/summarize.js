// 本地总结（纯函数，可在 Node 测试）：
// 中文无分词，采用 2-gram 词频对句子打分的抽取式总结；同时提取"待办/疑问"句。

const TODO_WORDS = ['作业', '预习', '复习', '考试', '交', '截止', '背诵', '练习', '下次', '带', '准备', '提交', ' quiz', 'quiz', '报告', '论文'];
const QUESTION_TAIL = /[？？?]\s*$/;

// 分句：句末标点后断开
export function splitSentences(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/([。！？!?；;\n])/g, '$1\u0000')
    .split('\u0000')
    .map(s => s.trim())
    .filter(s => s.replace(/[。！？!?；;，,\s]/g, '').length >= 4);
}

// 2-gram 频率表
export function termFreq(text) {
  const clean = String(text || '').replace(/[^一-龥A-Za-z0-9]/g, '');
  const freq = new Map();
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2);
    freq.set(g, (freq.get(g) || 0) + 1);
  }
  return freq;
}

// 句子得分：包含的高频 2-gram 越多越好，长句适当惩罚
function scoreSentence(sentence, freq) {
  const clean = sentence.replace(/[^一-龥A-Za-z0-9]/g, '');
  if (!clean.length) return 0;
  let score = 0;
  for (let i = 0; i < clean.length - 1; i++) {
    score += freq.get(clean.slice(i, i + 2)) || 0;
  }
  return score / Math.sqrt(clean.length);
}

// 抽取要点句（每门课取前 n 句，相似句去重）
export function topSentences(sentences, freq, n = 3) {
  const scored = sentences.map((s, i) => ({ s, i, score: scoreSentence(s, freq) }));
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const seenHeads = new Set();
  for (const item of scored) {
    const head = item.s.replace(/[^一-龥A-Za-z0-9]/g, '').slice(0, 8);
    if (seenHeads.has(head)) continue;
    seenHeads.add(head);
    picked.push(item);
    if (picked.length >= n) break;
  }
  return picked.sort((a, b) => a.i - b.i).map(p => p.s);
}

// 待办/疑问句
export function extractTodos(text) {
  const out = [];
  for (const s of splitSentences(text)) {
    if (QUESTION_TAIL.test(s) || TODO_WORDS.some(w => s.includes(w))) out.push(s);
  }
  return out;
}

/**
 * 汇总一批笔记（按课程分组）。
 * notes: [{ course, text, images: [{ocrText}] }]
 * 返回 { courses: [{ course, noteCount, points[], todos[] }], stats }
 */
export function summarizeNotes(notes) {
  const byCourse = new Map();
  let charCount = 0, imageCount = 0;
  for (const note of notes || []) {
    const course = note.course || '未分类';
    const text = [note.text, ...(note.images || []).map(im => im.ocrText)].filter(Boolean).join('\n');
    charCount += text.length;
    imageCount += (note.images || []).length;
    if (!byCourse.has(course)) byCourse.set(course, { course, texts: [], noteCount: 0 });
    const g = byCourse.get(course);
    g.texts.push(text);
    g.noteCount++;
  }
  // 全局词频（跨课程统计，更突出当天重点）
  const allText = [...byCourse.values()].map(g => g.texts.join('\n')).join('\n');
  const freq = termFreq(allText);

  const courses = [...byCourse.values()].map(g => {
    const sentences = splitSentences(g.texts.join('\n'));
    return {
      course: g.course,
      noteCount: g.noteCount,
      points: sentences.length ? topSentences(sentences, freq, 3) : [],
      todos: [...new Set(extractTodos(g.texts.join('\n')))].slice(0, 5),
    };
  });
  return { courses, stats: { noteCount: (notes || []).length, imageCount, charCount } };
}

function periodsLabel(periods) {
  if (!periods || !periods.length) return '';
  const ps = [...periods].sort((a, b) => a - b);
  if (ps.length === 1) return `第${ps[0]}节`;
  return `第${ps[0]}-${ps[ps.length - 1]}节`;
}

/**
 * 生成"今日总结 + 明日准备" Markdown（本地算法版）
 * tomorrow: [{ periods, course, room, start, end }]
 */
export function buildDailySummary({ dateLabel, weekLabel, notes, tomorrow, noNoteCourses }) {
  const { courses, stats } = summarizeNotes(notes);
  const lines = [];
  lines.push(`## 📅 ${dateLabel}${weekLabel} · 学习总结`);
  lines.push('');

  if (!notes || !notes.length) {
    lines.push('今天还没有记录笔记。吃完晚饭补一补，哪怕每门课一句话也好。');
  } else {
    lines.push(`今天共记录 **${stats.noteCount}** 条笔记${stats.imageCount ? `、${stats.imageCount} 张照片` : ''}。`);
    lines.push('');
    for (const c of courses) {
      lines.push(`### ${c.course}（${c.noteCount} 条笔记）`);
      for (const p of c.points) lines.push(`- ${p}`);
      if (c.todos.length) {
        lines.push('');
        lines.push('**待办 / 疑问**');
        for (const t of c.todos) lines.push(`- [ ] ${t}`);
      }
      lines.push('');
    }
  }

  if (noNoteCourses && noNoteCourses.length) {
    lines.push(`> ⚠️ 今天上了课但没记笔记：${noNoteCourses.join('、')}`);
    lines.push('');
  }

  lines.push('### 🎒 明日准备');
  if (tomorrow && tomorrow.length) {
    for (const t of tomorrow) {
      const time = t.start ? `（${t.start} 开始）` : '';
      lines.push(`- ${periodsLabel(t.periods)} **${t.course}**${t.room ? ` · ${t.room}` : ''}${time} —— 提前看好教室，带上对应课本/材料`);
    }
  } else {
    lines.push('- 明天没有排课，好好休息 🎉');
  }
  return lines.join('\n');
}
