# 晚安开关 · 设计系统 MASTER

> 版本 v1.0 ｜ 2026-11-11 ｜ 适用范围：`sleepnow-mini/` 全部页面
> 依据：`ui-ux-pro-max`（设计系统生成）、官方 `frontend-design`（反 AI 俗套）、
> `ux-ui-agent-skills` 的 **One theme, two modes, no per-page palette** 原则。

## 1. 设计立场

**Refined Monochrome（克制的黑白灰）**。助眠产品的界面不该抢注意力：
- 无彩色、无渐变、无彩色阴影
- 层次只由**灰阶 + 1rpx 边框 + 字重/字号**构成
- 唯一的强调手段是反相：浅色用纯黑填充，深色用纯白填充

明确禁止（AI 界面俗套）：紫色/蓝色渐变、彩色评分星、彩色错误提示、
emoji 当图标、每页单独调色、硬编码色值。

## 2. 语义 Token（唯一色值来源）

所有色值**只**在 `app.wxss` 的 `.theme-light` / `.theme-dark` 中定义。业务样式一律 `var(--token)`。

| Token | Light · 纸白 | Dark · 墨黑 | 用途 |
|-------|-------------|------------|------|
| `--bg` | `#f4f4f4` | `#0b0b0b` | 页面底色 |
| `--card` | `#ffffff` | `#191919` | 卡片 / 输入框 |
| `--surface` | `#eaeaea` | `#262626` | 次级填充 / chip / 提示条 |
| `--text` | `#111111` | `#f2f2f2` | 主文字 / 数值 |
| `--text-sub` | `#5c5c5c` | `#a6a6a6` | 次要文字 |
| `--text-2` | 同 `--text-sub` | 同 `--text-sub` | 历史别名（chat 页） |
| `--text-3` | `#767676` | `#8c8c8c` | placeholder / 未选中态 |
| `--border` | `#d9d9d9` | `#333333` | 1rpx 分隔线 |
| `--divider` | `#e4e4e4` | `#2a2a2a` | 卡内细分隔 |
| `--primary` | `#111111` | `#f2f2f2` | 强调填充（反相） |
| `--on-primary` | `#ffffff` | `#0b0b0b` | 强调填充上的文字 |
| `--primary-soft` | `#e8e8e8` | `#2b2b2b` | 弱强调背景 |
| `--scrim` | `rgba(0,0,0,.45)` | `rgba(0,0,0,.68)` | 弹层遮罩 |

**成对规则**：任何 `background: var(--primary)` 必须配 `color: var(--on-primary)`。
深色模式下 `--primary` 变成白色，继续写 `color:#fff` 会造成白底白字。

### 尺度 Token（与主题无关，定义在 `page` 上）

`--radius-sm: 12rpx` ｜ `--radius-md: 20rpx` ｜ `--radius-lg: 32rpx` ｜ `--radius-pill: 999rpx`

## 3. 对比度（WCAG 2.2 AA 基线）

| 组合 | Light | Dark |
|------|-------|------|
| `--text` / `--bg` | ≈ 17.4:1 | ≈ 17.5:1 |
| `--text-sub` / `--card` | ≈ 6.4:1 | ≈ 7.2:1 |
| `--on-primary` / `--primary` | ≈ 18.9:1 | ≈ 17.5:1 |
| `--text-3` / `--card`（仅 placeholder） | ≈ 4.5:1 | ≈ 5.4:1 |

正文与主要控件均 ≥ 4.5:1；`--text-3` 只用于 placeholder 与未选中态，不承载关键信息。

## 4. 主题切换机制

| 层 | 实现 |
|----|------|
| 状态 | `core/theme.js`：`auto / light / dark`，持久化到 `wx.setStorageSync('wb_theme')` |
| 页面 | 根 view 绑定 `class="page {{themeClass}}"`，`themeClass` 由 `theme.bind(this)` 注入 |
| 联动 | `setTheme()` / 系统 `onThemeChange` 时遍历已订阅页面 `setData` 即时刷新 |
| 原生控件 | `wx.setNavigationBarColor` / `wx.setBackgroundColor` / `wx.setTabBarStyle` 同步同色阶 |
| 系统跟随 | `app.json` 开 `darkmode:true`，`App.onThemeChange` → `theme.onSystemThemeChange()`，仅 auto 生效 |

