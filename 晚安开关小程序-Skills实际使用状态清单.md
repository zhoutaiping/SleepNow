# 晚安开关小程序 · Skills 实际使用状态清单

> 版本：v1.0 ｜ 盘点日期：2026-11-11 ｜ 整理维度：**实际使用状态**（非推荐优先级）
> 盘点对象：`sleepnow-mini/`（47 个工程文件 / 7 个页面 / 云端应用 `wbapp_xLztMn69PKIFQSbx41Rl1m`）
> 与主方案文档的关系：主方案**第九节**回答「应该用什么」，本清单回答「实际用了什么、还差什么」。

---

## 1. 一句话结论

**只有 `cloud-service` 一个 skill 被真正用透**；`mini-program-development` 只用来生成了初始模板、后续能力（真机预览 / 构建 npm / 发布提审）一步没走；UI、图标、封面、发布、测试类 skill 全部停留在"推荐名单"里。另有 **1 个提审红线（AI 内容安全）没有任何现成 skill 可覆盖**。

判断依据（硬证据）：`project.config.json` 至今仍是模板值 —— `appid: "touristappid"`、`projectname: "workbuddy-native-basic"`，说明工程**还没接入真实小程序 AppID，也没进过微信开发者工具**。

---

## 2. 状态定义

| 标记 | 状态 | 判定标准 |
|------|------|---------|
| ✅ | **已深度落地** | skill 的能力直接变成了工程代码或云端资源，有明确文件/表/策略可查 |
| 🟡 | **仅用于起步** | 用过一次生成基线，之后不再需要或尚未继续走 |
| 🔴 | **上线前必补** | 方案已列入，但工程里查无对应实现，且影响提审或观感 |
| ⚪ | **待验证 / 按需** | 阶段未到（真机验证期）或遇缺口才用，现在不用不算欠账 |
| ⛔ | **明确不需要** | 与本项目约束冲突或属其他工作流 |

---

## 3. 总览速查表

| Skill | 状态 | 工程内证据 / 反证 |
|-------|------|------------------|
| `cloud-service` | ✅ 已深度落地 | `utils/cloud.js`、`cloud-config.js`、`core/auth.js`、`utils/llm.js`、`db/schema.sql`、`.wbapp_*.privacy.json` |
| `mini-program-development` | 🟡 仅用于起步 | scaffold 生成基线（app.json / app.wxss / project.config.json）；但 `appid` 仍为 `touristappid` |
| `发布为应用`（sites） | 🔴 上线前必补 | 根目录 `.wbapp_*.genie` 是**云服务激活**生成的，不是发布预览卡；无 sites 部署痕迹 |
| `lucide-icons` | 🔴 上线前必补 | `app.json` 的 tabBar 五项**全为纯文字**，无 `iconPath`；全工程零图片资源 |
| `cloud-service` 存储子模块 | 🔴 上线前必补 | 无 `cloud.storage` / `storage.from` 调用；音频走外链 SoundHelix，未上云存储 |
| `ImageGen` / `nano-banana-pro` | 🔴 上线前必补（建议） | 零封面图资源，6 个音频均无封面 |
| `ui-ux-pro-max` | 🔴 建议补 | WXSS 为手写 CSS 变量体系（`--bg/--card/--primary`），有深色适配但未经专业视觉规范精修 |
| `agent-browser` | ⚪ 待验证 | 无巡检记录，真机阶段才用 |
| `playwright-cli` | ⚪ 按需 | 无回归测试脚本，MVP 阶段可后置 |
| `find-skills` / `search_and_install_skills` | ⚪ 按需 | 未用；**内容安全缺口正好可以用它找方案** |
| `weixinpay-pay` | ⛔ 不需要 | 个人主体开不了微信支付，已定「会员字段预留 + 桌面端变现」 |
| `workbuddy-pptx` / `docx` / `sheet 系列` | ⛔ 不需要 | 办公文档类，与开发主线无关（答辩 PPT 另起会话） |
| `wechat-article-search` / `xiaohongshu` | ⛔ 不需要 | 运营期工具，开发期不用 |
| `expert-manager` | ⛔ 不需要 | 无需自建专家包 |

---

## 4. 分档详解

### 4.1 ✅ 已深度落地：`cloud-service`

这是唯一被用透的 skill，覆盖了四个子模块：

| 子模块 | 落地证据 | 状态 |
|--------|---------|------|
| **数据库** | `sleep_logs` / `checkins` 两表已在云端建好，各 4 条 owner-only RLS 策略（`owner_id = auth.uid()`），`db/schema.sql` 版本化归档 | ✅ 已用 `list_tables` / `list_rls` 验证 |
| **Auth 认证** | `core/auth.js` 用了 `signInWithWechat` / `sendOtp` / `verifyOtp` / `getSession` / `signOut` / `onAuthStateChange` | ✅ 三合一登录 + 访客合并已落地 |
| **LLM（keyless）** | `utils/llm.js` 用 `cloud.llm.chat.completions.create`，强制 `stream:true` + 首条 `system` 消息；`pages/chat/` 四件套 | ✅ 流式聊天已落地 |
| **诊断** | `utils/workbuddy-cloud-diagnostics.js` 已拷贝进工程 | ⚪ 代码在，但真机没跑过 |
| **隐私清单** | `.wbapp_*.privacy.json` 内容为 `[]` | ⚠️ 待核对：工程实际用了 `wx.login`、手机号、本地存储、AI 对话，建议复核声明是否需补 |
| **文件存储** | **无** | 🔴 见 4.3 |

### 4.2 🟡 仅用于起步：`mini-program-development`

