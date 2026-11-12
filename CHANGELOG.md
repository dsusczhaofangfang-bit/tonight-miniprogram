# 更新日志

本项目的所有重要变更都记录在此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。版本号来源为 `config/index.js` 的 `version` 字段。

## [Unreleased]

### Added

- `LICENSE`（Apache-2.0）、`NOTICE`、`THIRD-PARTY-NOTICES.md`（内嵌字体的 OFL 1.1 声明）
- `.github/`：Issue 与 PR 模板、CI 工作流（push / PR 自动跑 4 个自检脚本）
- `docs/README.md` 文档索引、`docs/13-测试指引.md`（从 README 拆出的逐页测试步骤与回归清单）
- `screenshots/` 目录与截图规范
- `CONTRIBUTING.md`、`.editorconfig`、`.gitattributes`

### Changed

- `README.md` 重构为 GitHub 项目主页：徽章、功能一览、快速开始、演示账号、已知限制、Roadmap、授权与免责声明
- 文档配图统一移入 `docs/assets/`（原 `docs/refs/` 目录取消）
- `.gitignore` 补充系统与临时文件规则

## [0.2.0] - 2026-11-02

### Added

- 老板管理端：经营概览、订单管理（全部 + 四状态筛选）、订单详情（接单 / 完成 / 取消 / 异常）、商品管理（筛选、搜索、上下架、新增与编辑）
- 调酒师工作台：独立口令 `1234`、三状态看板、桌号搜索、先到先做 / 最新在前、5 秒轮询提醒（提示条 + 角标 + 可开关提示音）、异常提交
- 页面守卫：`utils/admin-guard.js`、`utils/bartender-guard.js`，两个角色会话互相隔离
- 自检脚本：`scripts/verify_stage6.js`（46 项）、`scripts/verify_stage7.js`（56 项）

### Changed

- 品牌由「柠舍唔同」更名为 **Tonight**（代码与 README；`docs/` 内旧文档保留原名作为历史记录）
- 商品管理价格按「元」输入，经 `utils/format.yuanToFen()` 解析后以「分」存储

## [0.1.0] - 2026-11-02

### Added

- M0 项目骨架：目录结构、主题 token、Mock 数据层、services、开发自检页、初始化文档
- 欢迎页：纯文字排版，八公明朝 43 字子集 base64 内嵌，0.10–1.10s 淡入时序，可跳过
- 首页：品牌区、扫码桌号、四分类入口、今晚推荐、当季推荐
- 酒单与商品详情：竖排分类栏、名称搜索、CSS 酒标占位块、数量步进、加购、下架态
- 购物车：勾选 / 全选、数量增减、移除、清空、已选合计
- 订单流程：订单确认（桌号校验、备注、总额）、我的订单（四状态筛选）、订单详情（状态时间线、取消、模拟推进）
- 4 态订单状态机：待接单 → 制作中 → 已完成，旁支为已取消
- 自检脚本：`scripts/verify_stage3.js`（41 项）、`scripts/verify_stage5.js`（53 项）

### Fixed

- 欢迎页备用字体按八公明朝窄字面对齐，修正「柠」「进」偏宽