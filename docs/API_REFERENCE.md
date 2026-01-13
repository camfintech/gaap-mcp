# GaaP MCP API Reference

Cambodia Government-as-a-Platform Model Context Protocol Server

## Overview

The GaaP MCP provides standardized access to Cambodia's digital infrastructure layers:

| Layer | Services | Tools |
|-------|----------|-------|
| **L1** | Identity (CamDigiKey) | `gaap_identity_verify`, `gaap_identity_check_level`, `gaap_identity_generate_qr` |
| **L2** | Policy (CamDX) | `gaap_policy_evaluate`, `gaap_policy_publish_intent` |
| **L3** | Payments (Bakong/KHQR) | `gaap_khqr_generate`, `gaap_khqr_verify_settlement`, `gaap_khqr_poll_status` |
| **L4** | Compliance (CamDL) | `gaap_audit_log_event`, `gaap_audit_anchor_batch`, `gaap_audit_verify`, `gaap_audit_generate_proof` |

## Base URL

```
POST https://automation.gaap.gov.kh/webhook/gaap-mcp/invoke
```

Or for development:
```
POST https://automation.omnidm.ai/webhook/gaap-mcp/invoke
```

---

## Authentication

All requests require the following headers:

| Header | Description | Example |
|--------|-------------|---------|
| `X-Tenant-ID` | UUID of the tenant | `550e8400-e29b-41d4-a716-446655440000` |
| `X-API-Key` | Tenant's API key | `sk_live_abc123...` |
| `X-Timestamp` | Unix timestamp in milliseconds | `1704067200000` |
| `X-Nonce` | Unique random string per request | `n_7f3d9a2b1c` |
| `X-Signature` | HMAC-SHA256 signature | `a1b2c3d4e5...` |

### Signature Computation

```javascript
const crypto = require('crypto');

// Canonical string format:
// METHOD|PATH|TIMESTAMP|NONCE|SHA256(body)
const method = 'POST';
const path = '/webhook/gaap-mcp/invoke';
const timestamp = Date.now().toString();
const nonce = crypto.randomBytes(16).toString('hex');
const bodyHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

const canonicalString = `${method}|${path}|${timestamp}|${nonce}|${bodyHash}`;

const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(canonicalString)
  .digest('hex');
```

### Security Requirements

- **Timestamp freshness**: Must be within 5 minutes of server time
- **Nonce uniqueness**: Each nonce can only be used once (prevents replay attacks)
- **Signature verification**: HMAC-SHA256 with timing-safe comparison

---

## Request Format

```typescript
interface GaaPMCPRequest {
  // Tool to invoke (required)
  tool: string;

  // Tenant context (required)
  tenant_context: {
    tenant_id: string;        // UUID
    merchant_id?: string;     // Merchant identifier
    correlation_id?: string;  // Links related requests
  };

  // Tool-specific parameters (required, may be empty object)
  params: Record<string, unknown>;

  // Request metadata (optional)
  meta?: {
    request_id?: string;        // For tracing
    source_workflow?: string;   // Calling workflow
    source_platform?: string;   // e.g., 'telegram', 'whatsapp'
    idempotency_key?: string;   // For safe retries
  };
}
```

---

## Response Format

### Success Response

```typescript
{
  success: true,
  result: {
    data: Record<string, unknown>,  // Tool-specific output
    correlation_id: string,
    audit_event_id?: string         // If event was logged
  },
  meta: {
    request_id: string,
    execution_ms: number,
    gaap_layer: 'L1' | 'L2' | 'L3' | 'L4' | 'MCP',
    camdl_anchored: boolean
  }
}
```

### Error Response

```typescript
{
  success: false,
  error: {
    code: string,                   // e.g., 'L3_KHQR_GENERATION_FAILED'
    message: string,
    recoverable: boolean,
    suggested_action?: string
  },
  meta: {
    request_id: string,
    execution_ms: number,
    gaap_layer: 'L1' | 'L2' | 'L3' | 'L4' | 'MCP',
    camdl_anchored: false
  }
}
```

---

## Available Tools

### L4 Compliance Tools

#### `gaap_audit_log_event`

Log compliance events with optional CamDL blockchain anchoring. Supports both single event and batch mode for bulk anchoring.

