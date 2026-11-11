# 晚安开关小程序 · AI 接入实操方案

> 版本 v1.1 ｜ 2026-11-11 ｜ 适用工程：`sleepnow-mini/`（原生微信小程序 + WorkBuddy 云服务）
> 配套交付：陪伴页 v2 重构、场景化 Prompt 引擎、内容安全抽象层
> v1.1 追加：第 10 节「语音输入」——输入框改严格单行 + 三档可插拔 ASR
> 状态：**开发态可跑通；正式提审前必须先完成第 0 节的主体/类目决策**

---

## 0. 结论先行

### 0.1 三句话

1. **AI 功能在个人主体下不能直接上线。** 微信官方开放社区明确：AI 问答涉及深度合成技术，须补充「深度合成-AI 问答」服务类目，而**个人主体尚未开放该类目**。这不是「补个内容安全接口」能绕过的，是主体资质门槛。
2. **工程侧已具备完整可运行链路。** keyless LLM、四个睡前场景、流式输出、上下文裁剪、额度、双向审核接口都已落地；缺的是**云端审核实现**与**合规材料**。
3. **本轮还修掉一个真 bug**：陪伴页所有文案此前是 `undefined`（截图里整页空白的根因），见 1.1。

### 0.2 三条硬约束

| # | 约束 | 依据 | 后果 |
|---|------|------|------|
| C1 | 个人主体无法申请「深度合成-AI 问答」类目 | 微信开放社区《小程序中使用了 Extend.AI 能力，如何准备备案材料？》 | AI 对话功能提交代码审核会被驳回 |
| C2 | 内容安全接口必须服务端调用 | 微信官方 `msgSecCheck` 文档：「接口应在服务器端调用，不可在前端（小程序、网页、APP 等）直接调用」 | 前端不能持有 AppSecret / access_token；需要云函数或 BFF |
| C3 | AI 生成内容必须显式标识 + 用户协议明示 + 日志留存 | 《人工智能生成合成内容标识办法》（2025-09-01 施行）第 4/5/8/9 条 | 界面无「AI 生成」提示、协议无免责条款，是常见驳回点 |

> 补充：即便日后升级主体，**iOS 端虚拟商品仍不能走微信支付**（沿用方案文档既有结论）。

### 0.3 路径决策表

| 路径 | 做法 | 能否保留 AI 对话 | 成本 / 周期 | 适用 |
|------|------|-----------------|------------|------|
| **A. 升级主体**（推荐给要长期做 AI 的场景） | 注册个体工商户或企业主体 → 企业认证 → 申请「深度合成 > AI 问答」类目 → 用云开发 AI+ 生成算法备案资料 | ✅ 完整保留 | 个体工商户注册约数百元/年（第三方口径，以当地为准）；自主算法备案第三方估算 3–13 万元、2–3 个月，**优先用云平台生成的备案资料** | 想把「陪伴」做成核心卖点 |
| **B. 非生成式降级**（最快上线） | 去掉 LLM 自由生成，四个场景改为**预设语料 + 定时节奏文本 + 固定故事**，按用户选择播放文案 | ❌ 改为规则式，但体验仍完整 | 1~2 天，代码只换数据源 | 个人主体、先跑通 1.0 上架 |
| **C. 移出小程序** | 小程序「陪伴」Tab 改为纯预设内容；生成式 AI 放到已有的 Electron 桌面端 / H5 | ⚠️ 小程序内不提供 | 低，但需另一端的实现 | 与既有「桌面端变现」路线一致 |

### 0.4 推荐路线

```
现在（开发态）  → 用本轮重构的 v2 页跑通链路、真机验证
提审前决策      → 若短期上架：走 B（换数据源，UI 零改动）
                 若要 AI 卖点：先启动 A 的主体与备案（周期长，并行做）
路径 A 落地后   → 执行第 4 节 Step 3~5，接云端审核 + 补合规材料 → 提审
```

> 工程架构已为 B 预留：`send()` 的数据源只在 `utils/llm.js`，换成 `utils/local-scripts.js` 即可，页面四件套与 i18n 完全复用。

---

## 1. 现状诊断

### 1.1 截图为什么整页空白（真 bug，已修复）

| 现象 | 根因 |
|------|------|
| 标题、空态提示、按钮文字、输入占位符全消失 | `core/i18n.js` 的 `all()` 返回 `{'chat.title': '陪伴', ...}` 带点 key；`chat.wxml` 却用 `{{t.chatTitle}}` 驼峰别名 → 全部 `undefined` |
| 右上角只剩 "Auto" | 那是 `{{modelName}}`，来自云端模型列表，与 i18n 无关，所以唯一可见 |
| 灰色横条 + `>` 无文字 | 访客提示条的 `{{t.loginHint}}` / `{{t.goLogin}}` 取不到值 |
| 底部纯黑圆圈 | 发送按钮的 `{{t.send}}` 取不到值，只剩 `--primary` 填充 |

