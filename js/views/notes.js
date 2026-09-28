// 记录页：课后笔记列表 + 新建/编辑（拍照、语音听写、文字）+ 详情查看 + 后台照片 OCR

import { loadSettings } from '../settings.js';
import {
  getNotes, saveNote, deleteNote, getAllCourses, getDayTimeline, blobToDataURL,
} from '../data.js';
import { fmtDate, dayOfWeek, nowMinutes, escapeHtml, refreshApp, courseColorIndex } from '../util.js';
import { suggestCourse } from '../model.js';
import { compressForStorage, ocrFile } from '../ocr.js';
import { aiOcrText, visionReady } from '../ai.js';
import { speechSupported, createDictation } from '../speech.js';
import { openSheet, showToast, confirmDialog, icon } from '../ui.js';

let dictation = null; // 听写会话（跨 sheet 复用）

export async function render(root) {
  const all = (await getNotes())
    .sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')));
  const courses = await getAllCourses();

  // 按日期分组
  const todayStr = fmtDate(new Date());
  const yesterdayStr = fmtDate(new Date(Date.now() - 86400000));
  const groups = [];
  for (const n of all) {
    const label = n.date === todayStr ? '今天' : n.date === yesterdayStr ? '昨天' : n.date.slice(5).replace('-', '月') + '日';
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) { g = { label, items: [] }; groups.push(g); }
    g.items.push(n);
  }

  const listHtml = groups.length ? groups.map(g => `
    <section class="card">
      <h2>${g.label}</h2>
      <ul class="note-list">
        ${g.items.map(n => noteCardHtml(n)).join('')}
      </ul>
    </section>`).join('')
    : `<div class="card hint-card">还没有笔记。上完课点右下角 ✏️，拍课本、说两句都行。</div>`;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>学习记录</h1>
        <div class="sub">共 ${all.length} 条笔记 · 点击查看详情</div>
      </div>
    </header>
    ${listHtml}
    <button class="fab" id="fab-new" aria-label="新建笔记">${icon('plus')}</button>
    <datalist id="course-list">${courses.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
  `;

  root.querySelector('#fab-new').addEventListener('click', () => openNoteEditor(null));

  root.querySelectorAll('.note-item').forEach(item => {
    item.addEventListener('click', () => {
      const note = all.find(n => n.id === item.dataset.id);
      if (note) openNoteSheet(note);
    });
  });

  // 从「今日」页跳转过来时自动打开新建
  if (sessionStorage.getItem('ds-auto-new-note')) {
    sessionStorage.removeItem('ds-auto-new-note');
    openNoteEditor(null);
  }
}

function noteCardHtml(n) {
  const imgs = n.images || [];
  const firstImg = imgs.find(im => im.blob);
  const ocrLen = imgs.reduce((s, im) => s + (im.ocrText || '').length, 0);
  const preview = (n.text || '').slice(0, 60) || (ocrLen ? `📷 照片文字 ${ocrLen} 字` : '📷 照片笔记');
  return `
    <li class="note-item" data-id="${n.id}">
      <div class="note-main">
        <div class="note-top">
          <span class="chip c${courseColorIndex(n.course)}">${escapeHtml(n.course || '未分类')}</span>
          ${n.period ? `<span class="note-period">第${n.period}节</span>` : ''}
          <span class="note-time">${(n.createdAt || '').slice(11, 16)}</span>
        </div>
        <p class="note-text">${escapeHtml(preview)}</p>
      </div>
      ${firstImg ? `<img class="note-thumb" src="${URL.createObjectURL(firstImg.blob)}" alt="">` : ''}
    </li>`;
}

/* ---------- 笔记详情 ---------- */

function openNoteSheet(note) {
  const div = document.createElement('div');
  const imgs = note.images || [];
  div.innerHTML = `
    <div class="note-detail">
      <div class="note-top">
        <span class="chip c${courseColorIndex(note.course)}">${escapeHtml(note.course || '未分类')}</span>
        <span class="note-period">${note.date}${note.period ? ' · 第' + note.period + '节' : ''}</span>
      </div>
      ${note.text ? `<p class="detail-text">${escapeHtml(note.text)}</p>` : ''}
      ${imgs.length ? `<div class="detail-imgs">${imgs.filter(i => i.blob).map(im =>
        `<img src="${URL.createObjectURL(im.blob)}" alt="笔记照片">`).join('')}</div>` : ''}
      ${imgs.some(i => i.ocrText) ? `
        <details class="ocr-details">
          <summary>照片识别文字（${imgs.reduce((s, i) => s + (i.ocrText || '').length, 0)} 字）</summary>
          <pre>${escapeHtml(imgs.map(i => i.ocrText || '').filter(Boolean).join('\n\n'))}</pre>
        </details>` : ''}
      <div class="btn-row">
        <button class="btn btn-danger" id="nd-delete">${icon('trash')} 删除</button>
        <button class="btn btn-primary" id="nd-edit">${icon('edit')} 编辑</button>
      </div>
    </div>`;
  const sheet = openSheet({ title: '笔记详情', content: div, full: true });

  div.querySelector('#nd-edit').addEventListener('click', () => {
    sheet.close();
    openNoteEditor(note);
  });
  div.querySelector('#nd-delete').addEventListener('click', async () => {
    if (await confirmDialog('删除这条笔记？照片也会一起删除。', { danger: true, okText: '删除' })) {
      await deleteNote(note.id);
      sheet.close();
      showToast('已删除');
      refreshApp();
    }
  });
}

/* ---------- 新建 / 编辑笔记 ---------- */

export async function openNoteEditor(note) {
  const now = new Date();
  const s = loadSettings();
  const editing = !!note;

  // 推荐课程：正在上的课 / 最近刚下课的课
  let suggest = null;
  try {
    const tl = await getDayTimeline(now);
    const item = suggestCourse(tl, nowMinutes(now));
    if (item) suggest = item;
  } catch { /* ignore */ }

  const courses = await getAllCourses();
  const curCourse = note?.course || suggest?.entry?.course || '';
  const curPeriod = note?.period || suggest?.period || '';

  const div = document.createElement('div');
  div.innerHTML = `
    <div class="form">
      <div class="form-row">
        <label>课程</label>
        <input id="ne-course" list="course-list" value="${escapeHtml(curCourse)}" placeholder="课程名（输入可选择已有课程）">
      </div>
      <div class="form-row">
        <label>节次</label>
        <select id="ne-period">
          <option value="">不关联节次</option>
          ${s.periods.map(p => `<option value="${p.id}" ${+curPeriod === p.id ? 'selected' : ''}>第${p.id}节 ${p.start}</option>`).join('')}
        </select>
      </div>
      ${suggest && !editing ? `<p class="hint">💡 已自动填入「${escapeHtml(suggest.entry.course)}」（按当前时间推断，可修改）</p>` : ''}
      <div class="form-row column">
        <label>笔记内容</label>
        <div class="textarea-wrap">
          <textarea id="ne-text" rows="6" placeholder="记下课堂要点、作业、疑问…（也可以用下面的语音按钮说）">${escapeHtml(note?.text || '')}</textarea>
          ${speechSupported ? `<button type="button" class="btn btn-ghost mic-btn" id="ne-mic" aria-label="语音输入">${icon('mic')} <span>语音</span></button>` : ''}
        </div>
      </div>
      <div class="form-row column">
        <label>照片（课本 / 板书 / 笔记）</label>
        <div class="photo-grid" id="ne-photos"></div>
        <div class="photo-actions">
          <button type="button" class="btn btn-ghost" id="ne-camera">${icon('camera')} 拍照</button>
          <button type="button" class="btn btn-ghost" id="ne-album">${icon('image')} 相册</button>
        </div>
        <input type="file" id="ne-file-cam" accept="image/*" capture="environment" hidden multiple>
        <input type="file" id="ne-file-album" accept="image/*" hidden multiple>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" id="ne-save" style="width:100%">${icon('check')} 保存笔记</button>
      </div>
    </div>`;

  const sheet = openSheet({
    title: editing ? '编辑笔记' : '记笔记',
    content: div,
    full: true,
    onClose: () => { if (dictation?.listening) dictation.stop(); }, // 关闭弹层时停止听写
  });

  /* 照片管理：已有 + 新增 */
  const kept = editing ? (note.images || []).map(im => ({ blob: im.blob, ocrText: im.ocrText || '' })) : [];
  const added = []; // { blob, ocrText }
  const photoGrid = div.querySelector('#ne-photos');

  function renderPhotos() {
    photoGrid.innerHTML = '';
    const renderOne = (im, arr) => {
      const cell = document.createElement('div');
      cell.className = 'photo-cell';
      cell.innerHTML = `<img src="${URL.createObjectURL(im.blob)}" alt=""><button class="photo-del" aria-label="删除照片">${icon('close')}</button>`;
      cell.querySelector('.photo-del').addEventListener('click', () => {
        const i = arr.indexOf(im);
        if (i >= 0) arr.splice(i, 1);
        renderPhotos();
      });
      photoGrid.appendChild(cell);
    };
    kept.forEach(im => renderOne(im, kept));
    added.forEach(im => renderOne(im, added));
  }
  renderPhotos();

  const addFiles = async (fileList) => {
    for (const file of fileList) {
      try {
        const blob = await compressForStorage(file);
        added.push({ blob, ocrText: '' });
      } catch {
        showToast('有图片读取失败', 'error');
      }
    }
    renderPhotos();
  };
  div.querySelector('#ne-camera').addEventListener('click', () => div.querySelector('#ne-file-cam').click());
  div.querySelector('#ne-album').addEventListener('click', () => div.querySelector('#ne-file-album').click());
  div.querySelector('#ne-file-cam').addEventListener('change', ev => { addFiles([...ev.target.files]); ev.target.value = ''; });
  div.querySelector('#ne-file-album').addEventListener('change', ev => { addFiles([...ev.target.files]); ev.target.value = ''; });

  /* 语音听写 */
  const micBtn = div.querySelector('#ne-mic');
  if (micBtn) {
    micBtn.addEventListener('click', () => {
      const textarea = div.querySelector('#ne-text');
      if (!dictation) {
        try {
          dictation = createDictation({
            onText: (finalText, interim) => { textarea.value = finalText + interim; },
            onError: msg => { showToast(msg, 'error'); micBtn.classList.remove('rec'); },
            onStateChange: listening => micBtn.classList.toggle('rec', listening),
          });
        } catch (err) {
          showToast(err.message, 'error');
          return;
        }
      }
      if (dictation.listening) {
        textarea.value = dictation.stop();
        showToast('语音已停止，可继续编辑');
      } else {
        dictation.start(textarea.value);
        showToast('开始听写，再点一次结束');
      }
    });
  }

  /* 保存 */
  div.querySelector('#ne-save').addEventListener('click', async () => {
    const course = div.querySelector('#ne-course').value.trim();
    if (!course && !kept.length && !added.length && !div.querySelector('#ne-text').value.trim()) {
      showToast('写点内容或加张照片再保存吧', 'error');
      return;
    }
    const periodVal = div.querySelector('#ne-period').value;
    const n = note || {
      id: null,
      date: fmtDate(now),
      day: dayOfWeek(now),
      createdAt: new Date().toISOString(),
    };
    n.course = course || '未分类';
    n.period = periodVal ? +periodVal : null;
    n.text = div.querySelector('#ne-text').value.trim();
    n.images = [...kept, ...added].map(im => ({ blob: im.blob, ocrText: im.ocrText }));
    await saveNote(n);
    if (dictation?.listening) dictation.stop();
    sheet.close();
    showToast('笔记已保存');
    refreshApp();
    if (n.images.some(im => !im.ocrText && im.blob)) {
      runOcrInBackground({ ...n, images: n.images.map(im => ({ ...im })) });
    }
  });
}

/* 后台 OCR：照片 -> 文字，完成后写回笔记 */
async function runOcrInBackground(note) {
  const s = loadSettings();
  let extracted = 0;
  for (const im of note.images || []) {
    if (im.ocrText || !im.blob) continue;
    try {
      let text = '';
      if (visionReady(s)) {
        const dataUrl = await blobToDataURL(im.blob);
        text = await aiOcrText(s, dataUrl);
      } else {
        const r = await ocrFile(im.blob);
        text = r.text;
      }
      im.ocrText = String(text || '').trim();
      extracted++;
    } catch {
      im.ocrText = '';
    }
  }
  if (extracted) {
    await saveNote(note);
    showToast(`已从 ${extracted} 张照片提取文字 📄`);
    refreshApp();
  }
}