> 历史 bug：旧实现只靠 `@media (prefers-color-scheme: dark)` 改色，手动切换仅影响导航栏，
> 页面主体颜色不变。现已改为显式 mode class，两种触发路径统一。

## 5. 排版与交互

- 标题 700 字重 + 负字距；正文 `line-height: 1.6~1.7`；数字用 `tabular-nums`
- 触控目标 ≥ 44px；点击反馈用颜色/边框变化，不用位移（避免布局抖动）
- 动效 150~300ms；`prefers-reduced-motion` 下关闭唱片旋转与柱状图过渡
- 空/错/加载三态齐全；错误仅用灰阶 + 左侧强调条表达，不用红色

## 6. 布局范式（v1.1 · 健身 App Dashboard）

参照 Keep / Apple 健身等产品的信息架构，解决 1.0 版本的三个布局问题：
**信息密度过低**（下半屏全空）、**每卡一个大黑按钮**（视觉重复且抢焦点）、
**没有数据主视觉**（用户看不到自己的睡眠节律）。

### 三页信息架构

| 页面 | 从上到下的层级 | 唯一强焦点 |
|------|---------------|-----------|
| 首页 | 日期 + 问候 → 睡眠环形 Hero → 2×2 指标网格 → 近 7 天打卡条 → 横向助眠卡 → 最近活动列表 | 反相 Hero 卡 |
| 记录 | 标题独占一行 + 小 pill → 周日历条 → 三列概览 → 快捷操作行 → 全部记录活动列表 | 周日历条 |
| 我的 | 反相身份 Hero → 三列成就数据 → 外观分组 → 更多列表 → 页脚 | 身份 Hero |

**规则**：每页最多一个反相大卡；按钮只保留 pill / 列表行 / 卡内 CTA 三种形态，
不再出现「每张卡一个整宽大黑按钮」。空态也必须保留周条与概览，页面不得整片留白。

### 通用组件（`app.wxss` 统一定义）

`.hero-panel` / `.hero-btn`、`.section`、`.metric-grid`+`.metric`、
`.week-strip`+`.week-col`+`.week-dot`、`.overview-panel`+`.ov-item`、
`.row`+`.row-arrow`、`.activity`+`.dots`、`.empty-panel`、`.pill`。
各页面 wxss 只写自身特有布局，不允许重复定义通用组件。

### 环形进度

24 段小条用 `transform: rotate() translateY()` 绕中心排布，
激活段 `--on-primary`、未激活段 `--on-primary-dim`（新增 token，仅定义在两个 mode 块）。
纯 view 实现，不用 canvas / 渐变，兼容 WebView 与 Skyline。

### 数据层

`utils/dashboard.js` 为纯函数（无 wx / 云端依赖），统一提供日期序列、周条构造、
同日取均值的聚合、活动列表格式化。三页共用，统计口径与 `stats` 页一致。
日期一律用 `new Date(y, m-1, d)` 本地构造，避免 `YYYY-MM-DD` 被按 UTC 解析错开一天。

## 7. 交付前检查

- [ ] 全工程 `*.wxss` 无 `#RRGGBB` / `rgb()` / `gradient` 硬编码（仅 `app.wxss` 例外）
- [ ] 每个 `var(--primary)` 背景都有对应 `--on-primary` 文字
- [ ] 8 个页面根 view 均绑定 `{{themeClass}}`，js 均 `bind/unbind`
- [ ] 浅色与深色分别检查文字对比度、边框可见性、tabBar 选中态
- [ ] `node scripts/check-theme.js` 全绿（静态一致性 + 三态切换逻辑）
- [ ] `node scripts/check-dashboard.js` 全绿（聚合纯函数 + 三页渲染分支，共 28 项）
- [ ] `node scripts/check-chat.js` 全绿（Prompt / 会话 / 审核 / 页面分支，共 40 项）
- [ ] 新增 `{{t.xxx}}` 均已由页面 `TEXT_KEYS` 注入，且 zh/en 词条对齐
- [ ] AI 生成内容的显式标识、免责声明、用户协议入口齐全（见第 8 节）

## 8. 陪伴页范式与 AI 标识（v1.2）

### 8.1 为什么不能用「一个空输入框」

