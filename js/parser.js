// 课表解析（纯函数，可在 Node 测试）：
// - parseScheduleText: 粘贴的文本课表 -> 条目
// - parseCellText:     OCR 单格文本 -> {course, room, weeks}
// - parseOcrGrid:      OCR 字符块（带坐标）-> 条目（按表头列 + 行聚类还原表格）
// - normalizeEntries:  AI 输出的 JSON 条目 -> 规范条目

const DAY_CHARS = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
const DAY_RE = /(?:星期|周|礼拜)\s*([一二三四五六日天])/g;

// 在文本中找第一个星期词，返回 1-7
export function matchDay(text) {
  DAY_RE.lastIndex = 0;
  const m = DAY_RE.exec(String(text || ''));
  return m ? DAY_CHARS[m[1]] : null;
}

/**
 * 提取周次信息并从文本中剥离。返回 { spec, rest }
 * 支持：1-16周 / 第3-16周 / 3周 / 单周 / 双周 / (1-16) / （1-16周） / (单)
 * 注意：数字前导用 [^\d] 保护，避免把教室号 "303" 吞进周次。
 */
export function extractWeeks(text) {
  let rest = String(text || '');
  const mk = (start, end, parity = 'all') => ({ start, end, parity });
  const parityOf = c => (c === '单' ? 'odd' : c === '双' ? 'even' : 'all');

  // 1) X至Y周（含可选单双）
  let m = rest.match(/(^|[^\d])(第?\s*\d{1,2}\s*[-–—~至]\s*\d{1,2}\s*(单|双)?\s*周)/);
  if (m) {
    const nums = m[2].match(/\d{1,2}/g);
    return { spec: mk(+nums[0], +nums[1], parityOf(m[3])), rest: rest.replace(m[2], ' ') };
  }
  // 2) 第X周 / X周（"第3节"不会匹配：需要"周"结尾）
  m = rest.match(/(^|[^\d])(第?\s*\d{1,2}\s*(单|双)?\s*周)/);
  if (m) {
    const n = +m[2].match(/\d{1,2}/)[0];
    return { spec: mk(n, n, parityOf(m[3])), rest: rest.replace(m[2], ' ') };
  }
  // 3) 单周 / 双周
  if (/(^|[^\d])单周/.test(rest)) return { spec: mk(1, 99, 'odd'), rest: rest.replace('单周', ' ') };
  if (/(^|[^\d])双周/.test(rest)) return { spec: mk(1, 99, 'even'), rest: rest.replace('双周', ' ') };
  // 4) 括号形式：(1-16) / （1-16周） / (单)
  m = rest.match(/[（(]\s*(\d{1,2})\s*[-–—~至]\s*(\d{1,2})\s*(单|双)?\s*周?\s*[)）]/);
  if (m) {
    return { spec: mk(+m[1], +m[2], parityOf(m[3])), rest: rest.replace(m[0], ' ') };
  }
  m = rest.match(/[（(]\s*(单|双)\s*[)）]/);
  if (m) {
    return { spec: mk(1, 99, parityOf(m[1])), rest: rest.replace(m[0], ' ') };
  }
  return { spec: null, rest };
}

// 提取节次（带"节"字的形式）。返回 [1,2] 或 null
export function extractPeriods(text) {
  const s = String(text || '');
  let m = s.match(/第?\s*(\d{1,2})\s*[-–—~至]\s*(\d{1,2})\s*节/);
  if (m) {
    const a = +m[1], b = +m[2];
    const out = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
    return out;
  }
  m = s.match(/第?\s*(\d{1,2})\s*节/);
  if (m) return [+m[1]];
  return null;
}

// 是否像教室名：教三301 / 逸夫楼303 / A-201 / 1-202 / N210 / 教三-301
export function looksLikeRoom(t) {
  if (!t || t.length > 14) return false;
  if (/[()（）周节，,]/.test(t)) return false;
  if (/(楼|教|馆|区|栋|层|室|座)/.test(t) && /\d/.test(t)) return true;
  if (/[A-Za-z]\d{2,4}$/.test(t)) return true;
  if (/^\d{1,4}[-—]\d{2,4}$/.test(t)) return true;
  return /\d{2,4}$/.test(t) && t.length <= 10;
}

