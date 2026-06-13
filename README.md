# MiMo Auto Free Model Plugin for OpenCode

复刻 [MiMoCode MimoFreeAuthPlugin](https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/plugin/mimo-free.ts)，为 OpenCode 提供免费 MiMo Auto 通道。

> **免责声明**：本项目仅供学习和研究目的。使用者需自行承担使用风险，并遵守相关服务条款。请勿滥用免费资源。

## 安装

文件放置在 `~/.config/opencode/plugins/mimo-free.ts`，OpenCode 启动时自动加载。

## 工作原理

与 MiMoCode 原版一致：启动时 bootstrap 获取 JWT，`config` hook 注册 provider 并注入 `wrappedFetch` 处理认证和 URL rewrite，JWT 过期自动刷新。

### 关键处理

- **默认 Prompt 注入**：在请求 body 的第一个 message 前自动添加 MiMo 默认系统提示词（`You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.`），否则服务端会返回 403 Illegal access!

## 使用

```bash
opencode
# 选择 mimo/mimo-auto 模型
```