睡前场景用户认知负荷低，「说点什么」是最大障碍；且自由输入 + 自由生成的合规风险面最大。
陪伴页因此采用**场景化入口 + 预设优先**：

```
标题 + AI 徽标 → 模型行（标签/值/箭头）→ 欢迎语 → 2×2 场景卡
→ 快捷提问 chips → 完整免责 →（会话中）场景切换条 → 输入区
```

**规则**：
- 每个场景卡带编号、名称、描述、箭头，点击后用**预设首句**自动开启一轮，不让用户面对空输入框
- 页面不出现「含义不明的灰色横条」与「无文字的纯色圆按钮」；所有按钮必须有可读文案
- 空态也必须填满首屏，不得整片留白（与第 6 节一致）
- 会话中随时可切换场景，切换时按场景重载历史，上下文不串

### 8.2 i18n 注入约定（曾导致整页空白）

词条 key 一律为 `'chat.title'` 这类带点格式。`i18n.all()` 返回的是**原样字典**，
不能直接在 wxml 里写 `{{t.chatTitle}}`。所有页面统一：

```js
const TEXT_KEYS = { subtitle: 'chat.subtitle', /* 驼峰别名 → 词条 key */ };
function buildTexts() {
  const t = {};
  Object.keys(TEXT_KEYS).forEach((k) => { t[k] = i18n.t(TEXT_KEYS[k]); });
  return t;
}
```

`scripts/check-chat.js` 会静态校验 wxml 中每个 `{{t.xxx}}` 都由 `TEXT_KEYS` 注入且中英词条存在，防止复发。

### 8.3 AI 生成内容标识（合规，不可删）

依据《人工智能生成合成内容标识办法》（2025-09-01 施行）第 4/8 条，
以下元素属于**合规结构**而非装饰，改动需同步复核提审材料：

| 位置 | 元素 | 类型 |
|------|------|------|
| 顶部标题旁 | `AI` 徽标 | 交互界面显著提示 |
| 空态 eyebrow | 「内容由 AI 生成」 | 生成合成内容提示 |
| 每条助手消息 | `AI` 小徽标 + 角色名 | 内容周边提示 |
| 输入区底部 | 「AI 生成 · 非医疗建议」 | 常驻提示 |
| 空态底部 | 完整免责声明 | 用户告知 |

**禁止**：把 AI 回复伪装成人工客服/真人、省略「非医疗建议」、用彩色或 emoji 弱化合规提示。
标识使用 `--text-sub` / `--text-3` 灰阶 + 1rpx 边框，保持克制但可读（≥ 4.5:1）。

> 主体/类目/算法备案、云端内容安全、日志留存等工程之外的合规项，见
> 《晚安开关小程序-AI接入实操方案.md》。个人主体下 AI 对话**不可直接提审**。

## 9. 输入栏规范（v1.3 · 严格单行 + 语音输入）

陪伴页输入区此前是 `textarea + auto-height`，会随文字长高，把底部操作区撑成两三行，
挤压消息可视区。现固定为**一条水平输入栏**：

```
[ 88rpx 圆形麦克风 ] [ flex:1 单行 input ] [ 112rpx 文字发送 ]
        ↑ gap 12rpx，三者同高 88rpx，align-items: center
```

| 规则 | 说明 |
|------|------|
| 单行 | 只用 `<input>`；**禁止 `textarea` / `auto-height` / 弹性 min-height**；长文本在框内横向滚动 |
| 键盘 | `confirm-type="send"` + `bindconfirm`；`cursor-spacing` 防遮挡；`focus` 由页面控制，`bindblur` 复位 |
| 按钮 | 发送 / 停止始终带**可读文字**，不做无字纯色圆按钮（沿用 8.1） |
| 状态行 | 额度行右侧在录音时变为「脉冲点 + 正在聆听/正在转成文字 + 秒数 + 取消」，不新增第二行输入控件 |
| 录音态 | 麦克风圆钮反相（`--primary` + `--on-primary`），CSS 麦克风图形同步反相；禁用 emoji / 图片图标 |
| 动效 | 脉冲用 `opacity`，遵守 `prefers-reduced-motion`；无彩色、无渐变 |
| 语义 | 语音只把声音变成输入框里的文字，**绝不自动发送**；发送前照常走输入侧内容安全 |

