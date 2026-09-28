// 课表页：周视图网格、手动编辑、导入（拍照识别 / 相册识别 / 粘贴文本）、导入确认

import { loadSettings } from '../settings.js';
import { getEntries, saveEntry, deleteEntry } from '../data.js';
import { dayEntries } from '../model.js';
import { weekNumber, dayOfWeek, DAY_NAMES, escapeHtml, courseColorIndex, refreshApp } from '../util.js';
import { normalizeEntries, parseScheduleText, parseOcrGrid, extractWeeks } from '../parser.js';
import { preprocessImage, ocrCanvas } from '../ocr.js';
import { aiRecognizeSchedule, visionReady } from '../ai.js';
import { openSheet, closeSheet, showToast, confirmDialog, icon } from '../ui.js';

let viewWeekOffset = 0; // 相对当前周的偏移（查看其他周的单双周课程）

export async function render(root) {
  const s = loadSettings();
  const now = new Date();
  const curWeek = weekNumber(now, s.semesterStart);
  const week = Math.max(1, curWeek + viewWeekOffset);
  const entries = await getEntries();

  // day-period -> entry 矩阵
  const grid = new Map();
  for (let day = 1; day <= 7; day++) {
    for (const e of dayEntries(entries, day, week)) {
      for (const p of e.periods) grid.set(`${day}-${p}`, e);
    }
  }

  const todayDay = dayOfWeek(now);
  const isCurrentWeek = viewWeekOffset === 0;

  // 表头
  let head = '<div class="sg-head sg-corner"></div>';
  for (let day = 1; day <= 7; day++) {
    head += `<div class="sg-head ${isCurrentWeek && day === todayDay ? 'sg-today' : ''}">${DAY_NAMES[day]}</div>`;
  }

  // 节次行：设置中的节次 + 超出范围的节次（导入的课可能超过默认节数）
  const maxPeriod = Math.max(
    ...s.periods.map(p => p.id),
    ...entries.flatMap(e => e.periods.map(Number)),
    0,
  );
  let rows = '';
  for (let pid = 1; pid <= maxPeriod; pid++) {
    const p = s.periods.find(x => x.id === pid);
    rows += `<div class="sg-period">第${pid}节${p ? `<span>${p.start}</span>` : ''}</div>`;
    for (let day = 1; day <= 7; day++) {
      const e = grid.get(`${day}-${pid}`);
      if (!e) {
        rows += `<div class="sg-cell sg-empty" data-day="${day}" data-period="${pid}"></div>`;
        continue;
      }
      const cont = e.periods[0] !== pid; // 连堂续节（非首节）
      const ci = courseColorIndex(e.course);
      rows += cont
        ? `<div class="sg-cell sg-cont c${ci}" data-day="${day}" data-period="${pid}"><span class="cont-mark">↑</span></div>`
        : `<div class="sg-cell c${ci}" data-day="${day}" data-period="${pid}">
             <span class="sg-course">${escapeHtml(e.course)}</span>
             ${e.room ? `<span class="sg-room">${escapeHtml(e.room)}</span>` : ''}
           </div>`;
    }
  }

  const weekText = curWeek
    ? `第 ${week} 周${viewWeekOffset === 0 ? '（本周）' : ''}`
    : '未设置学期';

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>我的课表</h1>
        <div class="sub">${weekText} · 共 ${s.totalWeeks} 周 · 点击格子编辑</div>
      </div>
      <div class="week-nav">
        <button class="btn btn-icon" id="wk-prev" aria-label="上一周">${icon('chevL')}</button>
        <button class="btn btn-icon" id="wk-next" aria-label="下一周">${icon('chevR')}</button>
      </div>
    </header>

    <div class="quick-actions">
      <button class="btn btn-primary" id="btn-import">${icon('import')} 导入课表</button>
      <button class="btn btn-ghost" id="btn-add">${icon('plus')} 添加课程</button>
    </div>

    ${!entries.length ? `<div class="card hint-card">还没有课程。拍一张课表照片导入，或点「添加课程」手动录入。</div>` : ''}

    <div class="sched-wrap">
      <div class="sched-grid">${head}${rows}</div>
    </div>
    <p class="hint">提示：格子中 ↑ 表示连堂课的后续节次。</p>
  `;

  root.querySelector('#wk-prev').addEventListener('click', () => { viewWeekOffset--; refreshApp(); });
  root.querySelector('#wk-next').addEventListener('click', () => { viewWeekOffset++; refreshApp(); });
  root.querySelector('#btn-import').addEventListener('click', openImportSheet);
  root.querySelector('#btn-add').addEventListener('click', () => openEntryForm(null, {}));

  root.querySelectorAll('.sg-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const day = +cell.dataset.day;
      const period = +cell.dataset.period;
      // 连堂续节与首节都定位到该课程
      const e = grid.get(`${day}-${period}`);
      if (e) openEntryForm(e, {});
      else openEntryForm(null, { day, periods: [period] });
    });
  });
}

/* ---------- 新建 / 编辑课程 ---------- */

export function openEntryForm(entry, preset = {}) {
  const s = loadSettings();
  const periods = s.periods;
  const day = entry ? entry.day : (preset.day || 1);
  const ps = entry ? [...entry.periods].sort((a, b) => a - b) : (preset.periods || [1]);
  const p1 = ps[0];
  const p2 = ps[ps.length - 1];
  const weeks = entry?.weeks || { start: 1, end: s.totalWeeks, parity: 'all' };

  const dayOpts = DAY_NAMES.slice(1).map((n, i) =>
    `<option value="${i + 1}" ${i + 1 === day ? 'selected' : ''}>${n}</option>`).join('');
  // 节次选项：设置中的节次 + entry 里超出范围的节次（导入的课可能超过默认 11 节）
  const pOpts = sel => {
    const ids = periods.map(p => p.id);
    if (sel && !ids.includes(sel)) ids.push(sel);
    ids.sort((a, b) => a - b);
    return ids.map(id => {
      const p = periods.find(x => x.id === id);
      return `<option value="${id}" ${id === sel ? 'selected' : ''}>第${id}节${p ? ' ' + p.start : ''}</option>`;
    }).join('');
  };
  const parityOpts = [['all', '每周'], ['odd', '单周'], ['even', '双周']]
    .map(([v, n]) => `<option value="${v}" ${weeks.parity === v ? 'selected' : ''}>${n}</option>`).join('');

  const div = document.createElement('div');
  div.innerHTML = `
    <form id="entry-form" class="form">
      <div class="form-row">
        <label>星期</label>
        <select name="day">${dayOpts}</select>
      </div>
      <div class="form-row">
        <label>节次</label>
        <div class="inline-selects">
          <select name="p1">${pOpts(p1)}</select>
          <span>至</span>
          <select name="p2">${pOpts(p2)}</select>
        </div>
      </div>
      <div class="form-row">
        <label>课程名称</label>
        <input name="course" required maxlength="30" value="${escapeHtml(entry?.course || '')}" placeholder="如 高等数学(上)">
      </div>
      <div class="form-row">
        <label>教室</label>
        <input name="room" maxlength="20" value="${escapeHtml(entry?.room || '')}" placeholder="如 教三-301">
      </div>
      <div class="form-row">
        <label>教师</label>
        <input name="teacher" maxlength="20" value="${escapeHtml(entry?.teacher || '')}" placeholder="选填">
      </div>
      <div class="form-row">
        <label>上课周次</label>
        <div class="inline-selects">
          <input name="wstart" type="number" min="1" max="30" value="${weeks.start === 99 ? 1 : weeks.start}">
          <span>至</span>
          <input name="wend" type="number" min="1" max="30" value="${weeks.end === 99 ? s.totalWeeks : weeks.end}">
          <select name="parity">${parityOpts}</select>
        </div>
      </div>
      <div class="btn-row">
        ${entry ? `<button type="button" class="btn btn-danger" id="ef-delete">${icon('trash')} 删除</button>` : ''}
        <button type="submit" class="btn btn-primary">${icon('check')} 保存</button>
      </div>
    </form>`;

  const sheet = openSheet({ title: entry ? '编辑课程' : '添加课程', content: div });
  const form = div.querySelector('#entry-form');

  if (entry) {
    div.querySelector('#ef-delete').addEventListener('click', async () => {
      if (await confirmDialog(`删除「${entry.course}」这节课？`, { danger: true, okText: '删除' })) {
        await deleteEntry(entry.id);
        sheet.close();
        showToast('已删除');
        refreshApp();
      }
    });
  }

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = new FormData(form);
    const a = +fd.get('p1'), b = +fd.get('p2');
    const periodsArr = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) periodsArr.push(i);
    await saveEntry({
      id: entry?.id,
      day: +fd.get('day'),
      periods: periodsArr,
      course: String(fd.get('course')).trim(),
      room: String(fd.get('room')).trim(),
      teacher: String(fd.get('teacher')).trim(),
      weeks: {
        start: +fd.get('wstart') || 1,
        end: +fd.get('wend') || s.totalWeeks,
        parity: fd.get('parity'),
      },
    });
    sheet.close();
    showToast('已保存');
    refreshApp();
  });
}

/* ---------- 导入课表 ---------- */

export function openImportSheet() {
  const aiOn = visionReady(loadSettings());
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="import-options">
      <button class="import-btn" id="imp-photo">${icon('camera')}<span>拍照识别</span></button>
      <button class="import-btn" id="imp-album">${icon('image')}<span>相册识别</span></button>
      <button class="import-btn" id="imp-text">${icon('note')}<span>粘贴文本</span></button>
    </div>
    <div class="ocr-status" id="ocr-status" hidden></div>
    <input type="file" id="file-photo" accept="image/*" capture="environment" hidden>
    <input type="file" id="file-album" accept="image/*" hidden>
    <p class="hint">建议使用清晰的整页课表截图。${aiOn ? '已启用大模型识别，准确率更高。' : '在「设置 → AI 增强」中配置大模型 API 后，照片识别会更准确。'}</p>`;

  const sheet = openSheet({ title: '导入课表', content: div });
  const status = div.querySelector('#ocr-status');
  const filePhoto = div.querySelector('#file-photo');
  const fileAlbum = div.querySelector('#file-album');

  const showStatus = (msg) => {
    status.hidden = false;
    status.textContent = msg;
  };

  div.querySelector('#imp-photo').addEventListener('click', () => filePhoto.click());
  div.querySelector('#imp-album').addEventListener('click', () => fileAlbum.click());
  div.querySelector('#imp-text').addEventListener('click', openTextImport);

  const handleFile = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const entries = await recognizeScheduleFile(file, showStatus);
      sheet.close();
      if (entries.length) openPreviewSheet(entries);
      else showToast('没有识别出课程，试试更清晰的照片或粘贴文本导入');
    } catch (err) {
      showStatus('');
      status.hidden = true;
      showToast(err.message || '识别失败', 'error');
    }
  };
  filePhoto.addEventListener('change', handleFile);
  fileAlbum.addEventListener('change', handleFile);
}

