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

## 6. 交付前检查

- [ ] 全工程 `*.wxss` 无 `#RRGGBB` / `rgb()` / `gradient` 硬编码（仅 `app.wxss` 例外）
- [ ] 每个 `var(--primary)` 背景都有对应 `--on-primary` 文字
- [ ] 8 个页面根 view 均绑定 `{{themeClass}}`，js 均 `bind/unbind`
- [ ] 浅色与深色分别检查文字对比度、边框可见性、tabBar 选中态
- [ ] `node scripts/check-theme.js` 全绿（静态一致性 + 三态切换逻辑共 21 项）