`scripts/check-chat.js` 已加静态断言：不得再出现 `<textarea>` / `auto-height`，
三元素必须同为 88rpx，且 `confirm-type="send"` 与 `focus` 绑定存在。
语音能力的主体差异与三条接入路径见《晚安开关小程序-AI接入实操方案.md》第 10 节。

## 10. 质量基线与渲染引擎决策（v1.4 · 18 项 bug 修复）

### 10.1 维持 WebView，暂不启用 Skyline（B17 结论）

官方《Skyline WXSS 样式支持与差异》明确 **Inline / Inline-Block 布局不支持**（仅 text 组件内嵌结构可用），
CSS 变量要到 Android 8.0.35 / iOS 8.0.38 才支持，且 Skyline 下所有节点默认 `position: relative`。
本工程恰好重度依赖这些特性：

| 现有实现 | Skyline 下的风险 |
|----------|------------------|
| 首页 `.sound-card` 用 `display:inline-block` + `white-space:nowrap` 横排 | 横排卡片塌成竖排，助眠推荐区错乱 |
| 深浅主题全靠 `.theme-light/.theme-dark` 上的 CSS 变量 | 低版本客户端变量失效，整页配色崩坏 |
| Hero 24 段环形用 `position:absolute` + `transform` | 定位基准变化，环形错位 |
| `scroll-view scroll-x`、30 天柱状图 | 需按 Skyline 滚动/长列表约束重写 |

**决策：本轮不写 `renderer: "skyline"`，8 页保持 WebView。** 在真机验证前全量开启属于「用确定性回归换不确定的性能收益」。
开启前必须逐项通过：① 把横向卡片改成 `flex` + `scroll-view` 横向布局；② 真机核对 CSS 变量与主题三处一致性；
③ Hero 环形、柱状图、录音态输入栏逐页比对；④ 基础库/客户端版本下限与降级策略；⑤ 后台音频与 tabBar 图标不受影响。
按页灰度，禁止一次性全开。

### 10.2 三条工程红线

1. **后台音频**：只能用 `wx.getBackgroundAudioManager()`（全局单例，绑定事件一次），
   必须写 `title / singer / coverImgUrl`；定时关闭用 `timerEndAt` 绝对时间 + `onTimeUpdate` 兜底，
   禁止只靠 `setTimeout`（切后台会被挂起）。`scripts/check-pages.js` 有静态防复发断言。
2. **主题**：`darkmode: true` 时必须配 `themeLocation` + `theme.json`，原生控件色值全部 `@变量`；
   JS 侧三个 `wx.*` API 各自独立 `try`；选中态图标按「实际生效 mode」用 `setTabBarItem` 覆盖
   （`theme.json` 只跟随系统主题，不跟随用户手动选择）。
3. **数据**：访客数据只有全部成功写入云端后才删本地副本，靠云端日期查重实现幂等重试；
   `sleep_logs` 必须有 `UNIQUE (owner_id, sleep_date)`，前端保存/签到加连点锁。

### 10.3 无障碍与错误态基线

- 全局最小字号 **22rpx**（20rpx 在 2x 屏仅 10px）；`scripts/check-pages.js` 会拦截更小的字号。
- 反相 Hero 卡上的次级文字用 `--on-primary-dim`（浅色 7.6:1 / 深色 6.2:1，均达 WCAG AA）；
  环形未点亮段是图形，单独用 `--on-primary-track`，不与文字共用对比度约束。
- 所有页面请求都要有可见失败反馈：首页 / 我的页用 `.notice` 轻提示条 + 点按重试，
  记录页 / 统计页用整块 error 态；静默降级为旧数据视为缺陷。

### 10.4 回归脚本矩阵

| 脚本 | 覆盖 |
|------|------|
| `scripts/check-theme.js` | i18n 对齐、token、darkmode 变量链路、三态切换、原生 API 独立 try |
| `scripts/check-dashboard.js` | 日期 / 环形 / 聚合纯函数与三页 render |
| `scripts/check-chat.js` | AI 流式链路、内容安全、语音状态机、严格单行输入 |
| `scripts/check-pages.js` | **新增**：8 页事件绑定 / 文案注入 / 国际化 / 字号 / 音频与 schema 防复发 |
| `scripts/check-regressions.js` | **新增**：锁屏音频、访客合并、登录异常、非法时长、连点、网络错误态 |