**Single Event Mode Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `event_type` | string | Yes* | Event type (e.g., `order.created`, `payment.captured`) |
| `entity_type` | string | Yes* | Entity type (e.g., `order`, `payment`, `customer`) |
| `entity_id` | string | Yes* | Entity identifier (e.g., `ORD-2025-001`) |
| `previous_state` | object | No | State before the change |
| `new_state` | object | No | State after the change |
| `metadata` | object | No | Additional context |
| `anchor_to_camdl` | boolean | No | Request immediate blockchain anchoring |

*Required when `batch_mode` is false or not provided.

**Batch Mode Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `batch_mode` | boolean | Yes | Set to `true` for batch anchoring |
| `batch_id` | string | Yes | Unique batch identifier (e.g., `BATCH-1234567890`) |
| `event_count` | number | No | Number of events (for validation) |
| `events` | array | Yes | Array of event objects to anchor |
| `anchor_to_camdl` | boolean | No | Anchor batch to blockchain |

**Event Object Schema (for batch mode):**

| Name | Type | Description |
|------|------|-------------|
| `event_id` | string | Unique event identifier |
| `event_type` | string | Event type |
| `correlation_id` | string | Correlation ID |
| `event_data` | object | Event data payload |
| `event_hash` | string | SHA-256 hash of event data |
| `event_timestamp` | string | ISO timestamp of event |

**Single Event Example:**

```json
{
  "tool": "gaap_audit_log_event",
  "tenant_context": {
    "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
    "merchant_id": "numpang-express-001",
    "correlation_id": "CRR-2025-abc123"
  },
  "params": {
    "event_type": "order.created",
    "entity_type": "order",
    "entity_id": "ORD-2025-0001",
    "new_state": {
      "status": "pending",
      "total_amount": 45.00,
      "currency": "USD"
    },
    "metadata": {
      "customer_id": "CUST-001",
      "channel": "telegram"
    },
    "anchor_to_camdl": true
  },
  "meta": {
    "request_id": "REQ-2025-001",
    "source_workflow": "G12.02"
  }
}
```

**Batch Mode Example:**

```json
{
  "tool": "gaap_audit_log_event",
  "tenant_context": {
    "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
    "correlation_id": "BATCH-1704067200000"
  },
  "params": {
    "batch_mode": true,
    "batch_id": "BATCH-1704067200000",
    "event_count": 3,
    "events": [
      {
        "event_id": "EVT-001",
        "event_type": "order.created",
        "correlation_id": "CRR-001",
        "event_data": { "order_id": "ORD-001", "amount": 25.00 },
        "event_hash": "a1b2c3d4...",
        "event_timestamp": "2025-01-11T10:00:00Z"
      },
      {
        "event_id": "EVT-002",
        "event_type": "payment.completed",
        "correlation_id": "CRR-001",
        "event_data": { "order_id": "ORD-001", "txn_id": "TXN-001" },
        "event_hash": "e5f6a7b8...",
        "event_timestamp": "2025-01-11T10:05:00Z"
      },
      {
        "event_id": "EVT-003",
        "event_type": "order.delivered",
        "correlation_id": "CRR-001",
        "event_data": { "order_id": "ORD-001" },
        "event_hash": "c9d0e1f2...",
        "event_timestamp": "2025-01-11T10:30:00Z"
      }
    ],
    "anchor_to_camdl": true
  },
  "meta": {
    "request_id": "BATCH-REQ-001",
    "source_workflow": "G12.09",
    "idempotency_key": "audit-BATCH-1704067200000"
  }
}
```

**Single Event Response:**

```json
{
  "success": true,
  "result": {
    "data": {
      "audit_event_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "event_hash": "a1b2c3d4e5f6...",
      "camdl_anchor_id": "CAMDL-1704067200-abc123",
      "camdl_block_number": 1704067200,
      "camdl_tx_hash": "0x1234..."
    },
    "correlation_id": "CRR-2025-abc123",
    "audit_event_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  },
  "meta": {
    "request_id": "REQ-2025-001",
    "execution_ms": 127,
    "gaap_layer": "L4",
    "camdl_anchored": true
  }
}
```

**Batch Mode Response:**

