/** Safe user-facing explanations; never render provider error text. */
export function searchReason(reason: unknown): string {
 const messages: Record<string,string> = {
 CONFIG_MISSING:'尚未配置检索模型，请在 House 的检索设置中配置 Embedding 服务。',
 KEY_MISSING:'检索模型密钥缺失，请在 House 保存检索服务密钥。',
 INDEX_NOT_READY:'语义索引尚未就绪，请稍后重新检索。',
 INDEX_TOO_LARGE:'文献内容超出语义索引预算。',
 CONFIG_CHANGED:'检索配置已变化，请重新检索。',
 INDEX_SOURCE_CHANGED:'原文已变化，请重新检索以更新索引。',
 NETWORK_ERROR:'检索服务连接失败，请检查网络和 House 中的检索设置。',
 AUTH_FAILED:'检索服务认证失败，请检查 House 中的检索密钥。',
 RATE_LIMITED:'检索服务暂时限流，请稍后重试。',
 FILTER_UNAVAILABLE:'结果筛选暂不可用。',
 EMBEDDING_FAILED:'Embedding 请求失败，请检查检索服务后重试。'
 }
 const code = typeof reason === 'string' && /^[A-Z_]{1,80}$/.test(reason) ? reason : 'RETRIEVAL_UNAVAILABLE'
 return (messages[code] ?? `检索服务暂不可用（${code}）。`) + ' 已保留关键词匹配结果。'
}