async function recognizeScheduleFile(file, showStatus) {
  const s = loadSettings();
  showStatus('正在处理图片…');
  const canvas = await preprocessImage(file);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

  if (visionReady(s)) {
    showStatus('大模型识别中，请稍候…');
    return normalizeEntries(await aiRecognizeSchedule(s, dataUrl));
  }
  showStatus('正在加载本地识别引擎（首次约需 10-20 秒）…');
  const { lines, symbols } = await ocrCanvas(canvas, p => showStatus(`本地识别中 ${p}%…`));
  showStatus('正在解析表格…');
  const result = parseOcrGrid(symbols, lines);
  return normalizeEntries(result.entries);
}

/* ---------- 粘贴文本导入 ---------- */

function openTextImport() {
  const div = document.createElement('div');
  div.innerHTML = `
    <p class="hint">每行一条，格式示例：</p>
    <pre class="example">周一 1-2节 高等数学(上) 教三-301 1-16周
周三 3-4节 大学英语 逸夫楼303 单周
周五 6-7节 大学物理实验 实验楼201 双周</pre>
    <textarea id="paste-area" rows="8" placeholder="把课表文字粘贴到这里…"></textarea>
    <div class="btn-row">
      <button class="btn btn-primary" id="paste-parse">${icon('check')} 解析</button>
    </div>`;

  const sheet = openSheet({ title: '粘贴文本导入', content: div });
  div.querySelector('#paste-parse').addEventListener('click', () => {
    const text = div.querySelector('#paste-area').value;
    const entries = normalizeEntries(parseScheduleText(text));
    if (!entries.length) {
      showToast('没有解析出课程，请检查格式（每行需包含"周X"和节次）', 'error');
      return;
    }
    sheet.close();
    openPreviewSheet(entries);
  });
}