**修复**：改用与 `home` / `sleep-log` / `settings` 一致的 `TEXT_KEYS` + `buildTexts()`，由 `i18n.t(key)` 逐个生成 `t.xxx`；并加入工程自检防止复发（见第 9 节）。

### 1.2 现有 AI 链路盘点（本轮改造后）

```
pages/chat/chat.js          交互与状态编排
   ├─ utils/llm.js          场景化 Prompt 引擎 + keyless 流式调用
   │    └─ utils/cloud.js   createMiniProgramWorkBuddyCloud → cloud.llm
   ├─ utils/moderation.js  双向内容安全抽象层（local / cloud 两种模式）
   ├─ utils/chat-session.js 纯函数：历史隔离、裁剪、额度、时间
   ├─ core/auth.js          身份（微信 openid / 手机号 OTP / 访客）
   ├─ core/theme.js         黑白灰双主题订阅
   └─ core/i18n.js          zh/en 词条
```

| 能力 | 改造前 | 改造后 |
|------|--------|--------|
| 系统提示词 | 单一 `SYSTEM_PROMPT` | 4 套场景 Prompt + 共用安全边界 |
| 上下文 | 全量历史直送 | 按场景裁剪（4~8 轮）、剔除空 assistant、结尾不停在 assistant |
| 中止 | 仅 `AbortController`（小程序端兼容性未验证） | `shouldStop` + `signal` 双保险 |
| 超时 | 无 | 60s 超时 + 明确错误文案 |
| 错误 | 按 `err.error.code` 前缀分类 | `classifyError()` 统一，区分 quota/network/aborted/generic |
| 内容安全 | `BLOCK_WORDS` 写在页面里 | 独立抽象层，可注入云端 `msgSecCheck` |
| 额度 | 无 | 前端软限额 20 次/天，按身份 + 日期隔离 |
| 合规标识 | 无 | 顶部 AI 徽标、消息 AI 标记、空态完整免责、输入区短免责 |

### 1.3 仍存在的缺口

| 缺口 | 级别 | 说明 |
|------|------|------|
| 云端内容安全未接 | 🔴 提审红线 | `moderation.js` 默认 `local` 模式，仅本地词表，**不能作为审核依据** |
| 主体 / 类目 / 算法备案 | 🔴 提审红线 | 见 C1 |
| 用户协议与隐私政策 | 🟠 高 | 工程无协议页；需明示 AI 标识规则与免责条款 |
| 服务端日志留存 ≥ 6 个月 | 🟠 高 | 聊天记录目前只存 `wx.setStorage`，无服务端留痕 |
| 隐式标识（文件元数据） | 🟡 中 | 当前纯界面文本、无导出功能；若加「导出/分享对话」必须补 |
| 输出审核时序 | 🟡 中 | 流式展示完成后才审核替换，见 5.4 |
| 音频版权 / 真机 AppID | ⚪ 既有 | 沿用 1.0 待办 |

---

## 2. 重新设计后的 AI 功能

### 2.1 设计原则

- **不让用户面对空输入框**：睡前用户认知负荷低，「说点什么」是最大的使用障碍。
- **场景化而非通用聊天**：把「陪伴」拆成 4 个有明确边界的任务，既提升体验，也**收窄生成内容风险面**。
- **预设优先于生成**：快捷提问与场景首句是固定文案（非 AIGC），降低输入侧审核压力。
- **合规标识内建**：AI 徽标与免责声明是界面结构的一部分，不是提审前临时贴的补丁。

### 2.2 四个场景

| 场景 | 角色指令要点 | 上下文上限 | 点击后自动发出的首句 | 合规收益 |
|------|-------------|-----------|---------------------|---------|
| `chat` 聊聊今天 | 复述感受 + 一句安放；不说教、不给建议清单、不追问隐私 | 8 轮 | 「我今晚想随便聊几句」 | 边界最宽，靠输入审核兜底 |
| `breathe` 呼吸练习 | 4-7-8 节奏，每轮一句，用户回应才进下一轮 | 6 轮 | 「带我做一次 4-7-8 呼吸练习」 | 输出高度结构化，风险最低 |
| `body` 身体扫描 | 从脚趾起，每次只一个部位，两三句话 | 6 轮 | 「带我做一次身体扫描放松」 | 同上 |
| `story` 睡前故事 | 约 100 字，无冲突/惊吓/悬念/反转 | 4 轮 | 「给我讲一个安静的睡前小故事」 | 明确排除高风险叙事 |

