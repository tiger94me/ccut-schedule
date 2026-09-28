// 纯函数模块测试：node tests/run-tests.mjs
import assert from 'node:assert/strict';

import {
  extractWeeks, looksLikeRoom, parseScheduleText, parseCellText,
  parseOcrGrid, normalizeEntries, matchDay,
} from '../js/parser.js';
import {
  entryActive, dayEntries, buildTimeline, nowStatus, suggestCourse,
  firstClassOfSessions,
} from '../js/model.js';
import {
  splitSentences, extractTodos, summarizeNotes, buildDailySummary,
} from '../js/summarize.js';
import { weekCourseStats, buildReviewPlan } from '../js/review.js';
import { weekNumber, minutesOf, dayOfWeek, fmtDuration } from '../js/util.js';
import { DEFAULT_PERIODS, loadSettings } from '../js/settings.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

console.log('\n[util]');
test('weekNumber 计算学期周次', () => {
  const start = '2026-09-07'; // 第1周周一
  assert.equal(weekNumber(new Date(2026, 8, 7), start), 1);   // 周一
  assert.equal(weekNumber(new Date(2026, 8, 13), start), 1);  // 周日
  assert.equal(weekNumber(new Date(2026, 8, 14), start), 2);  // 第二周周一
  assert.equal(weekNumber(new Date(2026, 8, 6), start), 0);   // 开学前
  assert.equal(weekNumber(new Date(2026, 8, 7), ''), 0);      // 未设置
});
test('minutesOf / dayOfWeek / fmtDuration', () => {
  assert.equal(minutesOf('08:05'), 485);
  assert.equal(dayOfWeek(new Date(2026, 8, 28)), 1); // 2026-09-28 周一
  assert.equal(dayOfWeek(new Date(2026, 9, 4)), 7);  // 周日
  assert.equal(fmtDuration(95), '1小时35分');
  assert.equal(fmtDuration(40), '40分钟');
});

console.log('\n[parser] extractWeeks');
test('范围周次 1-16周', () => {
  const { spec, rest } = extractWeeks('高等数学 1-16周 教三301');
  assert.deepEqual(spec, { start: 1, end: 16, parity: 'all' });
  assert.ok(!rest.includes('1-16周'));
});
test('单双周标记', () => {
  assert.equal(extractWeeks('3-16单周').spec.parity, 'odd');
  assert.equal(extractWeeks('双周').spec.parity, 'even');
  assert.deepEqual(extractWeeks('单周').spec, { start: 1, end: 99, parity: 'odd' });
});
test('第X周 单周次', () => {
  assert.deepEqual(extractWeeks('第3周上课').spec, { start: 3, end: 3, parity: 'all' });
});
test('括号形式 (1-16)', () => {
  assert.deepEqual(extractWeeks('大学英语(1-16)').spec, { start: 1, end: 16, parity: 'all' });
  assert.equal(extractWeeks('体育(单)').spec.parity, 'odd');
});
test('不吞教室号：逸夫楼303 单周', () => {
  const { spec, rest } = extractWeeks('大学英语 逸夫楼303 单周');
  assert.equal(spec.parity, 'odd');
  assert.ok(rest.includes('逸夫楼303'), '教室应保留在 rest 中');
});
test('节次不被当成周次：第3节', () => {
  assert.equal(extractWeeks('第3节 大学英语').spec, null);
});
test('matchDay', () => {
  assert.equal(matchDay('周一 1-2节 高数'), 1);
  assert.equal(matchDay('星期三 第3节'), 3);
  assert.equal(matchDay('礼拜天'), 7);
  assert.equal(matchDay('高等数学'), null);
});

console.log('\n[parser] looksLikeRoom');
test('常见教室格式', () => {
  assert.ok(looksLikeRoom('教三301'));
  assert.ok(looksLikeRoom('教三-301'));
  assert.ok(looksLikeRoom('逸夫楼303'));
  assert.ok(looksLikeRoom('A-201'));
  assert.ok(looksLikeRoom('1-202'));
  assert.ok(looksLikeRoom('N210'));
  assert.ok(!looksLikeRoom('高等数学'));
  assert.ok(!looksLikeRoom('高数2'));
  assert.ok(!looksLikeRoom('1-16周'));
});