| 已走的 | 没走的 |
|--------|--------|
| `workbuddy_miniprogram_scaffold` 生成 `workbuddy-native-basic` 基线 | 替换真实 AppID（仍 `touristappid`） |
| 按其模板约定写了 `app.json` / `app.wxss` / `project.config.json` | 微信开发者工具「构建 npm」（`@tencent-ai/workbuddy-cloud-sdk` 仍在 `package.json` 里未安装） |
| 读了该 skill 的 `templates.md` / `native-project.md` / `skeletons.md` | 模拟器 / 真机调试、扫码预览 |
| — | 上传代码、提交审核、发布 |

> 这一档是最值得注意的：**主轨道 skill 停在了第一步**。所有"跑起来"的动作都还没发生，因此下面 🔴 的补项都集中在"让工程真正可执行 + 可过审"。

### 4.3 🔴 上线前必补（按优先级）

| # | 缺口 | 对应 Skill | 具体动作 | 不做的后果 |
|---|------|-----------|---------|-----------|
| 1 | **AI 内容安全** | ⚠️ **无现成 skill 覆盖** | 接微信 `msgSecCheck` 或云端 TMS 做**双向审核**（输入 + 输出）；`chat.js` 目前只有 `BLOCK_WORDS` 本地词表 + 一行注释 | **提审大概率被拒**（合规红线） |
| 2 | 构建 npm + 真机链路 | `mini-program-development` | 填真实 AppID → 构建 npm → 真机扫码，验证登录/记录/签到/聊天 round-trip | 云端 RLS 与访客合并逻辑无法验证 |
| 3 | 预览卡 | `发布为应用`（sites） | 创建小程序应用预览卡（复用 `applicationId`），供扫码；注意注册 ≠ 提审 | 无法交付给他人预览 |
| 4 | 音频上云 + 版权替换 | `cloud-service` 存储子模块 | 把 `utils/sounds-data.js` 的 SoundHelix 外链换成云存储 URL 或合规音频；外链还需配 `downloadFile` 合法域名 | 占位音频不可用于上线，且涉及版权 |
| 5 | tabBar 图标 | `lucide-icons` | 给 5 个 tab 补统一线性图标（月亮/声波/日历/对话/设置），写入 `iconPath` / `selectedIconPath` | 纯文字 tabBar 虽合法，但氛围感产品的观感明显偏弱 |
| 6 | 音频封面 | `ImageGen` / `nano-banana-pro` | 批量生成统一风格插画（雨夜/星空/篝火），规避图库版权 | 音频列表无视觉锚点，且需解决图片版权 |
| 7 | 视觉精修 | `ui-ux-pro-max` | 用专业规范复核睡前场景的情绪表达、深色对比度、触控热区 | 非阻断项，但直接影响留存 |

### 4.4 ⚪ 待验证 / 按需

- `agent-browser`：真机/提审期用来巡检云服务控制台与微信公众平台页面。
- `playwright-cli`：签到与睡眠记录的回归自动化，MVP 阶段可后置。
- `find-skills` / `search_and_install_skills`：**建议现在就用一次**，去搜有没有可覆盖「小程序 AI 内容安全审核」的现成 skill —— 这正好对应 4.3 的第 1 项红线。

### 4.5 ⛔ 明确不需要

`weixinpay-pay`（个人主体无支付资质）、`workbuddy-pptx` / `docx` / `sheet 系列`（办公文档）、`wechat-article-search` / `xiaohongshu`（运营期）、`expert-manager`（无需自建专家包）、`agent-mail` 及各类 IM / 记事 / 天气类 skill（与本项目无关）。

---

## 5. Skill 覆盖不到的功能缺口（重要）

这些是**主方案列了、工程里没有、且不是靠装 skill 能解决的**，需另行开发决策：

| 缺口 | 方案中的分级 | 工程现状 | 备注 |
|------|-------------|---------|------|
| AI 内容安全双向审核 | 上线红线 | 仅注释 + 本地词表 | 无 skill 覆盖，需自建云端审核能力 |
| 订阅消息（睡前提醒） | P1 | 无 `requestSubscribeMessage` | 需模板 ID + 用户授权 |
| 统计报表页 `stats` | P1 | 7 个页面中无 stats | 睡眠数据已在云端，可直接聚合 |
| 音频混合器 | P1 | 未做 | 需多实例音频管理 |
| 分享卡片 / 桌面端联动 | P2 | 未做 | — |
| 会员体系 `memberLevel` 字段 | 变现预留 | 云端两表均无该字段 | 个人主体下按方案走兑换码 + 桌面端变现 |

---

## 6. 按状态排的下一步行动清单

```
① 先补红线：find-skills 搜「小程序内容安全审核」→ 接 msgSecCheck / 云端 TMS
② 让工程可执行：填真实 AppID → 构建 npm → 真机扫码（mini-program-development 续走）
③ 真机通过后：cloud-service 存储上云 + 替换版权音频
④ 观感补齐：lucide-icons 出 tabBar 图标 → ImageGen 出封面 → ui-ux-pro-max 复核
⑤ 发布准备：发布为应用 创建预览卡 → 备案（12381 短信 24h 内核验）→ 提审
⑥ 回归与巡检：playwright-cli / agent-browser（可后置）
```

> 提醒：工信部备案 12381 短信核验 **24 小时内必须完成**，超时直接驳回；注册前仍需做小程序名称重名校验 + 商标网查第 9/42 类。

---

## 7. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-10-30 | 主方案第九节首次给出「推荐优先级」版 Skills 清单（必装/强推/按需/不需要） |
| 2026-11-11 | 独立出本清单，改按「实际使用状态」盘点，逐项对照 `sleepnow-mini/` 47 个文件与云端资源给出证据 |