共用安全边界（所有场景强制拼在 system 首条）：温柔克制 / 120 字内 / 无列表无 emoji / **非医生、不诊断不用药不心理治疗** / 危机倾向时建议联系信任的人或当地求助热线 / 不涉政暴黄违 / 跟随用户语言。

### 2.3 首屏 → 会话 → 输入区

```
顶部  标题「睡前陪伴中心」+ AI 徽标 + 清空
      「对话模型」行：标签 + 当前模型 + 箭头 + 「云端提供，前端不持有密钥」
      访客提示（未登录时）
首屏  「内容由 AI 生成」eyebrow → 大标题 → 引导语
      2×2 场景卡（编号 / 名称 / 描述 / 箭头）→ 点卡片自动开始
      快捷提问 chips（4 条预设）
      完整免责声明
会话  每条消息：角色 + AI 标记 + 时间 + 气泡；生成态 typing
      场景切换条（横向，随时换陪伴方式）
输入  额度 x/20 · 字数 x/500 · 输入框 · 明确文字的「发送 / 停止」按钮 · 短免责
```

### 2.4 合规标识落点（对应《标识办法》第 4 条）

| 位置 | 文案 | 类型 |
|------|------|------|
| 顶部徽标 | `AI` | 交互界面显著提示 |
| 空态 eyebrow | `内容由 AI 生成` | 生成合成内容提示 |
| 每条 AI 消息 | `AI` 小徽标 | 内容周边提示 |
| 输入区底部 | `AI 生成 · 非医疗建议` | 常驻提示 |
| 空态底部 | 完整免责：AI 生成内容，仅供参考，不构成医疗或心理治疗建议 | 用户告知 |

---

## 3. 技术架构与关键实现

### 3.1 文件清单

| 文件 | 职责 |
|------|------|
| `utils/llm.js` | `SCENES` / `systemPrompt(scene, lang)` / `buildMessages()` / `listModels()` / `streamChat()` / `classifyError()` |
| `utils/moderation.js` | `configureCloudCheck(fn)` / `checkInput()` / `checkOutput()` / `getMode()` |
| `utils/chat-session.js` | `historyKey(uid, scene)` / `trimMessages()` / `contextOf()` / `quotaState()` / `timeLabel()` |
| `pages/chat/chat.{js,wxml,wxss,json}` | 陪伴页 v2 四件套 |
| `i18n/zh-CN.js` · `en-US.js` | 新增约 50 条陪伴页词条（中英对齐） |

### 3.2 必须遵守的 SDK 规范

1. `messages[0]` 必须是 `system`（`buildMessages()` 保证）。
2. 只能 `stream: true`，非流式会被 SDK 拒绝。
3. keyless：`utils/cloud-config.js` 里只有 `publishableKey`（公开下发值），**不得出现模型 API Key / AppSecret / access_token**。

### 3.3 关键实现点

| 点 | 做法 |
|----|------|
| 上下文裁剪 | 按场景 `maxTurns * 2` 条截断；剔除 system、空内容、末尾悬空 assistant |
| 历史隔离 | key = `sn_chat_v2_{uid}_{scene}_{YYYY-MM-DD}`，切换场景不串上下文，访客与登录用户不串数据 |
| 中止 | `shouldStop()` 每片检查 + `AbortController.signal`（存在时），主动中止不计错误 |
| 超时 | 60s `setTimeout` 置停止标志并 abort，`postProcess` 给「回应超时，点此重试」 |
| 错误分类 | `quota_*` → 额度；`auth_/gateway_/model_/internal_` → 网络；abort/timeout → 静默；其余 generic |
| 额度 | 前端软限额 20 次/天，成功一轮才 +1；**服务端配额仍是硬限**，`quota_*` 错误单独提示 |
| 降级 | 模型列表为空 → 显示「自动」+ 无模型提示；`send()` 会先重试一次 `loadModels()` |

---

## 4. 分步实操

### Step 0 · 先定主体路径（阻塞项）

