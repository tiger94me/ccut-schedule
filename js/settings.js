// 应用设置：默认值、读取与保存（localStorage；Node 测试环境下退化为内存存储）

// 默认节次时间（典型大学作息，可在设置页修改）
export const DEFAULT_PERIODS = [
  { id: 1,  label: '第1节',  start: '08:00', end: '08:45', session: 'morning' },
  { id: 2,  label: '第2节',  start: '08:55', end: '09:40', session: 'morning' },
  { id: 3,  label: '第3节',  start: '10:00', end: '10:45', session: 'morning' },
  { id: 4,  label: '第4节',  start: '10:55', end: '11:40', session: 'morning' },
  { id: 5,  label: '第5节',  start: '14:00', end: '14:45', session: 'afternoon' },
  { id: 6,  label: '第6节',  start: '14:55', end: '15:40', session: 'afternoon' },
  { id: 7,  label: '第7节',  start: '16:00', end: '16:45', session: 'afternoon' },
  { id: 8,  label: '第8节',  start: '16:55', end: '17:40', session: 'afternoon' },
  { id: 9,  label: '第9节',  start: '18:30', end: '19:15', session: 'evening' },
  { id: 10, label: '第10节', start: '19:25', end: '20:10', session: 'evening' },
  { id: 11, label: '第11节', start: '20:20', end: '21:05', session: 'evening' },
];

export const DEFAULT_SETTINGS = {
  // 学期第一周周一的日期；为空时按"未设置学期"处理
  semesterStart: '',
  totalWeeks: 20,
  periods: DEFAULT_PERIODS,
  reminder: {
    enabled: true,
    lead: 40,               // 课前提前提醒（分钟）
    mode: 'session',        // 'session' 每时段首节课提醒 | 'perClass' 每节课提醒
    morningTime: '07:00',   // 晨间简报时间
    eveningTime: '21:30',   // 晚间总结提醒时间
    afterClass: true,       // 下课后提醒记笔记
  },
  ai: {
    enabled: false,
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: '',
    visionModel: '',        // 支持图片的模型，如 glm-4v-flash / gpt-4o-mini
    textModel: '',          // 文本模型，如 deepseek-chat
  },
};

const KEY = 'ds-settings';
let memory = null; // Node 环境兜底

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function deepMerge(base, patch) {
  if (patch == null || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v != null && typeof v === 'object' && !Array.isArray(v)
        && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export function loadSettings() {
  const s = storage();
  let raw = null;
  if (s) {
    try { raw = JSON.parse(s.getItem(KEY) || 'null'); } catch { raw = null; }
  } else {
    raw = memory;
  }
  const clone = structuredClone(DEFAULT_SETTINGS);
  return deepMerge(clone, raw || {});
}

export function saveSettings(settings) {
  const s = storage();
  const json = JSON.stringify(settings);
  if (s) s.setItem(KEY, json);
  else memory = JSON.parse(json);
}

// Node 测试辅助
export function _setMemorySettings(obj) { memory = obj; }