console.log('\n[parser] parseScheduleText');
test('标准三行课表文本', () => {
  const entries = parseScheduleText([
    '周一 1-2节 高等数学(上) 教三-301 1-16周',
    '星期三 第3节 大学英语 逸夫楼303 单周',
    '周五 6-7节 大学物理实验 实验楼201 双周',
  ].join('\n'));
  assert.equal(entries.length, 3);
  const e1 = entries[0];
  assert.equal(e1.day, 1);
  assert.deepEqual(e1.periods, [1, 2]);
  assert.equal(e1.course, '高等数学(上)');
  assert.equal(e1.room, '教三-301');
  assert.deepEqual(e1.weeks, { start: 1, end: 16, parity: 'all' });
  const e2 = entries[1];
  assert.equal(e2.day, 3);
  assert.deepEqual(e2.periods, [3]);
  assert.equal(e2.course, '大学英语');
  assert.equal(e2.room, '逸夫楼303');
  assert.equal(e2.weeks.parity, 'odd');
  const e3 = entries[2];
  assert.equal(e3.weeks.parity, 'even');
});
test('无"节"字格式：周一 1-2 高数', () => {
  const entries = parseScheduleText('周一 1-2 高等数学 教三301');
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].periods, [1, 2]);
});
test('教师名识别', () => {
  const entries = parseScheduleText('周二 3-4节 线性代数 A-201 张伟 1-12周');
  assert.equal(entries[0].teacher, '张伟');
  assert.equal(entries[0].room, 'A-201');
});
test('无星期词的行被跳过', () => {
  assert.equal(parseScheduleText('高等数学 教三301').length, 0);
});

console.log('\n[parser] parseCellText');
test('课程+教室（空格分隔）', () => {
  const r = parseCellText('高等数学 教三301');
  assert.equal(r.course, '高等数学');
  assert.equal(r.room, '教三301');
});
test('课程+教室（无空格粘连）', () => {
  const r = parseCellText('线代A201');
  assert.equal(r.course, '线代');
  assert.equal(r.room, 'A201');
});
test('含周次', () => {
  const r = parseCellText('大学英语 1-16周');
  assert.equal(r.course, '大学英语');
  assert.deepEqual(r.weeks, { start: 1, end: 16, parity: 'all' });
  const r2 = parseCellText('体育(单)');
  assert.equal(r2.course, '体育');
  assert.equal(r2.weeks.parity, 'odd');
});
test('噪声格返回 null', () => {
  assert.equal(parseCellText('午休'), null);
  assert.equal(parseCellText('第3节'), null);
  assert.equal(parseCellText('周一'), null);
  assert.equal(parseCellText(''), null);
});
test('纯教室号（无课程名）返回 null', () => {
  assert.equal(parseCellText('1-202'), null);
});
test('纯课程名', () => {
  const r = parseCellText('高等数学');
  assert.equal(r.course, '高等数学');
  assert.equal(r.room, '');
});

console.log('\n[parser] parseOcrGrid');
// 构造一个 3 天 × 2 节的模拟课表 OCR 结果
const sym = (text, x0, y0, x1, y1) => ({ text, bbox: { x0, y0, x1, y1 } });
const ocrSymbols = [
  // 表头行 y=10..30：周一(x~50) 周二(x~200) 周三(x~350)
  sym('周', 30, 10, 45, 30), sym('一', 45, 10, 60, 30),
  sym('周', 180, 10, 195, 30), sym('二', 195, 10, 210, 30),
  sym('周', 330, 10, 345, 30), sym('三', 345, 10, 360, 30),
  // 行1（节次1）y=60..80
  sym('1', 10, 60, 25, 80),
  sym('高', 60, 60, 78, 80), sym('数', 78, 60, 96, 80),
  sym('英', 210, 60, 228, 80), sym('语', 228, 60, 246, 80),
  sym('物', 360, 60, 378, 80), sym('理', 378, 60, 396, 80),
  // 行2（节次2）y=120..140
  sym('2', 10, 120, 25, 140),
  sym('线', 60, 120, 72, 140), sym('代', 72, 120, 84, 140),
  sym('A', 90, 120, 100, 140), sym('2', 100, 120, 108, 140),
  sym('0', 108, 120, 116, 140), sym('1', 116, 120, 124, 140),
  sym('物', 360, 120, 378, 140), sym('理', 378, 120, 396, 140),
];
const ocrLines = [
  { text: '周一 周二 周三', bbox: { x0: 30, y0: 10, x1: 360, y1: 30 } },
];
test('表格还原：3 列 2 行', () => {
  const { entries, error } = parseOcrGrid(ocrSymbols, ocrLines);
  assert.equal(error, null);
  assert.equal(entries.length, 4, `应解析出 4 条（物理连堂合并），实际 ${entries.length}: ${JSON.stringify(entries)}`);
  const physics = entries.find(e => e.course === '物理');
  assert.ok(physics, '应包含物理课');
  assert.deepEqual(physics.periods, [1, 2], '物理应合并为连堂');
  assert.equal(physics.day, 3);
  const linear = entries.find(e => e.course === '线代');
  assert.ok(linear, '应包含线代');
  assert.equal(linear.room, 'A201');
  assert.equal(linear.day, 1);
  assert.deepEqual(linear.periods, [2]);
  const math = entries.find(e => e.course === '高数');
  assert.deepEqual(math.periods, [1]);
});
test('无表头时报错', () => {
  const { error } = parseOcrGrid(ocrSymbols, [{ text: '随便一行', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }]);
  assert.equal(error, 'no-header');
});

