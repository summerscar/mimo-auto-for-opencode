# MiMo Auto Free Model Plugin for OpenCode — Handoff

## 背景

研究 MiMoCode 如何实现不用 API Key 匿名使用 MiMo Auto 模型，并将其移植到 OpenCode。

## MiMoCode 匿名认证流程

1. **设备指纹** → SHA256(hostname + platform + arch + cpu + username)，持久化到磁盘
2. **Bootstrap** → POST `https://api.xiaomimimo.com/api/free-ai/bootstrap`，body: `{ client: fingerprint }`，返回 JWT
3. **Chat API** → POST `https://api.xiaomimimo.com/api/free-ai/openai/chat`，Header: `Authorization: Bearer <jwt>`
4. **JWT 有效期**：1 小时，过期前 5 分钟自动刷新
5. **限流方式**：按设备指纹

源码：[mimo-free.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/plugin/mimo-free.ts)

## 实现

直接沿用原版实现，无需额外配置 `opencode.json`。`config` hook 动态注册 provider 并注入 `wrappedFetch`。

## 安装

```bash
# 文件已放置在插件目录，启动时自动加载
opencode
# 选择 mimo/mimo-auto 模型
```