- 走 **B**：直接在代码层换数据源，跳过 Step 3~5 中与算法备案相关的部分。
- 走 **A**：注册个体工商户/企业主体 → 小程序主体变更或重新注册 → 企业认证 → 申请「深度合成 > AI 问答」类目。
  - 微信云开发路径：确认环境有效期 ≥ 3 个月 → 云开发平台 `AI+` 概览页 → 帮助文档「小程序算法备案」→ 填 AppID 与主体名称 → 平台生成备案资料 → 小程序后台选「2.2 深度合成服务《在用证明》」上传清晰截图（须含**小程序主体 / AppID / 订单有效期 / 算法备案号**）。
  - 自主算法备案周期长（第三方称 2–3 个月），**务必与开发并行启动**，不要等代码写完才开始。

### Step 1 · 工程可运行基线

```bash
# 1) 微信开发者工具打开 sleepnow-mini/
# 2) project.config.json 填入真实 AppID（当前仍是 touristappid）
# 3) 工具 → 构建 npm（安装 @tencent-ai/workbuddy-cloud-sdk）
# 4) 确认云服务端模型可用：进入陪伴页，模型行应显示实际模型名而非「自动」
```

### Step 2 · 验证 keyless LLM 链路

真机依次验证：点「呼吸练习」场景卡 → 自动发出预设首句 → 流式返回 → 停止按钮 → 超时与重试 → 切换语言后 Prompt 跟随。
`cloud.llm.models.list()` 返回空时，检查云服务控制台该应用是否已开通 LLM 能力与额度。

### Step 3 · 接入云端内容安全（路径 A 必做）

> 前提：**微信云开发**与 **WorkBuddy 云服务**可以并存，二者是不同后端：前者只负责 `msgSecCheck` 云调用，后者负责 DB / Auth / LLM。

**① 新建云函数 `cloudfunctions/moderateText/index.js`**

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { content, direction } = event || {};
  if (!content || typeof content !== 'string') return { suggest: 'review' };
  const { OPENID } = cloud.getWXContext();
  try {
    const r = await cloud.openapi.security.msgSecCheck({
      version: 2,                       // 固定 2
      scene: 4,                         // 4=社交日志；聊天也可用 2=评论
      openid: OPENID,                   // 用户需近两小时访问过小程序
      content: content.slice(0, 2500),  // UTF-8，≤2500 字
    });
    const suggest = r && r.result && r.result.suggest ? r.result.suggest : 'review';
    return { suggest, direction };
  } catch (e) {
    // 审核异常一律不放行
    return { suggest: 'review', reason: String((e && e.errMsg) || e) };
  }
};
```

**② `cloudfunctions/moderateText/config.json`**

```json
{ "permissions": { "openapi": ["security.msgSecCheck"] } }
```

**③ 小程序端注入（`app.js` 的 `onLaunch`）**

```js
const moderation = require('./utils/moderation');
wx.cloud.init({ env: '你的云开发环境ID', traceUser: true });
moderation.configureCloudCheck(async (text, ctx) => {
  const r = await wx.cloud.callFunction({
    name: 'moderateText',
    data: { content: text, direction: ctx.direction },
  });
  return { suggest: r.result.suggest };
});
```

注入后 `moderation.getMode()` 变为 `cloud`，模型弹层里的「开发态：云端内容安全未启用」提示会消失。

> 若不用微信云开发，改走自建 BFF：服务端用 AppSecret 换 `access_token`，POST `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=...`，前端只调自己的 HTTPS 域名（需备案 + 配 request 合法域名）。

### Step 4 · 合规三件套

| 项 | 落点 | 状态 |
|----|------|------|
| 显式标识 | 已内建在陪伴页（见 2.4） | ✅ |
| 用户协议明示 AI 标识规则与免责 | 需新增协议页/《用户服务协议》，并在登录页与「我的」页给入口 | ⬜ 待做 |
| 隐私政策补充 AI 对话数据处理说明 | 现有 `.wbapp_*.privacy.json` 为 `[]`，需复核并补齐 | ⬜ 待做 |
| 服务端日志留存 ≥ 6 个月 | 新建 `ai_chat_logs` 表（uid / scene / trace_id / 时间 / 审核结果，**不存原文或做脱敏**）+ RLS | ⬜ 待做 |
| 隐式标识 | 若提供「导出/分享对话」，在文件元数据写入生成合成属性、服务提供者编码、内容编号 | ⬜ 条件触发 |

### Step 5 · 提审自检

常见驳回点（业界总结）：界面未标注「由 AI 生成」、用户协议缺 AI 免责条款、未接输入内容安全过滤。本方案前两项已有落点，第三项由 Step 3 完成。另需：
- 服务类目与小程序实际功能一致；
- 提审说明里写清「AI 能力由云端模型提供、已接入内容安全双向审核、已做生成内容标识」；
- 测试账号可登录、可走完整对话链路（审核员会实测）。

### Step 6 · 真机验证清单

- [ ] 微信 / 手机号 / 访客三种身份下，聊天历史互不串
- [ ] 四个场景各跑一轮，Prompt 语气与长度符合设定
- [ ] 流式输出、中途停止、60s 超时、错误重试
- [ ] 切换语言后 UI 与模型回复语言一致
- [ ] 浅色/深色主题下 AI 徽标、气泡、按钮对比度可读
- [ ] 输入违禁样例 → 被拦截并提示；云端审核不可用时 → **拒绝放行**（fail-closed）
- [ ] 额度用尽后不再发起请求

---

## 5. 内容安全详解

### 5.1 `msgSecCheck` v2 参数速查

| 参数 | 值 | 备注 |
|------|-----|------|
| `version` | `2` | 固定 |
| `scene` | `1` 资料 / `2` 评论 / `3` 论坛 / `4` 社交日志 | 聊天建议 `4` 或 `2` |
| `openid` | 必填 | 用户需近两小时访问过小程序，否则 `61010` |
| `content` | ≤ 2500 字 UTF-8 | 超出需截断分段 |
| 返回 | `result.suggest = pass / review / risky` | 新版看 `suggest`，不是旧版 `errcode 87014` |
| 频率 | 4000 次/分、200 万次/天 | **未上架小程序仅 100 次/天**，开发期注意省着用 |
| 权限 | 云函数 `config.json` 声明 `security.msgSecCheck` | HTTPS 方式需 `access_token` |

### 5.2 双向审核时序（当前实现）

```
用户输入
  → moderation.checkInput(text)       本地粗筛 + 云端精筛（fail-closed）
  → 放行才加入消息并调用 LLM
  → 流式逐字渲染
  → 生成结束 moderation.checkOutput(acc)
  → 未通过：整段替换为「这段回复未通过安全检查，我们换个话题吧」
  → 通过：标记为 AI 消息并计次
