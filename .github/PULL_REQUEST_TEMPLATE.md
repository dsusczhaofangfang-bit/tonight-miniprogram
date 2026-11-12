## 这个 PR 做了什么

<!-- 一到三句话，说清改动内容 -->

## 为什么改

<!-- 关联 Issue：Fixes #123；或说明动机 -->

## 如何验证

- [ ] 跑过自检脚本，全部通过：

  ```bash
  node scripts/verify_stage3.js && node scripts/verify_stage5.js \
    && node scripts/verify_stage6.js && node scripts/verify_stage7.js
  ```

- [ ] 改了页面：已在开发者工具模拟器逐页走查，并附前后截图
- [ ] 改了 `utils/mock-data/` 或 `config/index.js`：已递增 `seedVersion`（桌号表用 `tableSeedVersion`）
- [ ] 改了金额、状态机或权限：已同步对应的 `verify_stage*.js` 断言
- [ ] 只改文档：已检查相对链接可跳转

## 影响范围

- [ ] 顾客端
- [ ] 老板管理端
- [ ] 调酒师工作台
- [ ] services / utils
- [ ] 工程配置、CI、文档

## 备注

<!-- 已知限制、后续 TODO、需要 reviewer 重点关注的地方 -->