// 规范化周次对象
export function normalizeWeeks(w) {
  if (!w || typeof w !== 'object') return null;
  const start = Math.max(1, +w.start || 1);
  const end = Math.max(start, +w.end || start);
  const parity = ['odd', 'even'].includes(w.parity) ? w.parity : 'all';
  return { start, end, parity };
}

/**
 * 解析粘贴的文本课表，每行一条，例如：
 *   周一 1-2节 高等数学(上) 教三-301 1-16周
 *   星期三 第3节 大学英语 逸夫楼303 单周
 * 返回条目数组（不含 id）
 */
export function parseScheduleText(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n|;/);
  for (const line of lines) {
    const day = matchDay(line);
    if (!day) continue;

    // 先剥离周次（避免 "1-16周" 被当成节次）
    const { spec: weeks, rest: r1 } = extractWeeks(line);
    // 节次：带"节"字
    let periods = extractPeriods(r1);
    let rest = r1;
    if (!periods) {
      // 无"节"字：匹配紧跟星期词的数字范围，且后面不是"周"（如 "周一 1-2 高数"）
      const m = rest.match(/(?:星期|周|礼拜)\s*[一二三四五六日天]\s*第?\s*(\d{1,2})\s*[-–—~至]\s*(\d{1,2})(?!\s*周)/);
      if (m) {
        const a = +m[1], b = +m[2];
        periods = [];
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) periods.push(i);
        rest = rest.replace(m[0], ' ');
      } else {
        const m2 = rest.match(/(?:星期|周|礼拜)\s*[一二三四五六日天]\s*第?\s*(\d{1,2})(?!\s*周)/);
        if (m2) {
          periods = [+m2[1]];
          rest = rest.replace(m2[0], ' ');
        }
      }
    } else {
      // 把节次文本从 rest 中去掉（保留课程名等）
      rest = rest.replace(/第?\s*\d{1,2}\s*[-–—~至]\s*\d{1,2}\s*节/, ' ')
                 .replace(/第?\s*\d{1,2}\s*节/, ' ');
    }
    if (!periods || !periods.length) continue;

    // 去掉星期词，分词
    rest = rest.replace(/(?:星期|周|礼拜)\s*[一二三四五六日天]/g, ' ');
    const tokens = rest.split(/[\s,，、\t]+/).map(t => t.trim()).filter(Boolean);
    if (!tokens.length) continue;

    const course = tokens[0];
    if (!/[一-龥A-Za-z]/.test(course)) continue;
    let room = '';
    let teacher = '';
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (!room && looksLikeRoom(t)) { room = t; continue; }
      // 剩余的 2-4 个纯汉字 token 视为教师名
      if (!teacher && /^[一-龥]{2,4}$/.test(t)) teacher = t;
    }
    out.push({
      day, periods, course, room, teacher,
      weeks: weeks || { start: 1, end: 99, parity: 'all' },
    });
  }
  return out;
}

// OCR 表格的噪声格（表头/午休等）
const NOISE_CELL_RE = /^(?:午休|中午|上午|下午|晚上|晚间|备注|教室|时间|课程|名称|星期|周[一二三四五六日天]|第?\d{1,2}节)+$/;

function cleanCourse(s) {
  return s.replace(/^[^一-龥A-Za-z]+/, '')
    .replace(/[^一-龥A-Za-z0-9()（）]+$/, '')
    .replace(/[()（）\s]+$/, '');
}

function validCourse(c) {
  return !!c && c.length >= 2 && /[一-龥A-Za-z]/.test(c);
}

/**
 * 解析 OCR 识别出的单个表格格文本（无星期/节次信息，只有课程内容）
 * 返回 { course, room, weeks } 或 null
 */
