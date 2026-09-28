// 数据访问层：视图共享的查询与写入（组合 db + settings + model）

import { db } from './db.js';
import { loadSettings, saveSettings } from './settings.js';
import * as M from './model.js';
import { fmtDate, dayOfWeek, weekNumber, addDays, uid } from './util.js';

/* ---------- 课表 ---------- */

export async function getEntries() {
  return db.getAll('schedule');
}

// 某天（含周次过滤）的时间线
export async function getDayTimeline(date = new Date(), weekOverride = null) {
  const s = loadSettings();
  const day = dayOfWeek(date);
  const week = weekOverride ?? weekNumber(date, s.semesterStart);
  const entries = await db.getAll('schedule');
  return M.buildTimeline(s.periods, M.dayEntries(entries, day, week));
}

// 明天有课的节次（用于"明日准备"）：[{ periods, course, room, start, end }]
export async function getTomorrowClasses(date = new Date()) {
  const s = loadSettings();
  const tomorrow = addDays(date, 1);
  const tl = await getDayTimeline(tomorrow);
  const seen = new Set();
  const out = [];
  for (const item of tl) {
    if (!item.entry) continue;
    const key = item.entry.id;
    if (seen.has(key)) continue; // 连堂只取第一节
    seen.add(key);
    out.push({
      id: item.entry.id,
      periods: item.entry.periods,
      course: item.entry.course,
      room: item.entry.room,
      start: item.start,
      end: item.end,
    });
  }
  return out;
}

export async function saveEntry(entry) {
  const e = { ...entry };
  if (!e.id) e.id = uid();
  e.periods = [...new Set(e.periods)].sort((a, b) => a - b);
  await db.put('schedule', e);
  return e;
}

export async function deleteEntry(id) {
  await db.delete('schedule', id);
}

// 全部课程名（去重排序）
export async function getAllCourses() {
  const entries = await db.getAll('schedule');
  return [...new Set(entries.map(e => e.course).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
}

/* ---------- 笔记 ---------- */

export async function getNotes(dateStr) {
  return dateStr ? db.byIndex('notes', 'date', dateStr) : db.getAll('notes');
}

export async function saveNote(note) {
  const n = { ...note };
  if (!n.id) n.id = uid();
  await db.put('notes', n);
  return n;
}

export async function deleteNote(id) {
  await db.delete('notes', id);
}

// 某日期区间内的笔记（start/end 为 'YYYY-MM-DD'，含端点）
export async function getNotesBetween(startStr, endStr) {
  const all = await db.getAll('notes');
  return all.filter(n => n.date >= startStr && n.date <= endStr)
    .sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
}

/* ---------- 总结 ---------- */

export async function getSummary(type, dateStr) {
  const all = await db.byIndex('summaries', 'date', dateStr);
  return all.filter(s => s.type === type).pop() || null;
}

export async function saveSummary(summary) {
  const s = { ...summary };
  if (!s.id) s.id = uid();
  await db.put('summaries', s);
  return s;
}

export async function getAllSummaries() {
  const all = await db.getAll('summaries');
  return all.sort((a, b) => (b.date + b.generatedAt).localeCompare(a.date + a.generatedAt));
}

export async function deleteSummary(id) {
  await db.delete('summaries', id);
}

/* ---------- 备份 / 恢复 ---------- */

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

// 导出全部数据为 JSON（图片转 base64）
export async function exportAll() {
  const settings = loadSettings();
  const [schedule, notes, summaries] = await Promise.all([
    db.getAll('schedule'), db.getAll('notes'), db.getAll('summaries'),
  ]);
  const notesOut = [];
  for (const n of notes) {
    const images = [];
    for (const im of n.images || []) {
      images.push({
        ocrText: im.ocrText || '',
        dataUrl: im.blob ? await blobToDataURL(im.blob) : null,
      });
    }
    notesOut.push({ ...n, images });
  }
  return {
    app: 'dynamic-schedule',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    schedule,
    notes: notesOut,
    summaries,
  };
}

// 从 JSON 恢复（覆盖现有数据）
export async function importAll(json) {
  if (!json || json.app !== 'dynamic-schedule') throw new Error('不是有效的备份文件');
  await Promise.all([db.clear('schedule'), db.clear('notes'), db.clear('summaries')]);
  for (const e of json.schedule || []) await db.put('schedule', e);
  for (const n of json.notes || []) {
    const images = [];
    for (const im of n.images || []) {
      images.push({ ocrText: im.ocrText || '', blob: im.dataUrl ? await dataURLToBlob(im.dataUrl) : null });
    }
    await db.put('notes', { ...n, images });
  }
  for (const s of json.summaries || []) await db.put('summaries', s);
  if (json.settings) {
    saveSettings(json.settings);
  }
}

export async function clearAllData() {
  await Promise.all([db.clear('schedule'), db.clear('notes'), db.clear('summaries')]);
}
