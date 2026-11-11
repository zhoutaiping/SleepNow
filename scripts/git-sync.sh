#!/bin/bash
# SleepNow / 晚安开关 仓库自动同步脚本
#
# 用法：
#   ./scripts/git-sync.sh                      # 用带时间戳的默认提交信息
#   ./scripts/git-sync.sh "修复签到连续天数"    # 自定义提交信息
#
# 流程：检查变更/未推送提交 → 提交（遵循 .gitignore）→ 拉取变基 → 推送 origin/main
# 说明：
#   1. 必须先 commit 再 pull --rebase，否则 rebase 会因工作树不干净而失败。
#   2. 所有变量一律用 ${} 包裹 —— bash 会把紧跟 $VAR 的非 ASCII 字符（如中文括号）
#      误判为变量名的一部分，在 set -u 下直接报 unbound variable。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ 不是 git 仓库：${REPO_ROOT}"
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [ -z "${BRANCH}" ]; then
  echo "❌ 当前处于 detached HEAD，请先切回 main：git checkout main"
  exit 1
fi

HAS_CHANGES="no"
if [ -n "$(git status --porcelain)" ]; then HAS_CHANGES="yes"; fi
AHEAD="$(git rev-list --count "origin/${BRANCH}..${BRANCH}" 2>/dev/null || echo 0)"

if [ "${HAS_CHANGES}" = "no" ] && [ "${AHEAD}" -eq 0 ]; then
  echo "✅ 没有变更，无需提交"
  exit 0
fi

if [ "${HAS_CHANGES}" = "yes" ]; then
  MSG="${1:-chore: 自动同步 $(date '+%Y-%m-%d %H:%M:%S')}"
  echo "▶ 暂存变更（遵循 .gitignore）..."
  git add -A
  echo "▶ 提交：${MSG}"
  git commit -q -m "${MSG}"
  LOCAL_COMMIT="$(git rev-parse --short HEAD)"
  echo "   本地提交 ${LOCAL_COMMIT} 已创建"
else
  echo "▶ 无新增改动，但有 ${AHEAD} 个本地提交待推送"
fi

echo "▶ 拉取远程最新并变基（origin/${BRANCH}）..."
if ! git pull --rebase -q origin "${BRANCH}"; then
  echo "❌ 变基失败（多为冲突或网络问题），本地提交已保留。"
  echo "   解决冲突后执行： git rebase --continue && git push origin ${BRANCH}"
  echo "   或放弃本次变基： git rebase --abort"
  exit 1
fi

echo "▶ 推送到 origin/${BRANCH} ..."
if ! git push -q origin "${BRANCH}"; then
  echo "❌ 推送失败，请检查网络或 SSH 认证：ssh -T git@github.com"
  exit 1
fi

echo "✅ 同步完成：$(git rev-parse --short HEAD) → origin/${BRANCH}"