export function parseCellText(raw) {
  const rawText = String(raw || '').replace(/[\t\r\n]+/g, ' ').trim();
  if (!rawText) return null;
  const compact = rawText.replace(/[\s　]+/g, '');
  if (compact.length < 2) return null;
  if (NOISE_CELL_RE.test(compact)) return null;

  // 有空白分隔：按 token 分离（周次 / 教室 / 课程）
  if (/[\s　]/.test(rawText)) {
    const tokens = rawText.split(/[\s　]+/).filter(Boolean);
    const courseParts = [];
    let room = '';
    let weeks = null;
    for (const tk of tokens) {
      const { spec } = extractWeeks(tk);
      if (spec && /周|单|双|[()（）]/.test(tk)) { weeks = spec; continue; }
      if (!room && looksLikeRoom(tk)) { room = tk; continue; }
      courseParts.push(tk);
    }
    const course = cleanCourse(courseParts.join(''));
    if (!validCourse(course)) return null;
    return { course, room, weeks: weeks || { start: 1, end: 99, parity: 'all' } };
  }

  // 无空白：整串处理
  const { spec: weeks, rest } = extractWeeks(compact);
  // 尾部教室：带地点关键词（教/楼/馆…）或字母前缀，或 纯数字-数字 形式
  const m = rest.match(/(?:[一-龥]{0,3}(?:楼|教|馆|区|栋|层|座)|[A-Z])[一-龥\d]{0,3}[-—]?\d{2,4}$/)
    || rest.match(/\d{1,3}[-—]\d{2,4}$/);
  if (m && m[0] !== rest) {
    const course = cleanCourse(rest.slice(0, rest.length - m[0].length));
    if (validCourse(course)) {
      return { course, room: m[0], weeks: weeks || { start: 1, end: 99, parity: 'all' } };
    }
  }
  const course = cleanCourse(rest);
  if (!validCourse(course)) return null;
  return { course, room: '', weeks: weeks || { start: 1, end: 99, parity: 'all' } };
}

/**
 * 用 OCR 字符块（带坐标）还原表格课表。
 * symbols: [{ text, bbox: {x0,y0,x1,y1} }]（Tesseract symbols，中文通常单字一块）
 * lines:   [{ text, bbox }]（用于定位表头行）
 * 思路：表头行中各星期词的 x 位置作为列锚点 -> 字符按 x 分到星期列、
 *       按 y 聚类成行 -> 每格拼接文本（间隙大时补空格）-> parseCellText
 *       -> 相邻同课合并连堂
 */
