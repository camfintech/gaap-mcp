import crypto from 'crypto';

export interface AuthConfig {
  tenantId: string;
  apiKey: string;
  webhookSecret: string;
}

/**
 * Generate authentication headers for GaaP MCP API requests.
 * Uses HMAC-SHA256 signature with nonce for replay protection.
 */
export function generateAuthHeaders(
  config: AuthConfig,
  body: string
): Record<string, string> {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomUUID();
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');

  // Canonical string format: METHOD|PATH|TIMESTAMP|NONCE|BODY_HASH
  const canonical = `POST|/webhook/gaap-mcp/invoke|${timestamp}|${nonce}|${bodyHash}`;

  const signature = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(canonical)
    .digest('hex');

  return {
    'Content-Type': 'application/json',
    'X-Tenant-ID': config.tenantId,
    'X-API-Key': config.apiKey,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature,
  };
}
