/**
 * User-friendly error message mapping.
 * Matches keywords in raw error strings to show helpful messages.
 */

const ERROR_PATTERNS: Array<{ pattern: RegExp; zh: string; en: string }> = [
  { pattern: /no api key/i, zh: "未配置 API Key，请在设置中配置", en: "API key not configured, check Settings" },
  { pattern: /api.key.*not.*config/i, zh: "未配置 API Key，请在设置中配置", en: "API key not configured, check Settings" },
  { pattern: /model.*not.*found/i, zh: "AI 模型不可用，请检查设置", en: "AI model not available, check Settings" },
  { pattern: /model.*not.*available/i, zh: "AI 模型不可用，请检查设置", en: "AI model not available, check Settings" },
  { pattern: /connect.*timeout/i, zh: "AI 服务连接超时，请稍后重试", en: "AI service timeout, please retry" },
  { pattern: /origin.*timed.*out/i, zh: "AI 服务连接超时，请稍后重试", en: "AI service timeout, please retry" },
  { pattern: /ECONNREFUSED/i, zh: "AI 服务连接超时，请稍后重试", en: "AI service timeout, please retry" },
  { pattern: /rate.limit/i, zh: "请求频率过高，请稍后重试", en: "Rate limited, please wait and retry" },
  { pattern: /too many requests/i, zh: "请求频率过高，请稍后重试", en: "Rate limited, please wait and retry" },
  { pattern: /unauthorized|401/i, zh: "认证失败，请检查 API Key 或登录状态", en: "Auth failed, check API key or login" },
  { pattern: /quota|insufficient.*funds/i, zh: "额度不足，请检查账户余额", en: "Quota exceeded, check account balance" },
  { pattern: /ENETUNREACH|ENOTFOUND/i, zh: "网络连接失败，请检查网络", en: "Network error, check connection" },
  { pattern: /fetch failed/i, zh: "网络连接失败，请检查网络", en: "Network error, check connection" },
  { pattern: /repo.*not.*found/i, zh: "仓库路径不存在", en: "Repository path not found" },
  { pattern: /non-fast-forward/i, zh: "推送失败，请先拉取远程更新", en: "Push failed, pull remote changes first" },
  { pattern: /gh.*not.*installed/i, zh: "未安装 GitHub CLI (gh)", en: "GitHub CLI (gh) not installed" },
  { pattern: /not.*authenticated/i, zh: "未登录，请先认证", en: "Not authenticated, please login first" },
  { pattern: /maxRetriesExceeded/i, zh: "AI 服务多次重试失败，请稍后再试", en: "AI service failed after retries, try later" },
  { pattern: /Failed after.*attempts/i, zh: "AI 服务多次重试失败，请稍后再试", en: "AI service failed after retries, try later" },
  { pattern: /Unexpected token/i, zh: "AI 返回了无法解析的结果，请重试", en: "AI returned unparseable result, retry" },
  { pattern: /timeout/i, zh: "操作超时，请重试", en: "Operation timed out, please retry" },
];

export function getErrorMessage(rawError: string, isZh: boolean): string {
  for (const { pattern, zh, en } of ERROR_PATTERNS) {
    if (pattern.test(rawError)) {
      return isZh ? zh : en;
    }
  }
  // Fallback: clean up raw message
  const cleaned = rawError
    .replace(/^Error:\s*/i, "")
    .split("\n")[0]
    .slice(0, 120);
  return cleaned || (isZh ? "操作失败，请重试" : "Operation failed, please retry");
}