```json
{
  "success": true,
  "result": {
    "data": {
      "batch_id": "BATCH-1704067200000",
      "events_anchored": 3,
      "merkle_root": "9a8b7c6d5e4f...",
      "event_proofs": {
        "EVT-001": { "merkle_proof": [...], "leaf_index": 0 },
        "EVT-002": { "merkle_proof": [...], "leaf_index": 1 },
        "EVT-003": { "merkle_proof": [...], "leaf_index": 2 }
      },
      "camdl_anchor_id": "CAMDL-BATCH-1704067200000",
      "camdl_block_number": 1704067200,
      "camdl_tx_hash": "0x5678..."
    },
    "correlation_id": "BATCH-1704067200000"
  },
  "meta": {
    "request_id": "BATCH-REQ-001",
    "execution_ms": 892,
    "gaap_layer": "L4",
    "camdl_anchored": true
  }
}
```

---

### L3 Payment Tools (Coming Soon)

#### `gaap_khqr_generate`

Generate a KHQR payment code via Bakong API.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `amount` | number | Yes | Payment amount |
| `currency` | string | Yes | `USD` or `KHR` |
| `merchant_id` | string | Yes | Bakong merchant ID |
| `order_reference` | string | Yes | Order reference |
| `ttl_seconds` | number | No | QR code validity (default: 900) |

#### `gaap_khqr_verify_settlement`

Verify payment settlement status.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `md5_hash` | string | Yes | KHQR MD5 hash |
| `intent_id` | string | Yes | Payment intent ID |

---

### L2 Policy Tools (Coming Soon)

#### `gaap_policy_evaluate`

Evaluate CamDX policy for a transaction.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `amount` | number | Yes | Transaction amount |
| `currency` | string | Yes | Currency code |
| `identity_level` | string | Yes | Customer identity level |
| `merchant_id` | string | Yes | Merchant identifier |

---

### L1 Identity Tools (Coming Soon)

#### `gaap_identity_verify`

Initiate CamDigiKey verification flow.

---

## Error Codes

### MCP Layer Errors

| Code | Description | Recoverable |
|------|-------------|-------------|
| `MCP_INVALID_REQUEST` | Request validation failed | No |
| `MCP_MISSING_AUTH_HEADERS` | Required auth headers missing | No |
| `MCP_TENANT_MISMATCH` | Tenant ID mismatch | No |
| `MCP_SIGNATURE_INVALID` | Signature verification failed | No |
| `MCP_TIMESTAMP_EXPIRED` | Timestamp outside window | Yes |
| `MCP_NONCE_REUSED` | Nonce already used | Yes |
| `MCP_RATE_LIMIT_EXCEEDED` | Rate limit exceeded | Yes |
| `MCP_TENANT_NOT_FOUND` | Tenant not configured | No |
| `MCP_TOOL_NOT_AUTHORIZED` | Tool not in tenant scopes | No |
| `MCP_TOOL_NOT_IMPLEMENTED` | Tool not yet available | No |

### L1 Identity Errors

| Code | Description | Recoverable |
|------|-------------|-------------|
| `L1_CAMDIGIKEY_UNAVAILABLE` | Service unavailable | Yes |
| `L1_IDENTITY_LEVEL_INSUFFICIENT` | KYC level too low | No |
| `L1_VERIFICATION_EXPIRED` | Verification expired | Yes |

### L2 Policy Errors

| Code | Description | Recoverable |
|------|-------------|-------------|
| `L2_CAMDX_POLICY_BLOCKED` | Transaction blocked | No |
| `L2_CAMDX_TIMEOUT` | CamDX timeout | Yes |

### L3 Payment Errors

| Code | Description | Recoverable |
|------|-------------|-------------|
| `L3_KHQR_GENERATION_FAILED` | KHQR generation failed | Yes |
| `L3_BAKONG_UNAVAILABLE` | Bakong unavailable | Yes |
| `L3_SETTLEMENT_TIMEOUT` | Settlement timeout | Yes |
| `L3_AMOUNT_EXCEEDS_LIMIT` | Amount over limit | No |

### L4 Compliance Errors

| Code | Description | Recoverable |
|------|-------------|-------------|
| `L4_CAMDL_ANCHOR_FAILED` | Blockchain anchor failed | Yes |
| `L4_AUDIT_HASH_COLLISION` | Hash collision | No |
| `L4_AUDIT_MISSING_PARAMS` | Missing required params | No |

