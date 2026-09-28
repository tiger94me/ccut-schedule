// 可选的大模型增强（OpenAI 兼容接口，如 DeepSeek / 智谱 / 通义等）：
// - 视觉模型识别课表照片 -> 结构化课表 JSON
// - 笔记照片 -> 文字
// - 当日总结 / 周末复习计划
// 未配置或调用失败时，调用方回退到本地方案。

import { normalizeEntries } from './parser.js';

export function aiAvailable(settings) {
  const ai = settings?.ai;
  return !!(ai && ai.enabled && ai.apiKey && ai.baseURL);
}

function visionReady(settings) {
  return aiAvailable(settings) && !!settings.ai.visionModel;
}

// 从模型回复中提取 JSON（剥掉 ```json 围栏 / 截取首尾大括号）
function extractJSON(text) {
  const s = String(text || '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{');
  const arrStart = body.indexOf('[');
  const from = (start === -1) ? arrStart : (arrStart === -1 ? start : Math.min(start, arrStart));
  if (from === -1) throw new Error('模型未返回 JSON');
  const endCurly = body.lastIndexOf('}');
  const endSquare = body.lastIndexOf(']');
  const to = Math.max(endCurly, endSquare);
  return JSON.parse(body.slice(from, to + 1));
}

async function chat(settings, messages, { model, temperature = 0.3, timeoutMs = 60000 }) {
  const base = String(settings.ai.baseURL).replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.ai.apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`接口返回 ${res.status}：${err.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('接口返回内容为空');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function imageMessage(prompt, dataUrl) {
  return {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  };
}

/**
 * 视觉模型识别课表照片 -> 条目数组（已 normalizeEntries 清洗）
 * dataUrl 为 JPEG base64
 */
export async function aiRecognizeSchedule(settings, dataUrl) {
  const prompt = `你是课表解析助手。请仔细识别这张大学课表照片，输出严格的 JSON（不要输出任何其他文字）：
{"entries": [{"day": 1, "periods": [1, 2], "course": "课程名", "room": "教室", "teacher": "教师（没有则空字符串）", "weeks": {"start": 1, "end": 16, "parity": "all"}}]}
规则：day 用 1-7 表示周一到周日；periods 是连堂的节次数组（如 [1,2]）；周次没有标注时 weeks 用 {"start":1,"end":99,"parity":"all"}；单周 parity 为 "odd"，双周为 "even"；只输出真实存在的课程格，忽略表头、节次时间、午休等噪声。`;
  const content = await chat(settings, [imageMessage(prompt, dataUrl)], {
    model: settings.ai.visionModel,
    temperature: 0.1,
  });
  const parsed = extractJSON(content);
  const list = Array.isArray(parsed) ? parsed : parsed.entries || [];
  return normalizeEntries(list);
}

/**
 * 视觉模型识别笔记照片 -> 文字
 */
export async function aiOcrText(settings, dataUrl) {
  const prompt = '请识别图片中的所有文字（讲义/笔记/课本内容），按原有顺序输出纯文本，保留换行，不要添加解释。';
  const content = await chat(settings, [imageMessage(prompt, dataUrl)], {
    model: settings.ai.visionModel,
    temperature: 0.1,
  });
  return String(content).trim();
}

/**
 * 大模型生成今日总结
 * dayInfo: { dateLabel, weekLabel, notesText, tomorrowText, noNoteCourses }
 */
export async function aiSummarizeDay(settings, dayInfo) {
  const prompt = `你是学习助手。请根据学生今天的课堂笔记，生成今日学习总结与明日准备，用简体中文 Markdown 输出（## 开头标题、### 小节、- 列表、- [ ] 待办），简洁实用，不要编造笔记里没有的内容。

日期：${dayInfo.dateLabel}${dayInfo.weekLabel}

今天的笔记：
${dayInfo.notesText || '（今天没有记录笔记）'}

${dayInfo.noNoteCourses?.length ? `今天上了课但没有笔记的课程：${dayInfo.noNoteCourses.join('、')}\n` : ''}明天课程安排：
${dayInfo.tomorrowText || '（明天没有排课）'}

输出格式：
## 今日总结
（按课程分小节，每门课 2-4 条要点，再列待办/疑问）
### 明日准备
（列出明天每门课的时间和教室，给出具体准备建议）`;
  return chat(settings, [{ role: 'user', content: prompt }], {
    model: settings.ai.textModel,
    temperature: 0.4,
  });
}

/**
 * 大模型生成周末复习计划
 * weekInfo: { weekLabel, weekNotesText, coursesText }
 */
export async function aiReviewPlan(settings, weekInfo) {
  const prompt = `你是学习助手。请根据学生本周各课程的笔记，制定本周末（周六、周日）的复习计划，用简体中文 Markdown 输出。
要求：每天安排 3-5 个复习时间块（每块约 60 分钟，上午/下午/晚上分布），优先复习笔记多、有未解决疑问、以及上过课但没记笔记的课程；每个时间块写明时间段、课程和具体复习内容；周日晚上加一条"预习下周"提醒。不要编造笔记里没有的内容。

${weekInfo.weekLabel} 本周笔记：
${weekInfo.weekNotesText || '（本周没有笔记记录）'}

本周上过的课程：${weekInfo.coursesText || '（无）'}`;
  return chat(settings, [{ role: 'user', content: prompt }], {
    model: settings.ai.textModel,
    temperature: 0.4,
  });
}

/**
 * 测试连接（设置页用）：发一条极短请求验证 baseURL/key/模型
 */
export async function aiTestConnection(settings) {
  const content = await chat(settings, [
    { role: 'user', content: '请只回复两个字：正常' },
  ], { model: settings.ai.textModel, temperature: 0, timeoutMs: 20000 });
  return String(content).trim().slice(0, 20);
}

export { visionReady };
