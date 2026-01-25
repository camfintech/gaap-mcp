# GaaP MCP - Cambodia Government-as-a-Platform

**Model Context Protocol Server for Cambodia's Digital Infrastructure**

Multi-tenant digital rail orchestration for identity, policy, payments, and compliance.

## Overview

The GaaP MCP extracts Cambodia's national digital infrastructure orchestration into a standalone, licensable platform layer that can be consumed by any Layer-7 application.

```
┌─────────────────────────────────────────────────────────────────┐
│                    LAYER 7 APPLICATIONS                          │
│  OmniDM.ai  │  CamSCM.com  │  TaxEase.kh  │  Future Apps        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
               ┌───────────▼───────────┐
               │      GaaP MCP         │
               │  (Platform Layer)     │
               │                       │
               │  L1: Identity         │  ← CamDigiKey
               │  L2: Policy           │  ← CamDX
               │  L3: Payments         │  ← Bakong/KHQR
               │  L4: Compliance       │  ← CamDL
               └───────────────────────┘
```

## Features

- **Multi-tenant isolation** with Row-Level Security
- **HMAC-SHA256 authentication** with nonce replay protection
- **Per-tenant rate limiting** with configurable windows
- **Credential encryption** (AES-256-GCM)
- **CamDL blockchain anchoring** for immutable audit trails
- **Standard request/response envelopes** for all tools

## Available Tools

| Tool | GaaP Layer | Purpose | Status |
|------|------------|---------|--------|
| `gaap_audit_log_event` | L4 | Log compliance event with CamDL anchoring | ✅ AWS DPI |
| `gaap_aml_screen` | L4 | AML/CFT screening (transaction, PEP, sanctions) | ✅ AWS DPI |
| `gaap_khqr_generate` | L3 | Generate KHQR via Bakong | ✅ AWS DPI |
| `gaap_khqr_verify_settlement` | L3 | Verify payment status | ✅ Implemented |
| `gaap_policy_evaluate` | L2 | CamDX policy decision | ✅ Implemented |
| `gaap_policy_publish_intent` | L2 | Publish payment intent to CamDX X-Road | ✅ Implemented |
| `gaap_identity_verify` | L1 | CamDigiKey verification | ✅ AWS DPI |

### AWS Mock DPI Endpoints

Tools with "AWS DPI" status call mock endpoints at `lg99tn8y8g.execute-api.ap-southeast-1.amazonaws.com` with automatic fallback to local logic on HTTP errors.

## Quick Start

### 1. Deploy to n8n

Import the workflow files from `workflows/` into your n8n instance.

### 2. Set Up Database

```bash
psql -U your_user -d your_db -f database/gaap_mcp_schema.sql
```

### 3. Configure Tenant

```sql
-- Create tenant credential
INSERT INTO gaap_mcp.credentials (
  tenant_id, credential_type, encrypted_value, scopes, gaap_layer
) VALUES (
  'your-tenant-uuid',
  'tenant_webhook_secret',
  'your-encrypted-secret',  -- Use AES-256-GCM
  ARRAY['gaap_audit_log_event', 'gaap_khqr_generate'],
  'MCP'
);
```

### 4. Invoke Tool

```bash
curl -X POST https://your-n8n/webhook/gaap-mcp/invoke \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: your-tenant-uuid" \
  -H "X-API-Key: your-api-key" \
  -H "X-Timestamp: $(date +%s)000" \
  -H "X-Nonce: $(uuidgen)" \
  -H "X-Signature: your-computed-signature" \
  -d '{
    "tool": "gaap_audit_log_event",
    "tenant_context": {
      "tenant_id": "your-tenant-uuid",
      "correlation_id": "CRR-2025-001"
    },
    "params": {
      "event_type": "order.created",
      "entity_type": "order",
      "entity_id": "ORD-2025-0001",
      "anchor_to_camdl": true
    }
  }'
```

## Authentication

All requests require these headers:

| Header | Description |
|--------|-------------|
| `X-Tenant-ID` | UUID of the tenant |
| `X-API-Key` | Tenant's API key |
| `X-Timestamp` | Unix timestamp (milliseconds) |
| `X-Nonce` | Unique per request |
| `X-Signature` | HMAC-SHA256 signature |

### Signature Computation

```javascript
const crypto = require('crypto');

const canonical = `${method}|${path}|${timestamp}|${nonce}|${sha256(body)}`;
const signature = crypto.createHmac('sha256', webhookSecret).update(canonical).digest('hex');
```

## Directory Structure

```
gaap-mcp/
├── mcp-server/                        # Claude Desktop MCP server
│   ├── src/
│   │   ├── index.ts                   # MCP server (7 tools)
│   │   ├── auth.ts                    # HMAC signature
│   │   └── client.ts                  # HTTP client
│   └── package.json
├── workflows/
│   ├── _router/
│   │   └── gaap_tool_gateway.json     # Main gateway (auth, dispatch)
│   ├── internal/
│   │   └── credential_resolver.json   # Secure credential resolution
│   └── tools/
│       ├── audit_log_event.json       # L4 compliance (AWS DPI)
│       ├── aml_screen.json            # L4 AML/CFT (AWS DPI)
│       ├── identity_verify.json       # L1 CamDigiKey (AWS DPI)
│       ├── khqr_generate.json         # L3 Bakong (AWS DPI)
│       ├── khqr_verify_settlement.json
│       ├── policy_evaluate.json
│       └── policy_publish_intent.json
├── database/
│   └── gaap_mcp_schema.sql            # Multi-tenant schema
├── docs/
│   ├── API_REFERENCE.md               # Full API documentation
│   └── GAAP_MCP_ARCHITECTURE.md       # Architecture plan
└── README.md
```

## Documentation

- [API Reference](docs/API_REFERENCE.md) - Complete API documentation with examples
- [Architecture Plan](https://github.com/camfintech/telegraph-workflows/blob/main/.config/claude/plans/virtual-zooming-falcon.md) - Extraction architecture

## License

Proprietary - CamFinTech Ltd.

## Related Projects

- [OmniDM.ai](https://github.com/camfintech/telegraph-workflows) - DM Commerce Platform (L7 consumer)
- [MyOwnIP.com](https://github.com/camfintech/myownip) - AI Automation Platform