---

## Rate Limits

| Tier | Requests/min | Burst |
|------|--------------|-------|
| Shared | 1,000 | 100 |
| Dedicated | 10,000 | 500 |
| Enterprise | Unlimited | N/A |

Rate limit headers in response:
- `X-RateLimit-Limit`: Max requests per window
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Window reset timestamp

---

## Idempotency

For safe retries, include an `idempotency_key` in the request metadata:

```json
{
  "meta": {
    "idempotency_key": "order-create-ORD-2025-0001"
  }
}
```

- Keys are scoped per tenant
- Duplicate requests within 24 hours return cached response
- Use unique, meaningful keys (e.g., `{operation}-{entity_id}`)

---

## Webhook Callbacks (Optional)

For long-running operations, you can provide a callback URL:

```json
{
  "meta": {
    "callback_url": "https://your-app.com/webhooks/gaap-callback",
    "callback_secret": "your-hmac-secret"
  }
}
```

Callback requests are signed with `X-Signature` header using your callback secret.

---

## SDK Examples

### Node.js

```javascript
const crypto = require('crypto');
const axios = require('axios');

class GaaPMCPClient {
  constructor(tenantId, apiKey, webhookSecret, baseUrl) {
    this.tenantId = tenantId;
    this.apiKey = apiKey;
    this.webhookSecret = webhookSecret;
    this.baseUrl = baseUrl || 'https://automation.gaap.gov.kh';
  }

  async invoke(tool, params, options = {}) {
    const body = {
      tool,
      tenant_context: {
        tenant_id: this.tenantId,
        merchant_id: options.merchantId,
        correlation_id: options.correlationId
      },
      params,
      meta: {
        request_id: options.requestId || `REQ-${Date.now()}`,
        source_workflow: options.sourceWorkflow,
        idempotency_key: options.idempotencyKey
      }
    };

    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const bodyStr = JSON.stringify(body);
    const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
    const canonical = `POST|/webhook/gaap-mcp/invoke|${timestamp}|${nonce}|${bodyHash}`;
    const signature = crypto.createHmac('sha256', this.webhookSecret).update(canonical).digest('hex');

    const response = await axios.post(
      `${this.baseUrl}/webhook/gaap-mcp/invoke`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': this.tenantId,
          'X-API-Key': this.apiKey,
          'X-Timestamp': timestamp,
          'X-Nonce': nonce,
          'X-Signature': signature
        }
      }
    );

    return response.data;
  }

  async auditLogEvent(eventType, entityType, entityId, options = {}) {
    return this.invoke('gaap_audit_log_event', {
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      state_change: options.stateChange,
      previous_hash: options.previousHash,
      metadata: options.metadata,
      anchor_to_camdl: options.anchorToCamdl
    }, options);
  }
}

// Usage
const client = new GaaPMCPClient(
  'tenant-uuid',
  'api-key',
  'webhook-secret'
);

const result = await client.auditLogEvent(
  'order.created',
  'order',
  'ORD-2025-0001',
  {
    stateChange: { previous: null, new: { status: 'pending' } },
    anchorToCamdl: true
  }
);
```

---

## Changelog

### v1.1.0 (2025-01-13)
- **`gaap_audit_log_event` batch mode support**
  - Added `batch_mode`, `batch_id`, `event_count`, `events[]` parameters
  - Supports bulk anchoring of up to 100 events per batch
  - Returns merkle root and individual event proofs
  - Used by G12.09 Audit Trail Anchoring workflow
- Dynamic validation: single mode requires `event_type/entity_type/entity_id`, batch mode requires `events[]`

### v1.0.0 (2025-01-11)
- Initial release
- `gaap_audit_log_event` tool implemented (single event mode)
- `gaap_khqr_generate` tool implemented
- `gaap_khqr_verify_settlement` tool implemented
- `gaap_policy_evaluate` tool implemented
- `gaap_policy_publish_intent` tool implemented
- HMAC signature authentication
- Nonce-based replay protection
- Rate limiting
- CamDL anchoring (stub)

### Planned
- L1 Identity tools (`gaap_identity_*`)
