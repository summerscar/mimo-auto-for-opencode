/**
 * MiMo Auto Free Plugin for OpenCode
 * 原版：https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/plugin/mimo-free.ts
 */
import type { Plugin } from "@opencode-ai/plugin";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// ─── 常量 ───────────────────────────────────────────────────────────
const BASE_URL = "https://api.xiaomimimo.com";
const BOOTSTRAP_URL = `${BASE_URL}/api/free-ai/bootstrap`;
const CHAT_URL = `${BASE_URL}/api/free-ai/openai`;
const JWT_REFRESH_BUFFER_MS = 5 * 60_000;
const DIRNAME = path.dirname(fileURLToPath(import.meta.url));

// ─── 持久化 fingerprint ─────────────────────────────────────────────

let fingerprintCache: string | undefined;

function getClientFingerprint(): string {
  if (fingerprintCache) return fingerprintCache;

  const file = path.join(DIRNAME, "mimo-free-client");

  try {
    const existing = fs.readFileSync(file, "utf-8").trim();
    if (existing) {
      fingerprintCache = existing;
      return existing;
    }
  } catch {
    // file doesn't exist yet
  }

  const cpu = os.cpus()[0]?.model ?? "unknown-cpu";
  const username = (() => {
    try {
      return os.userInfo().username;
    } catch {
      return "unknown-user";
    }
  })();
  const seed = [
    os.hostname(),
    process.platform,
    process.arch,
    cpu,
    username,
  ].join("|");
  const fingerprint = crypto.createHash("sha256").update(seed).digest("hex");

  try {
    fs.writeFileSync(file, fingerprint, { mode: 0o600 });
  } catch (err) {
    console.warn("[mimo-free] could not persist fingerprint", err);
  }

  fingerprintCache = fingerprint;
  return fingerprint;
}

// ─── JWT 状态 ────────────────────────────────────────────────────────
let cachedJwt: string | null = null;
let cachedExp = 0;
let inflight: Promise<string> | null = null;

/** 从 JWT 的 payload 中解析 exp 过期时间（毫秒时间戳） */
function parseExp(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    return typeof payload.exp === "number"
      ? payload.exp * 1000
      : Date.now() + 50 * 60_000;
  } catch {
    return Date.now() + 50 * 60_000;
  }
}

async function bootstrap(): Promise<string> {
  const fingerprint = getClientFingerprint();
  const res = await fetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "mimocode/0.1.0",
    },
    body: JSON.stringify({ client: fingerprint }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `mimo-free bootstrap failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { jwt?: string };
  if (!data.jwt) throw new Error("mimo-free bootstrap response missing jwt");
  return data.jwt;
}

/**
 * 获取有效的 JWT，支持：
 * - 缓存命中：直接返回（距过期 > 5 分钟）
 * - 并发去重：多个调用者复用同一个 bootstrap 请求
 * - 过期刷新：自动重新 bootstrap
 */
async function getJwt(): Promise<string> {
  if (cachedJwt && cachedExp - Date.now() > JWT_REFRESH_BUFFER_MS) {
    return cachedJwt;
  }
  if (inflight) return inflight;
  cachedJwt = null;
  inflight = bootstrap();
  try {
    cachedJwt = await inflight;
    cachedExp = parseExp(cachedJwt);
    console.log(
      `[mimo-free] ${new Date().toLocaleTimeString()} JWT refreshed, expires in ${Math.round((cachedExp - Date.now()) / 60000)}min`,
    );
    return cachedJwt;
  } finally {
    inflight = null;
  }
}

function injectPrompt(init: any) {
  const bodyParsed = JSON.parse(init.body);
  // https://github.com/XiaomiMiMo/MiMo-Code/blob/42e7da3d51dba1129cd3abfa214e29f7385924a3/packages/opencode/src/session/prompt/default.txt
  // if without this prompt, request will be 403, Illegal access!
  const xiaomiDefaultPrompt = `You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.`;
  bodyParsed.messages[0].content =
    xiaomiDefaultPrompt + bodyParsed.messages[0].content;
  init.body = JSON.stringify(bodyParsed);
}

// ─── URL Rewrite ─────────────────────────────────────────────────────
function buildHeaders(init: any, jwt: string): Headers {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${jwt}`);
  headers.set("X-Mimo-Source", "mimocode-cli-free");
  headers.set(
    "User-Agent",
    "mimocode/0.1.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14",
  );
  return headers;
}

/**
 * 自定义 fetch：rewrite URL path + 注入 JWT + 401/403 重试
 *
 * MiMo free API 用 /chat 而非标准 OpenAI 路径 /chat/completions，
 * @ai-sdk/openai-compatible 会自动追加 /chat/completions，
 * 所以每次请求前把 /chat/completions 改回 /chat。
 */
const wrappedFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : (input as Request).url;
  const rewritten = url.replace(/\/chat\/completions(\?|$)/, "/chat$1");

  const jwt = await getJwt();
  const headers = buildHeaders(init, jwt);
  injectPrompt(init);
  const response = await fetch(rewritten, { ...init, headers });

  if (response.status !== 401 && response.status !== 403) return response;

  // 401/403：刷新 JWT 后重试
  cachedJwt = null;
  cachedExp = 0;
  const newJwt = await getJwt();
  const retryHeaders = buildHeaders(init, newJwt);
  return fetch(rewritten, { ...init, headers: retryHeaders });
};

// ─── 插件入口 ────────────────────────────────────────────────────────

export const MimoFreePlugin: Plugin = async (input, options) => {
  await getJwt();

  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      cfg.provider.mimo ??= {
        name: "MiMo Auto (free)",
        api: CHAT_URL,
        npm: "@ai-sdk/openai-compatible",
        options: {
          apiKey: "anonymous",
          fetch: wrappedFetch,
        },
        models: {
          "mimo-auto": {
            name: "MiMo Auto",
            attachment: true,
            reasoning: true,
            tool_call: true,
            temperature: true,
            modalities: { input: ["text", "image"], output: ["text"] },
            limit: { context: 1_000_000, output: 128_000 },
            cost: { input: 0, output: 0 },
          },
        },
      };
    },
  };
};
