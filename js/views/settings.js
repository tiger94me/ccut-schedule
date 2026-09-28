// 设置页：学期、节次时间、提醒、通知权限、AI 增强、数据备份与恢复

import { loadSettings, saveSettings, DEFAULT_PERIODS } from '../settings.js';
import { exportAll, importAll, clearAllData } from '../data.js';
import { escapeHtml, refreshApp } from '../util.js';
import { aiTestConnection } from '../ai.js';
import { showToast, confirmDialog, sendNotification, requestNotifyPermission, icon } from '../ui.js';

const SESSIONS = [['morning', '上午'], ['afternoon', '下午'], ['evening', '晚上']];

export async function render(root) {
  const s = loadSettings();
  const notifState = ('Notification' in window) ? Notification.permission : 'unsupported';

  const periodRows = s.periods.map((p, i) => `
    <div class="period-row" data-i="${i}">
      <input class="pr-label" value="${escapeHtml(p.label)}" maxlength="8" aria-label="节次名">
      <input class="pr-start" type="time" value="${p.start}" aria-label="开始">
      <span>–</span>
      <input class="pr-end" type="time" value="${p.end}" aria-label="结束">
      <select class="pr-session">${SESSIONS.map(([v, n]) =>
        `<option value="${v}" ${p.session === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="pr-del btn btn-icon" aria-label="删除节次">${icon('close')}</button>
    </div>`).join('');

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>设置</h1>
        <div class="sub">课表作息、提醒、AI 与数据</div>
      </div>
    </header>

    <section class="card">
      <h2>学期</h2>
      <div class="form-row">
        <label>第一周周一</label>
        <input type="date" id="st-start" value="${escapeHtml(s.semesterStart)}">
      </div>
      <div class="form-row">
        <label>总周数</label>
        <input type="number" id="st-weeks" min="1" max="30" value="${s.totalWeeks}">
      </div>
      <p class="hint">用于计算"第几周"，并按周次/单双周过滤课表。</p>
    </section>

    <section class="card">
      <h2>节次时间</h2>
      <div class="period-head"><span>名称</span><span>开始</span><span></span><span>结束</span><span>时段</span><span></span></div>
      ${periodRows}
      <div class="btn-row">
        <button class="btn btn-ghost" id="pr-add">${icon('plus')} 添加节次</button>
        <button class="btn btn-ghost" id="pr-reset">恢复默认</button>
      </div>
    </section>

    <section class="card">
      <h2>提醒</h2>
      <div class="form-row switch-row">
        <label>启用提醒</label>
        <input type="checkbox" id="rm-enabled" ${s.reminder.enabled ? 'checked' : ''}>
      </div>
      <div class="form-row">
        <label>课前提前提醒</label>
        <div class="inline-selects">
          <input type="number" id="rm-lead" min="5" max="120" step="5" value="${s.reminder.lead}" style="width:80px">
          <span>分钟</span>
        </div>
      </div>
      <div class="form-row">
        <label>提醒方式</label>
        <select id="rm-mode">
          <option value="session" ${s.reminder.mode === 'session' ? 'selected' : ''}>按上午/下午/晚上时段（每时段首节课提醒）</option>
          <option value="perClass" ${s.reminder.mode === 'perClass' ? 'selected' : ''}>每节课都提醒</option>
        </select>
      </div>
      <div class="form-row">
        <label>晨间简报时间</label>
        <input type="time" id="rm-morning" value="${s.reminder.morningTime}">
      </div>
      <div class="form-row">
        <label>晚间总结提醒</label>
        <input type="time" id="rm-evening" value="${s.reminder.eveningTime}">
      </div>
      <div class="form-row switch-row">
        <label>下课后提醒记笔记</label>
        <input type="checkbox" id="rm-after" ${s.reminder.afterClass ? 'checked' : ''}>
      </div>
      <div class="form-row column">
        <label>系统通知</label>
        <div class="btn-row">
          ${notifState === 'granted'
            ? `<button class="btn btn-ghost" id="nt-test">${icon('bell')} 发送测试通知</button>`
            : notifState === 'denied'
              ? '<span class="hint">通知权限已被拒绝，请在浏览器/系统设置中手动开启。</span>'
              : notifState === 'unsupported'
                ? '<span class="hint">当前浏览器不支持系统通知。</span>'
                : `<button class="btn btn-primary" id="nt-ask">${icon('bell')} 开启系统通知</button>`}
        </div>
        <p class="hint">⚠️ 网页应用只有在打开（或后台驻留）时才能弹出提醒。把本应用「添加到主屏幕」并保持后台，提醒更及时；每天第一次打开也能看到当日课程简报。</p>
      </div>
    </section>

    <section class="card">
      <h2>AI 增强（可选）</h2>
      <div class="form-row switch-row">
        <label>启用大模型</label>
        <input type="checkbox" id="ai-enabled" ${s.ai.enabled ? 'checked' : ''}>
      </div>
      <div class="form-row">
        <label>接口地址</label>
        <input id="ai-base" value="${escapeHtml(s.ai.baseURL)}" placeholder="https://api.deepseek.com/v1">
      </div>
      <div class="form-row">
        <label>API Key</label>
        <input id="ai-key" type="password" value="${escapeHtml(s.ai.apiKey)}" placeholder="sk-…（仅保存在本机）">
      </div>
      <div class="form-row">
        <label>视觉模型</label>
        <input id="ai-vision" value="${escapeHtml(s.ai.visionModel)}" placeholder="如 glm-4v-flash / gpt-4o-mini">
      </div>
      <div class="form-row">
        <label>文本模型</label>
        <input id="ai-text" value="${escapeHtml(s.ai.textModel)}" placeholder="如 deepseek-chat">
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" id="ai-test">测试连接</button>
      </div>
      <p class="hint">配置后：课表照片识别、笔记照片转文字、总结与复习计划都由大模型完成，质量更高。任何 OpenAI 兼容接口均可（DeepSeek、智谱、通义等）。Key 只保存在你的手机本地。</p>
    </section>

    <section class="card">
      <h2>数据</h2>
      <div class="btn-row">
        <button class="btn btn-ghost" id="dt-export">${icon('export')} 导出备份</button>
        <button class="btn btn-ghost" id="dt-import">${icon('import')} 导入备份</button>
        <button class="btn btn-danger" id="dt-clear">${icon('trash')} 清空数据</button>
      </div>
      <input type="file" id="dt-file" accept="application/json" hidden>
      <p class="hint">数据（课表、笔记、照片、总结）全部保存在本机浏览器中，换手机或清浏览器数据前请先导出备份。</p>
    </section>

    <section class="card">
      <h2>关于</h2>
      <p class="hint">动态课程表 · 纯前端应用，无需服务器，可离线使用。<br>
      照片识别默认使用本地 OCR（Tesseract，免费离线）；语音听写使用浏览器自带能力（Android Chrome / 部分iOS Safari 支持）。</p>
    </section>
  `;

  const persist = (mutate, silent = false) => {
    const cur = loadSettings();
    mutate(cur);
    saveSettings(cur);
    if (!silent) refreshApp();
  };

  /* 学期 */
  root.querySelector('#st-start').addEventListener('change', ev => {
    if (!ev.target.value) return;
    persist(s2 => { s2.semesterStart = ev.target.value; });
    showToast('学期已保存');
  });
  root.querySelector('#st-weeks').addEventListener('change', ev => {
    persist(s2 => { s2.totalWeeks = Math.max(1, +ev.target.value || 20); });
  });

  /* 节次时间 */
  root.querySelectorAll('.period-row').forEach(row => {
    const i = +row.dataset.i;
    const upd = () => persist(s2 => {
      const p = s2.periods[i];
      p.label = row.querySelector('.pr-label').value.trim() || p.label;
      p.start = row.querySelector('.pr-start').value || p.start;
      p.end = row.querySelector('.pr-end').value || p.end;
      p.session = row.querySelector('.pr-session').value;
    });
    row.querySelectorAll('input, select').forEach(inp => inp.addEventListener('change', upd));
    row.querySelector('.pr-del').addEventListener('click', () => {
      persist(s2 => { s2.periods.splice(i, 1); });
      showToast('节次已删除');
    });
  });
  root.querySelector('#pr-add').addEventListener('click', () => {
    persist(s2 => {
      const maxId = Math.max(0, ...s2.periods.map(p => p.id));
      const last = s2.periods[s2.periods.length - 1];
      const [h, m] = (last?.end || '21:00').split(':').map(Number);
      const startMin = h * 60 + m + 10;
      const start = `${String(Math.floor(startMin / 60) % 24).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;
      const endMin = startMin + 45;
      const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      s2.periods.push({ id: maxId + 1, label: `第${maxId + 1}节`, start, end, session: last?.session || 'evening' });
    });
  });
  root.querySelector('#pr-reset').addEventListener('click', async () => {
    if (await confirmDialog('恢复默认的 11 节作息时间？', { okText: '恢复' })) {
      persist(s2 => { s2.periods = structuredClone(DEFAULT_PERIODS); });
      showToast('已恢复默认作息');
    }
  });

  /* 提醒 */
  root.querySelector('#rm-enabled').addEventListener('change', ev => {
    persist(s2 => { s2.reminder.enabled = ev.target.checked; });
    showToast(ev.target.checked ? '提醒已开启' : '提醒已关闭');
  });
  root.querySelector('#rm-lead').addEventListener('change', ev => {
    persist(s2 => { s2.reminder.lead = Math.min(120, Math.max(5, +ev.target.value || 40)); });
  });
  root.querySelector('#rm-mode').addEventListener('change', ev => {
    persist(s2 => { s2.reminder.mode = ev.target.value; });
  });
  root.querySelector('#rm-morning').addEventListener('change', ev => {
    persist(s2 => { s2.reminder.morningTime = ev.target.value || '07:00'; });
  });
  root.querySelector('#rm-evening').addEventListener('change', ev => {
    persist(s2 => { s2.reminder.eveningTime = ev.target.value || '21:30'; });
  });
  root.querySelector('#rm-after').addEventListener('change', ev => {
    persist(s2 => { s2.reminder.afterClass = ev.target.checked; });
  });

  /* 通知权限 */
  root.querySelector('#nt-ask')?.addEventListener('click', async () => {
    const r = await requestNotifyPermission();
    showToast(r === 'granted' ? '通知已开启 ✅' : r === 'denied' ? '权限被拒绝' : '未开启');
    refreshApp();
  });
  root.querySelector('#nt-test')?.addEventListener('click', () => {
    sendNotification('🔔 测试通知', '提醒已正常工作！课前会提前通知你教室和时间。');
  });

  /* AI */
  const aiUpd = () => persist(s2 => {
    s2.ai.enabled = root.querySelector('#ai-enabled').checked;
    s2.ai.baseURL = root.querySelector('#ai-base').value.trim();
    s2.ai.apiKey = root.querySelector('#ai-key').value.trim();
    s2.ai.visionModel = root.querySelector('#ai-vision').value.trim();
    s2.ai.textModel = root.querySelector('#ai-text').value.trim();
  }, true);
  root.querySelectorAll('#ai-enabled, #ai-base, #ai-key, #ai-vision, #ai-text')
    .forEach(inp => inp.addEventListener('change', () => { aiUpd(); showToast('已保存'); }));
  root.querySelector('#ai-test').addEventListener('click', async ev => {
    aiUpd();
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = '测试中…';
    try {
      const s2 = loadSettings();
      if (!s2.ai.apiKey || !s2.ai.textModel) throw new Error('请先填写 API Key 和文本模型');
      const reply = await aiTestConnection(s2);
      showToast(`连接成功：${reply}`);
    } catch (err) {
      showToast(`连接失败：${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '测试连接';
    }
  });

  /* 数据 */
  root.querySelector('#dt-export').addEventListener('click', async () => {
    try {
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `课程表备份-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      showToast('备份已导出');
    } catch (err) {
      showToast(`导出失败：${err.message}`, 'error');
    }
  });
  root.querySelector('#dt-import').addEventListener('click', () => root.querySelector('#dt-file').click());
  root.querySelector('#dt-file').addEventListener('change', async ev => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (await confirmDialog('导入会覆盖当前全部数据（课表/笔记/总结），确定继续？', { danger: true, okText: '覆盖导入' })) {
        await importAll(json);
        showToast('导入完成 ✅');
        refreshApp();
      }
    } catch (err) {
      showToast(`导入失败：${err.message}`, 'error');
    }
  });
  root.querySelector('#dt-clear').addEventListener('click', async () => {
    if (await confirmDialog('清空全部数据？此操作不可恢复，建议先导出备份。', { danger: true, okText: '全部清空' })) {
      await clearAllData();
      showToast('数据已清空');
      refreshApp();
    }
  });
}