```

### 5.3 失败策略

`utils/moderation.js` 采用 **fail-closed**：`review`、`risky`、审核服务异常、空文本，一律 `pass: false`。宁可少一次对话，也不放行未审核内容。

### 5.4 已知限制与生产改进（诚实说明）

当前是「**先流式展示、完成后再审核**」，用户可能在替换前短暂看到未过审文本。生产建议二选一：

1. **服务端流式转发 + 分片审核**（推荐）：云函数/ BFF 接收流，每累积 100~200 字或一个完整句子送检，通过后再推给小程序；未通过立即断流。代价是需要在服务端中转 LLM 流，keyless 前端直连的简洁性会打折。
2. **缓冲后展示**：牺牲流式，等全文审核通过再一次性渲染。改动最小，体验降级明显。

> 若采用路径 B（非生成式），上述输出侧审核可整体移除——预设文案在上架前人工审一遍即可。

### 5.5 与 WorkBuddy 云服务的边界

| 能力 | 提供方 |
|------|--------|
| 数据库 / 登录 / 文件存储 / keyless LLM | WorkBuddy 云服务（`cloud.database` / `cloud.auth` / `cloud.llm`） |
| `msgSecCheck` 内容安全 | 微信云开发云函数（或自建 BFF） |
| 服务端审核日志 | 建议落 WorkBuddy 云服务 `ai_chat_logs` 表（带 owner-only RLS） |

**不要**试图在小程序前端直接调 `api.weixin.qq.com`：既拿不到 `access_token`，也无法配置合法域名。

---

## 6. 合规与提审 Checklist

| # | 检查项 | 依据 | 工程落点 | 状态 |
|---|--------|------|---------|------|
| 1 | 主体可申请深度合成类目 | 微信开放社区 | 主体决策（0.3） | ⬜ 阻塞 |
| 2 | 「深度合成 > AI 问答」类目已添加 | 同上 | 小程序后台 | ⬜ |
| 3 | 算法备案 / 在用证明已提交 | 同上 | 小程序后台 | ⬜ |
| 4 | 界面显式「AI 生成」标识 | 《标识办法》第 4 条 | 陪伴页 4 处 | ✅ |
| 5 | 用户协议含 AI 免责与标识规则 | 第 8 条 | 待新增协议页 | ⬜ |
| 6 | 输入侧内容安全 | 平台审核要求 | `checkInput` + Step 3 云函数 | 🟡 接口已留，云端未接 |
| 7 | 输出侧内容安全 | 平台审核要求 | `checkOutput` | 🟡 同上 |
| 8 | 服务端日志留存 ≥ 6 个月 | 第 9 条 | `ai_chat_logs` 表 | ⬜ |
| 9 | 隐式标识（有导出功能时） | 第 5 条 | 导出逻辑 | ⬜ 条件 |
| 10 | 非医疗宣称 | 《生成式 AI 暂行办法》+ 广告法 | system prompt + 全站文案 | ✅ |
| 11 | 危机倾向兜底话术 | 产品伦理 | system prompt | ✅ |
| 12 | 隐私清单与实际采集一致 | 微信隐私协议 | `.wbapp_*.privacy.json` | ⬜ 待复核 |
| 13 | 真机全链路验证 | — | Step 6 | ⬜ |

---

## 7. 成本与额度

| 项 | 说明 |
|----|------|
| WorkBuddy 云服务 LLM | keyless 调用，按平台配额计费；具体额度以云服务控制台为准，不在代码里写死 |
| 前端软限额 | 20 次/天（`utils/chat-session.js` 的 `DAILY_QUOTA`），仅改善体验，**服务端配额才是硬限** |
| `msgSecCheck` | 微信侧接口，注意**未上架小程序 100 次/天**的调用上限 |
| 云函数 | 微信云开发按调用量计费，通常有免费额度；以控制台为准 |
| 算法备案 | 优先用云开发 AI+ 生成的备案资料；自主备案的第三方成本估算仅供参考，须向微信开放社区核实最新要求 |

---

## 8. 风险登记

| 风险 | 等级 | 缓解 |
|------|------|------|
| 个人主体无法上线 AI 对话 | 🔴 最高 | 0.3 路径决策；B 方案可立即降级上架 |
| 前端无法安全持有审核密钥 | 🔴 高 | 云函数 / BFF；`moderation.js` 不内置任何密钥 |
| 输出审核事后替换 | 🟡 中 | 5.4 分片审核方案；或路径 B 移除输出审核 |
| `AbortController` 小程序端兼容性 | 🟡 中 | `shouldStop` 不依赖它，已在真机清单里列为验证项 |
| 聊天记录本地存储不跨设备 | 🟡 中 | 沿用既有设计取舍；如需云端同步另建表并合并 |
| 微信账号与手机号是两套独立身份 | ⚪ 既有 | 文档已记录，不做自动绑定 |
| 音频版权 / 真实 AppID 未填 | ⚪ 既有 | 1.0 待办，未变化 |

---

## 9. 本轮交付与可复跑验证

**新增 / 改动文件**

| 文件 | 变更 |
|------|------|
| `pages/chat/chat.{js,wxml,wxss}` | 陪伴页 v2 重写（修 i18n bug、场景化、合规标识） |
| `utils/llm.js` | 场景化 Prompt 引擎、上下文裁剪、错误分类、双保险中止 |
| `utils/moderation.js` | 新增：双向内容安全抽象层 |
| `utils/chat-session.js` | 新增：会话纯函数层 |
| `i18n/zh-CN.js` · `en-US.js` | 新增约 50 条陪伴页词条 |
| `design-system/MASTER.md` | 追加陪伴页范式与 AI 标识规范 |
| `scripts/check-chat.js` | 新增：AI 链路回归测试 |

**验证命令**

```bash
cd sleepnow-mini
node scripts/check-theme.js       # 黑白主题 / i18n / token 规范
node scripts/check-dashboard.js   # 既有三页聚合与渲染
node scripts/check-chat.js        # 本轮：Prompt / 会话 / 审核 / 页面分支
```

**回归测试覆盖**：system 首位、四场景 Prompt 差异、上下文裁剪轮数、剔除空 assistant、历史 key 隔离、额度边界、错误分类、本地审核拦截、云端审核注入与 fail-closed、页面冷启动渲染与场景切换。

---

> ⚠️ 再次强调：本方案解决的是「**怎么接**」，不替代「**能不能上**」。个人主体下请先在 0.3 里选定路径再投入提审准备。

---

## 10. 语音输入（v1.1 · 输入区改严格单行）

### 10.1 结论先行：个人主体用不了「同声传译」插件

微信官方插件 **WechatSI**（`wx069ba97219f66d99`）最省事，但它的服务类目是「IT 科技 > 软件服务提供商」，
微信开放社区明确答复：**该服务类目不在个人主体开放范围内，个人主体小程序无法添加该插件**；
企业主体在开发版/体验版可用，个人主体即便能配置，正式版也会因主体资质校验失败。

另一个坑：**必须在小程序后台添加插件后，才能在 `app.json` 写 `plugins` 声明**。
顺序反了，开发者工具会报「插件未授权使用」甚至直接白屏。因此本工程**默认不声明任何插件**，
由 `utils/speech.js` 在运行时懒检测，检测不到就安静降级，对现有 Demo 零副作用。

### 10.2 三档 provider

| 模式 | 主体要求 | 后端 | 录音权限 | 实时识别 | 默认 |
|------|---------|------|---------|---------|------|
| `keyboard` 系统键盘麦克风 | 无（个人主体可用） | 不需要 | 不需要 | 由输入法提供 | ✅ **默认** |
| `plugin` 微信同声传译 | **企业/个体工商户** | 不需要 | 需要 | ✅ 边说边出字 | 配置后自动启用 |
| `cloud` 云函数 ASR | 无（云开发个人可用） | 需要云函数 + 腾讯云 ASR | 需要 | ❌ 说完一次性返回 | 一行代码启用 |

优先级 `plugin > cloud > keyboard`，由 `speech.getMode()` 自动判定；页面只认状态，不关心底层是谁。

- **默认路径真能用的语音输入**：轻点麦克风 → 聚焦单行输入框 → 用户点微信键盘 / 系统输入法的麦克风说话 →
  文字直接落到输入框。不需要插件、不需要 AppID 资质、不需要后端、不申请 `scope.record`。
  ⚠️ 开发者工具模拟器没有键盘麦克风，**必须真机验证**。
- **插件路径**：边说边把 `onRecognize` 的实时文字追加进输入框，松手/再点后定稿。
- **云 ASR 路径**：`wx.getRecorderManager` 录 30s/16kHz 单声道 mp3 → 临时文件交云函数 → 返回文本。
  录音文件不落库、不进聊天记录，识别后立即删除云端临时文件。

### 10.3 交互与合规约定

```
轻点麦克风 → 开始录音（额度行变「脉冲点 + 正在聆听 + 秒数 + 取消」，麦克风反相）
再点 / 松手 → 结束 → 正在转成文字 → 文本追加进输入框
用户可编辑 → 点「发送」→ moderation.checkInput → LLM → 输出审核（链路完全不变）
```

| 约定 | 原因 |
|------|------|
| **绝不自动发送** | 语音识别有误，用户必须能看一眼再发；也让输入侧审核保持单一入口 |
| 追加到已有文字后 | `mergeText()` 中文直连、英文补空格，不覆盖用户已输入内容 |
| 上限 500 字 / 30 秒 | 与输入框 `maxlength` 一致；30s 覆盖腾讯云「一句话识别」的时长限制 |
| 取消 / 页面卸载一律清状态 | 迟到的 `onStop` / `onRecognize` 会被 `cancelled` 丢弃，不留空气泡、不留 interval |
| 录音中禁止生成态切换 | 与既有 `isGenerating` 守卫一致 |

### 10.4 路径 1 · 企业主体启用「同声传译」

```bash
# ① 小程序后台：设置 → 第三方设置 → 插件管理 → 添加插件
#    搜索「微信同声传译」或 AppID wx069ba97219f66d99，等待通过
# ② 只有①完成后，才在 app.json 追加：
```

```json
"plugins": {
  "WechatSI": {
    "version": "0.3.5",
    "provider": "wx069ba97219f66d99"
  }
}
```

代码**无需改动**：`speech.js` 的 `requirePlugin('WechatSI')` 会成功，`getMode()` 自动变成 `plugin`。
`lang` 按当前 i18n 自动映射 `zh_CN` / `en_US`。

### 10.5 路径 2 · 任意主体启用云函数 ASR

**① `app.js` 的 `onLaunch` 里加两行**

```js
wx.cloud.init({ env: '你的云开发环境ID', traceUser: true });
require('./utils/speech').enableCloudASR({ name: 'speechToText' });
```

`enableCloudASR()` 内部只做两件事：`cloud.uploadFile` 传临时录音 → `cloud.callFunction` 拿 `{ text }`。
前端**只传 fileID，不接触任何密钥**。

**② 云函数 `cloudfunctions/speechToText/index.js`**

```js
const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const fs = require('fs');
const os = require('os');
const path = require('path');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const AsrClient = tencentcloud.asr.v20190614.Client;