console.log('\n[parser] normalizeEntries');
test('AI JSON 清洗', () => {
  const out = normalizeEntries([
    { day: 1, periods: [1, 2], course: '高数', room: 'A101', weeks: { start: 1, end: 16 } },
    { day: 9, periods: [1], course: '无效星期' },
    { day: 2, periods: [], course: '无节次' },
    { day: 3, periods: [3], course: '' },
    { day: 4, periods: [5, 5, 4], course: '去重排序' },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[1].periods, [4, 5]);
  assert.equal(out[0].weeks.parity, 'all');
});

console.log('\n[model]');
const testEntries = [
  { id: 'a', day: 1, periods: [1, 2], course: '高数', room: 'A101', weeks: { start: 1, end: 16, parity: 'all' } },
  { id: 'b', day: 1, periods: [3], course: '英语', room: 'B202', weeks: { start: 1, end: 99, parity: 'odd' } },
  { id: 'c', day: 1, periods: [5], course: '体育', room: '操场', weeks: { start: 1, end: 99, parity: 'even' } },
];
test('entryActive 单双周', () => {
  assert.ok(entryActive(testEntries[0], 3));
  assert.ok(!entryActive(testEntries[0], 17), '超出 1-16 周');
  assert.ok(entryActive(testEntries[1], 3), '单周课在第 3 周（单数）生效');
  assert.ok(!entryActive(testEntries[1], 4));
  assert.ok(entryActive(testEntries[2], 4), '双周课在第 4 周（双数）生效');
  assert.ok(!entryActive(testEntries[2], 5));
});
test('buildTimeline 对齐节次与课程', () => {
  const tl = buildTimeline(DEFAULT_PERIODS.slice(0, 5), dayEntries(testEntries, 1, 3));
  assert.equal(tl.length, 5);
  assert.equal(tl[0].entry?.id, 'a');
  assert.equal(tl[2].entry?.id, 'b'); // 第3节 英语（单周，第3周生效）
  assert.equal(tl[4].entry, null, '体育双周课第3周不生效');
});
test('nowStatus 当前课/下一节', () => {
  const tl = buildTimeline(DEFAULT_PERIODS, dayEntries(testEntries, 1, 3));
  // 8:20（第1节中）
  let st = nowStatus(tl, 8 * 60 + 20);
  assert.equal(st.current?.entry.id, 'a');
  // 7:20（第1节前）
  st = nowStatus(tl, 7 * 60 + 20);
  assert.equal(st.current, null);
  assert.equal(st.next?.entry.id, 'a');
  assert.equal(st.minutesToNext, 40);
  // 12:00（全部结束）
  st = nowStatus(tl, 12 * 60);
  assert.equal(st.current, null);
  assert.equal(st.next, null);
});
test('suggestCourse 推荐正在上/刚下课', () => {
  const tl = buildTimeline(DEFAULT_PERIODS, dayEntries(testEntries, 1, 3));
  assert.equal(suggestCourse(tl, 8 * 60 + 20)?.entry.id, 'a'); // 正在上
  assert.equal(suggestCourse(tl, 9 * 60 + 50)?.entry.id, 'a'); // 9:50 刚下第2节（连堂）
  assert.equal(suggestCourse(tl, 15 * 60)?.entry.id, 'b');     // 下午 → 最近下课的是第3节英语
});
test('firstClassOfSessions', () => {
  const tl = buildTimeline(DEFAULT_PERIODS, dayEntries(testEntries, 1, 3));
  const m = firstClassOfSessions(tl);
  assert.equal(m.get('morning')?.entry.id, 'a');
  assert.equal(m.get('afternoon'), undefined, '第5节体育双周不生效');
});

console.log('\n[summarize]');
test('splitSentences 分句', () => {
  const ss = splitSentences('今天讲了极限的定义。重点是 epsilon-delta 语言！作业是 P23 的 1-5 题；下周小测。');
  assert.equal(ss.length, 4);
});
test('extractTodos 提取待办与疑问', () => {
  const todos = extractTodos('今天讲了极限。作业是 P23 的 1-5 题。这个定理的证明没听懂？');
  assert.equal(todos.length, 2);
  assert.ok(todos.some(t => t.includes('作业')));
  assert.ok(todos.some(t => t.includes('没听懂')));
});
test('summarizeNotes 按课程分组并提取要点', () => {
  const { courses, stats } = summarizeNotes([
    { course: '高数', text: '今天讲了极限的定义与性质。极限的epsilon-delta定义是重点。极限的性质包括唯一性和有界性。', images: [] },
    { course: '高数', text: '作业是 P23 的 1-5 题。', images: [] },
    { course: '英语', text: '学了 Unit 2 的课文。背诵第二段。', images: [{ ocrText: 'Unit 2 words: abandon, ability' }] },
  ]);
  assert.equal(stats.noteCount, 3);
  assert.equal(stats.imageCount, 1);
  const math = courses.find(c => c.course === '高数');
  assert.ok(math.points.length >= 1, '高数应有要点');
  assert.ok(math.todos.some(t => t.includes('作业')));
  const eng = courses.find(c => c.course === '英语');
  assert.ok(eng.todos.some(t => t.includes('背诵')));
});
test('buildDailySummary 生成 markdown', () => {
  const md = buildDailySummary({
    dateLabel: '9月28日 周一',
    weekLabel: ' · 第4周',
    notes: [{ course: '高数', text: '讲了极限定义。作业 P23。', images: [] }],
    tomorrow: [{ periods: [1, 2], course: '高数', room: 'A101', start: '08:00', end: '09:40' }],
    noNoteCourses: ['英语'],
  });
  assert.ok(md.includes('学习总结'));
  assert.ok(md.includes('高数'));
  assert.ok(md.includes('明日准备'));
  assert.ok(md.includes('A101'));
  assert.ok(md.includes('英语'), '应提示没记笔记的课程');
  assert.ok(md.includes('第4周'));
});

console.log('\n[review]');
test('weekCourseStats 优先级排序', () => {
  const stats = weekCourseStats(
    [
      { course: '高数', text: '极限定义。作业P23。', images: [], date: '2026-09-28' },
      { course: '高数', text: '连续性。', images: [], date: '2026-09-25' },
    ],
    ['英语'], // 上过课但没笔记
    '2026-09-28',
  );
  const english = stats.find(s => s.course === '英语');
  assert.equal(english.noteCount, 0);
  assert.ok(english.priority > 0, '没笔记的课程应有正的优先级');
  const math = stats.find(s => s.course === '高数');
  assert.equal(math.noteCount, 2);
  assert.ok(math.points.length >= 1);
});
test('buildReviewPlan 生成时间块', () => {
  const stats = weekCourseStats(
    [{ course: '高数', text: '极限。', images: [], date: '2026-09-28' }],
    ['英语'],
    '2026-09-28',
  );
  const md = buildReviewPlan({ weekLabel: '第 4 周', stats, isSunday: false });
  assert.ok(md.includes('周六'));
  assert.ok(md.includes('周日'));
  assert.ok(md.includes('英语'), '没笔记的课程应被点名');
  assert.ok(md.includes('复习计划'));
});

console.log('\n[settings]');
test('loadSettings 默认值（Node 无 localStorage）', () => {
  const s = loadSettings();
  assert.equal(s.periods.length, 11);
  assert.equal(s.reminder.lead, 40);
  assert.equal(s.reminder.mode, 'session');
  assert.equal(s.ai.enabled, false);
});

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed ? 1 : 0);
