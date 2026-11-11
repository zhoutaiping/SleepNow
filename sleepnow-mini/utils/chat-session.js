// 晚安开关 · 会话纯函数层（无 wx / 云端依赖，可直接单测）
// 职责：历史 key 隔离、消息裁剪、模型上下文构造、每日额度、时间格式化
const MAX_MESSAGES = 40;      // 本地最多保留的消息条数
const DAILY_QUOTA = 20;       // 每日陪伴次数上限（前端软限额，服务端配额才是硬限）
const KEY_PREFIX = 'sn_chat_v2_';
const QUOTA_PREFIX = 'sn_chat_quota_';

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function dateKey(d) {
  const date = d || new Date();
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

// 历史按「身份 + 场景」隔离：切换场景不会串上下文，访客与登录用户不串数据
function historyKey(uid, scene, d) {
  return KEY_PREFIX + (uid || 'guest') + '_' + (scene || 'chat') + '_' + dateKey(d);
}

function quotaKey(uid, d) {
  return QUOTA_PREFIX + (uid || 'guest') + '_' + dateKey(d);
}

// 只保留最近 MAX_MESSAGES 条；丢弃非对话角色与空内容
// （生成中断/失败会留下空 assistant，若不清理，下次进入会出现空气泡）
function trimMessages(list, max) {
  const arr = (list || []).filter((m) => m
    && (m.role === 'user' || m.role === 'assistant')
    && typeof m.content === 'string'
    && m.content.trim());
  const limit = max || MAX_MESSAGES;
  return arr.length > limit ? arr.slice(arr.length - limit) : arr;
}

// 交给 llm.buildMessages 的历史：不传 time / scene 等展示字段
function contextOf(list) {
  return trimMessages(list).map((m) => ({ role: m.role, content: m.content || '' }));
}

// 额度状态：value 为已用次数，返回是否还能发送
function quotaState(used, limit) {
  const max = limit || DAILY_QUOTA;
  const n = Number(used) || 0;
  return { used: n, limit: max, left: Math.max(0, max - n), canSend: n < max };
}

// 消息时间戳：HH:MM
function timeLabel(d) {
  const date = d || new Date();
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

// 场景切换时，把新场景的第一句引导语作为 user 消息发出（预设文本，非生成内容）
function openingFor(scene, openings) {
  return (openings && openings[scene]) || '';
}

module.exports = {
  MAX_MESSAGES, DAILY_QUOTA, KEY_PREFIX, QUOTA_PREFIX,
  dateKey, historyKey, quotaKey, trimMessages, contextOf,
  quotaState, timeLabel, openingFor, pad,
};