exports.main = async (event) => {
  const { fileID, lang = 'zh_CN' } = event || {};
  if (!fileID) return { text: '' };
  const tmp = path.join(os.tmpdir(), 'asr-' + Date.now() + '.mp3');
  try {
    const res = await cloud.downloadFile({ fileID });
    fs.writeFileSync(tmp, res.fileContent);
    const audio = fs.readFileSync(tmp);
    const client = new AsrClient({
      credential: {
        secretId: process.env.TENCENTCLOUD_SECRET_ID,   // 云函数环境变量，绝不下发前端
        secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
      },
      region: 'ap-shanghai',
      profile: { requestTimeout: 10000 },
    });
    const r = await client.SentenceRecognition({
      ProjectId: 0,
      SubServiceType: 2,
      EngSerViceType: lang === 'en_US' ? '16k_en' : '16k_zh',
      SourceType: 1,
      VoiceFormat: 'mp3',
      UsrAudioKey: 'sleepnow-' + Date.now(),
      Data: audio.toString('base64'),
      DataLen: audio.length,
    });
    return { text: (r && r.Result) || '' };
  } catch (e) {
    return { text: '', error: String((e && e.message) || e) };
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
    try { await cloud.deleteFile({ fileList: [fileID] }); } catch (e) {} // 不留存录音
  }
};
```

**③ `cloudfunctions/speechToText/package.json`**

```json
{
  "dependencies": {
    "wx-server-sdk": "~2.6.3",
    "tencentcloud-sdk-nodejs": "^4.0.0"
  }
}
```

> 需在腾讯云开通「语音识别 - 一句话识别」，密钥配置为云函数环境变量；计费与免费额度以控制台为准。
> 若已有自建 BFF，也可 `configureRecognizer(async (filePath, meta) => ...)` 换成自己的 HTTPS 上传接口。

### 10.6 权限与隐私清单

| 项 | 说明 |
|----|------|
| `scope.record` | 仅 `plugin` / `cloud` 模式申请；首次由 `wx.authorize` 弹系统框，被拒过则 `wx.showModal` 引导 `openSetting` |
| 隐私政策 | 启用 App 内录音后，必须在隐私清单/用户协议补「麦克风：用于语音转文字，仅识别期间临时处理，不留存原始音频」 |
| 数据留存 | 录音临时文件识别后即删；聊天记录仍沿用既有 `wx.setStorage` 本地存储，不因语音新增云端数据 |
| AI 标识 | 语音只是输入方式，不改变生成内容属性，第 2.4 节的标识全部保持不变 |

### 10.7 本轮改动文件

| 文件 | 变更 |
|------|------|
| `pages/chat/chat.wxml` | 输入区改为「麦克风 + 单行 `input` + 发送」一行；额度行复用为录音状态行 |
| `pages/chat/chat.wxss` | 三元素同高 88rpx、纯 CSS 麦克风（随主题反相）、脉冲动效、减弱动效适配 |
| `pages/chat/chat.js` | 新增语音状态机（点击/长按/取消）、结果只填字不发送、`TEXT_KEYS` 扩 10 个词条 |
| `utils/speech.js` | **新增**：三档 provider 抽象层、权限、录音、识别、取消、错误回调 |
| `i18n/zh-CN.js` · `en-US.js` | 各 +10 条语音词条（zh/en 各 193 条，对齐） |
| `app.js` | 两种增强模式的启用位置（注释示例，默认不启用） |
| `scripts/check-chat.js` | +22 项：单行静态防复发、三档模式、录音状态机、权限、异常、不自动发送 |
| `design-system/MASTER.md` | 新增第 9 节「输入栏规范」 |

### 10.8 真机验证清单

- [ ] 默认（个人主体 / `touristappid`）：点麦克风 → 键盘弹起 → 用键盘麦克风说话 → 文字进入单行输入框
- [ ] 输入框长文本横向滚动，**输入栏高度始终不变**
- [ ] 键盘「发送」键 = 点发送按钮；生成中显示「停止」
- [ ] 企业主体加插件后：录音态反相、秒数递增、边说边出字、松手定稿
- [ ] 云 ASR 路径：识别结果填入、原始录音云端已删、云函数日志无密钥
- [ ] 拒绝麦克风权限 → 弹授权引导；去设置页开启后可正常录音
- [ ] 录音中点「发送」/「清空」/ 返回上一页：状态复位、无残留计时器、无空气泡
- [ ] 深色主题下麦克风反相与脉冲点对比度可读；系统「减弱动效」下不再闪烁
- [ ] 语音识别出的违规样例，仍被 `checkInput` 拦截（合规链路未被绕过）

**验证命令**

```bash
cd sleepnow-mini
node scripts/check-theme.js       # 黑白主题 / i18n / token 规范
node scripts/check-dashboard.js   # 三页聚合与渲染
node scripts/check-chat.js        # AI 链路 + 单行输入区 + 语音输入
```
