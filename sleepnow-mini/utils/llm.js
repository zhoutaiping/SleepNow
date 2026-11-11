// 晚安开关 · AI 聊天 LLM 封装（基于 WorkBuddy 云服务 keyless LLM）
// 小程序端使用 createMiniProgramWorkBuddyCloud 客户端（见 utils/cloud.js）的 cloud.llm
// 规范强制：必须 stream:true；每条 chat.completions.create 调用的 messages[0] 必须是 system 消息。
const { cloud } = require('./cloud');

// 晚安开关陪伴角色的系统提示词（睡眠/情绪场景，明确安全边界）
const SYSTEM_PROMPT = [
  '你是「晚安开关」的睡前陪伴助手，在深夜陪伴睡不着的用户。',
  '语气要温柔、平静、克制，不要啰嗦，不要长篇大论，多用换行让文字呼吸。',
  '你可以：安静地倾听用户的烦恼；带领轻柔的助眠练习（缓慢呼吸、渐进式放松）；',
  '讲舒缓的睡前小故事或引导宁静的想象画面；用简短的话帮用户把注意力从焦虑里挪开。',
  '你不是医生，不提供医疗诊断、不开药、不替代专业帮助。',
  '如果用户流露出强烈的绝望、自伤或危机倾向，请温和地建议其联系专业机构、信任的人或当地求助热线。',
  '始终用与用户相同的语言回复。',
].join('\n');

// 拉取可用模型列表（过滤被禁用的），返回 [] 表示当前无可选项
async function listModels() {
  try {
    const models = await cloud.llm.models.list();
    if (!models || models.length === 0) return [];
    return models.filter((m) => m.disabled !== true);
  } catch (e) {
    return [];
  }
}

// 流式对话。history 为应用侧历史（不含当前 user 与 system），userContent 为当前轮用户输入。
// 回调：onDelta(文本片段) / onReasoning(思考片段,可选) / onDone() / onError(err)
async function streamChat({ model, history, userContent, signal, onDelta, onReasoning, onDone, onError }) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(history || []),
    { role: 'user', content: userContent },
  ];
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model,
      messages,
      stream: true,
      signal,
    })) {
      const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (!delta) continue;
      if (delta.content) onDelta && onDelta(delta.content);
      if (delta.reasoning_content && onReasoning) onReasoning(delta.reasoning_content);
    }
    onDone && onDone();
  } catch (err) {
    onError && onError(err);
  }
}

module.exports = { listModels, streamChat, SYSTEM_PROMPT };