/* ---------- 导入确认（可编辑） ---------- */

function periodsInputValue(ps) {
  const a = Math.min(...ps), b = Math.max(...ps);
  return a === b ? String(a) : `${a}-${b}`;
}

function weeksInputValue(w) {
  if (!w) return '';
  if (w.parity === 'odd') return '单周';
  if (w.parity === 'even') return '双周';
  return `${w.start}-${w.end}`;
}

export function openPreviewSheet(rawEntries) {
  const entries = rawEntries.map(e => ({ ...e }));
  const div = document.createElement('div');
  const dayOpts = sel => DAY_NAMES.slice(1).map((n, i) =>
    `<option value="${i + 1}" ${i + 1 === sel ? 'selected' : ''}>${n}</option>`).join('');

  const rowHtml = e => `
    <div class="pv-row" data-id="${e._rid || (e._rid = Math.random().toString(36).slice(2))}">
      <select class="pv-day">${dayOpts(e.day)}</select>
      <input class="pv-periods" value="${escapeHtml(periodsInputValue(e.periods))}" placeholder="节次" inputmode="numeric">
      <input class="pv-course" value="${escapeHtml(e.course)}" placeholder="课程名">
      <input class="pv-room" value="${escapeHtml(e.room || '')}" placeholder="教室">
      <input class="pv-weeks" value="${escapeHtml(weeksInputValue(e.weeks))}" placeholder="周次">
      <button class="pv-del" aria-label="删除">${icon('close')}</button>
    </div>`;

  div.innerHTML = `
    <p class="hint">识别到 <b>${entries.length}</b> 条课程。自动识别可能有误，请逐条核对后再保存。</p>
    <div class="pv-head">
      <span>星期</span><span>节次</span><span>课程</span><span>教室</span><span>周次</span><span></span>
    </div>
    <div id="pv-list">${entries.map(rowHtml).join('')}</div>
    <div class="btn-row">
      <button class="btn btn-ghost" id="pv-add">${icon('plus')} 手动加一条</button>
      <button class="btn btn-primary" id="pv-save">${icon('check')} 保存全部</button>
    </div>`;

  const sheet = openSheet({ title: '核对并保存课表', content: div, full: true });
  const list = div.querySelector('#pv-list');

  div.querySelector('#pv-add').addEventListener('click', () => {
    list.insertAdjacentHTML('beforeend', rowHtml({ day: 1, periods: [1], course: '', room: '', weeks: null }));
  });

  list.addEventListener('click', ev => {
    const del = ev.target.closest('.pv-del');
    if (del) del.closest('.pv-row').remove();
  });

  div.querySelector('#pv-save').addEventListener('click', async () => {
    const out = [];
    for (const row of list.querySelectorAll('.pv-row')) {
      const day = +row.querySelector('.pv-day').value;
      const periodsRaw = row.querySelector('.pv-periods').value.trim();
      const m = periodsRaw.match(/^(\d{1,2})(?:\s*[-–—~至]\s*(\d{1,2}))?$/);
      if (!m) { showToast(`节次格式不对：「${periodsRaw}」（应如 1-2 或 3）`, 'error'); return; }
      const a = +m[1], b = m[2] ? +m[2] : a;
      const periods = [];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) periods.push(i);
      const course = row.querySelector('.pv-course').value.trim();
      if (!course) { showToast('有课程名为空的行，请填写或删除', 'error'); return; }
      const weeksRaw = row.querySelector('.pv-weeks').value.trim();
      const { spec } = extractWeeks(weeksRaw || '1-99周');
      out.push({
        day, periods, course,
        room: row.querySelector('.pv-room').value.trim(),
        teacher: '',
        weeks: spec || { start: 1, end: 99, parity: 'all' },
      });
    }
    if (!out.length) { showToast('没有可保存的课程', 'error'); return; }
    for (const e of out) await saveEntry(e);
    sheet.close();
    showToast(`已导入 ${out.length} 条课程 🎉`);
    refreshApp();
  });
}
