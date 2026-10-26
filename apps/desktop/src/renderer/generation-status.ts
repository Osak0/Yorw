/** Short recovery guidance shared by chat and Wiki drafts. */
export function generationError(code: string): string {
  const messages: Record<string, string> = {
    OUTPUT_TRUNCATED: '内容尚未生成完整，已有内容已保留，可以编辑补全。',
    CONTENT_FILTERED: '服务未能返回完整内容。已有内容已保留，请调整生成要求。',
    UPSTREAM_RESOURCE_UNAVAILABLE: '模型服务暂时繁忙，已有内容已保留，请稍后重试。',
    UPSTREAM_ABORTED: '模型服务中断了生成，已有内容已保留，请稍后重试。',
    UNSUPPORTED_TOOL_CALL: '模型返回了当前不支持的操作，请在 House 检查模型配置。',
    STREAM_INTERRUPTED: '连接中断，已有内容已保留，可以编辑或稍后重试。',
    TIMEOUT: '生成等待超时，已有内容已保留，可以编辑或稍后重试。',
    EMPTY_RESPONSE: '模型没有返回新内容，请调整生成要求后重试。',
    INVALID_RESPONSE: '模型服务返回格式异常，已有内容已保留。',
    RESPONSE_TOO_LARGE: '生成内容过长，已有内容已保留，可以编辑精简。',
    NETWORK_ERROR: '无法连接模型服务，请检查网络后重试。',
    INSUFFICIENT_BALANCE: '模型账号余额不足，请检查服务账户。',
    UPSTREAM_HTTP_ERROR: '模型服务请求未完成，请稍后重试。',
    AUTH_FAILED: '模型服务鉴权失败，请检查 House 中的配置。',
    RATE_LIMITED: '模型服务暂时限流，请稍后重试。',
    CONFIG_CHANGED: '模型配置已变化，请重新发送问题。',
    INDEX_SOURCE_CHANGED: '原文内容已变化，请重新发送问题。',
    INVALID_CITATION: '模型引用了未提供的来源，已有内容保留供核查。',
    CANCELLED: '生成已取消，已有内容已保留。',
    INTERRUPTED: '上次生成被中断，已有内容已保留。',
  }
  return messages[code] ?? '生成未完成，已有内容已保留，请稍后重试。'
}