export function parseOcrGrid(symbols, lines) {
  symbols = (symbols || []).filter(s => s && s.text && s.bbox);
  lines = (lines || []).filter(l => l && l.text && l.bbox);
  if (!symbols.length) return { entries: [], error: 'empty' };

  // 1. 找表头行：含 >= 2 个星期词的行
  let header = null;
  for (const line of lines) {
    DAY_RE.lastIndex = 0;
    let count = 0;
    while (DAY_RE.exec(line.text.replace(/\s/g, ''))) count++;
    if (count >= 2) { header = line; break; }
  }
  if (!header) return { entries: [], error: 'no-header' };

  // 2. 表头行 y 范围内的星期字符 -> 列锚点
  const hy0 = header.bbox.y0 - 4, hy1 = header.bbox.y1 + 4;
  const anchors = [];
  for (const sym of symbols) {
    const yc = (sym.bbox.y0 + sym.bbox.y1) / 2;
    if (yc < hy0 || yc > hy1) continue;
    const ch = sym.text.trim();
    if (DAY_CHARS[ch]) anchors.push({ day: DAY_CHARS[ch], x: (sym.bbox.x0 + sym.bbox.x1) / 2 });
  }
  anchors.sort((a, b) => a.x - b.x);
  // 去掉同一天的重复锚点（保留第一个）
  const seen = new Set();
  const cols = anchors.filter(a => { if (seen.has(a.day)) return false; seen.add(a.day); return true; });
  if (cols.length < 2) return { entries: [], error: 'no-header' };

  // 3. 列边界：相邻锚点的中点
  const colRanges = cols.map((c, i) => {
    const left = i === 0 ? -Infinity : (cols[i - 1].x + c.x) / 2;
    const right = i === cols.length - 1 ? Infinity : (c.x + cols[i + 1].x) / 2;
    return { day: c.day, left, right };
  });
  const firstColLeft = colRanges[0].left === -Infinity
    ? Math.min(...symbols.map(s => s.bbox.x0))
    : colRanges[0].left;

  // 4. 行高估计（字符高度中位数）
  const heights = symbols.map(s => s.bbox.y1 - s.bbox.y0).filter(h => h > 2).sort((a, b) => a - b);
  const rowH = heights.length ? heights[Math.floor(heights.length / 2)] : 20;

  // 5. 全局行聚类（排除表头字符）
  const body = symbols.filter(s => {
    const yc = (s.bbox.y0 + s.bbox.y1) / 2;
    return !(yc >= hy0 && yc <= hy1);
  }).sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));

  const rows = [];
  for (const sym of body) {
    const yc = (sym.bbox.y0 + sym.bbox.y1) / 2;
    const last = rows[rows.length - 1];
    if (last && Math.abs(yc - last.yc) <= rowH * 1.4) {
      last.symbols.push(sym);
      // 行中心取均值，增强抗倾斜能力
      last.yc = (last.yc * (last.symbols.length - 1) + yc) / last.symbols.length;
    } else {
      rows.push({ yc, symbols: [sym] });
    }
  }

  // 6. 每行：按 x 分列；字符间隙大时补空格（便于课程/教室分词）
  const cells = []; // { day, rowIdx, text }
  rows.forEach((row, rowIdx) => {
    const byDay = new Map();
    const leftmost = [];
    for (const sym of row.symbols) {
      const xc = (sym.bbox.x0 + sym.bbox.x1) / 2;
      if (xc < firstColLeft) { leftmost.push(sym); continue; }
      for (const col of colRanges) {
        if (xc >= col.left && xc < col.right) {
          if (!byDay.has(col.day)) byDay.set(col.day, []);
          byDay.get(col.day).push(sym);
          break;
        }
      }
    }
    // 节次行号：最左列拼接出的数字（如 "1" "10"）
    let rowNo = null;
    if (leftmost.length) {
      leftmost.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      const num = leftmost.map(s => s.text.trim()).join('').match(/^\d{1,2}$/);
      if (num) rowNo = +num[0];
    }
    row.rowNo = rowNo;
    for (const [day, syms] of byDay) {
      syms.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      let text = '';
      let prevEnd = null;
      for (const s of syms) {
        const w = s.bbox.x1 - s.bbox.x0;
        if (prevEnd !== null && s.bbox.x0 - prevEnd > w * 0.5) text += ' ';
        text += s.text;
        prevEnd = s.bbox.x1;
      }
      cells.push({ day, rowIdx, rowNo, text });
    }
  });

  // 7. 每格解析；行号优先用最左列数字，否则按行序
  const entries = [];
  for (const cell of cells) {
    const parsed = parseCellText(cell.text);
    if (!parsed) continue;
    const row = rows[cell.rowIdx];
    const period = cell.rowNo || row.rowNo || (cell.rowIdx + 1);
    if (!(period >= 1 && period <= 20)) continue;
    entries.push({ day: cell.day, periods: [period], ...parsed, teacher: '' });
  }

  // 8. 合并连堂：同一天相邻节次、同课程同教室
  entries.sort((a, b) => a.day - b.day || a.periods[0] - b.periods[0]);
  const merged = [];
  for (const e of entries) {
    const prev = merged[merged.length - 1];
    if (prev && prev.day === e.day
      && prev.course === e.course && prev.room === e.room
      && e.periods[0] === prev.periods[prev.periods.length - 1] + 1) {
      prev.periods.push(e.periods[0]);
      // 周次取并集范围
      if (e.weeks && prev.weeks) {
        prev.weeks = {
          start: Math.min(prev.weeks.start, e.weeks.start),
          end: Math.max(prev.weeks.end, e.weeks.end),
          parity: prev.weeks.parity === e.weeks.parity ? prev.weeks.parity : 'all',
        };
      }
    } else {
      merged.push({ ...e, periods: [...e.periods] });
    }
  }
  return { entries: merged, error: null };
}

/**
 * 规范化 AI 输出的课表 JSON 条目（也用于导入前统一清洗）
 */
export function normalizeEntries(list) {
  const out = [];
  for (const r of list || []) {
    if (!r || typeof r !== 'object') continue;
    const day = +r.day;
    if (!(day >= 1 && day <= 7)) continue;
    const rawPeriods = Array.isArray(r.periods) ? r.periods : [r.periods];
    const periods = [...new Set(rawPeriods.map(Number).filter(n => n >= 1 && n <= 20))].sort((a, b) => a - b);
    if (!periods.length) continue;
    const course = String(r.course || '').trim();
    if (!course) continue;
    out.push({
      day, periods, course,
      room: String(r.room || '').trim(),
      teacher: String(r.teacher || '').trim(),
      weeks: normalizeWeeks(r.weeks) || { start: 1, end: 99, parity: 'all' },
    });
  }
  return out;
}
