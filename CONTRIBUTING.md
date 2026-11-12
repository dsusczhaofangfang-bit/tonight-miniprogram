# 贡献指南

感谢你的关注。这是一个**单人维护的演示项目**，代码结构完整但业务范围被刻意收窄（见 [已知限制](README.md#已知限制)）。欢迎 Issue，也欢迎 PR，但请先确认改动方向与下面的约定一致，避免白做。

## 1. 报告问题

提 Issue 前请先搜索是否已有相同问题。提交时请附上：

- 微信开发者工具版本、基础库版本、操作系统
- 真机型号（如果只在手机上复现）
- 复现步骤（从哪个页面进入、点了什么）
- 期望结果 / 实际结果，必要时附截图

模板：[Bug 报告](.github/ISSUE_TEMPLATE/bug_report.yml)、[功能建议](.github/ISSUE_TEMPLATE/feature_request.yml)。

## 2. 本地开发

```bash
git clone https://github.com/<your-name>/tonight-miniprogram.git
# 用微信开发者工具「导入项目」选择仓库根目录，AppID 用你自己的或测试号
```

- 无需 `npm install`，项目零第三方依赖。
- 无需云开发环境，`config/index.js` 中 `useMock: true` 时全部走本地 Mock。
- 改动完成后至少跑一遍自检：

```bash
node scripts/verify_stage3.js && node scripts/verify_stage5.js \
  && node scripts/verify_stage6.js && node scripts/verify_stage7.js
```

四条命令合计 196 项断言，必须全部通过（CI 也跑同一组）。

## 3. 代码约定

完整约束见 [docs/06-AI交接说明.md](docs/06-AI交接说明.md) 第 4 节，最关键的几条：

1. **技术栈固定**微信原生（JS / WXML / WXSS），不引入 Taro / uni-app / 第三方 UI 库。
2. **金额一律以「分」存储与计算**，展示时转元；用户输入的价格（元）必须走 `utils/format.yuanToFen()`。
3. **订单金额只由 `services/orders.createOrder` 按商品表核算**，页面传来的金额一律不采信；历史订单是下单时快照。
4. **订单状态只能走 `updateOrderStatus` / `cancelOrder`**，页面不得直接改 storage；状态恒为 4 个，不要新增「待取餐」。
5. **桌号只能来自扫码参数或本地存储**，不做手动选桌；缺失时订单确认页必须拦截。
6. **改 `utils/mock-data/` 的种子数据后必须递增 `seedVersion`**（桌号表用 `tableSeedVersion`）。
7. **管理端 / 调酒师端入口不是权限**，真正的拦截在 `utils/admin-guard.js`、`utils/bartender-guard.js`。
8. **视觉克制**：全站仅欢迎页有动效；不加 Logo / 印章 / 水印；欢迎页版式已冻结，改动前请先开 Issue 讨论。
9. `styles/font-hakkou.wxss` 由 `scripts/build_font.py` 生成，**不要手改**。

## 4. 提交信息

沿用仓库现有风格：`Conventional Commits` 前缀 + 中文描述，一行说清「做了什么」。

| 前缀 | 用途 | 示例 |
| --- | --- | --- |
| `feat` | 新功能 | `feat: 新增调酒师工作台与模拟实时订单提醒` |
| `fix` | 修 bug | `fix: 备用字体按八公明朝窄字面对齐` |
| `docs` | 只改文档 | `docs: 补充第七阶段交付说明` |
| `style` | 只改样式 / 格式 | `style: 欢迎页字号整体放大 15%` |
| `refactor` | 不改变行为的重构 | `refactor: 抽出金额解析工具` |
| `chore` | 构建、配置、杂项 | `chore: 引入 CI 与开源协议文件` |
| `test` | 只改测试脚本 | `test: 补充取消订单的金额快照断言` |

## 5. 提交 PR

1. Fork 并从 `main` 切出分支，命名如 `feat/order-remark`、`fix/cart-badge`。
2. 一个 PR 只做一件事，避免混入无关格式化。
3. 在 PR 描述里写清：改了什么、为什么改、如何验证（贴自检输出更好）。
4. 确认 CI 绿灯；若改了页面，附前后截图。
5. 不要提交：`project.private.config.json`、`.tools/`、`.pylib/`、`HakkouMincho-v1.004/`（均已在 `.gitignore` 中）。

## 6. 授权

向本仓库提交代码即表示你同意以 [Apache License 2.0](LICENSE) 授权你的贡献；字体与素材仍遵循 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 中的原始授权（OFL 1.1）。