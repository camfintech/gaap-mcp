# GaaP MCP Extraction Architecture Plan

## Summary

Extract Cambodia GaaP orchestration capabilities (primarily G02, G04, G05, G07, G09) from OmniDM into a standalone MCP server, enabling OmniDM to become a Layer-7 consumer rather than a platform owner.

---

## 1. Validation: Separation of Concerns

**Verdict: Architecturally Sound**

The separation is valid because:

| Current State | Problem | Proposed State |
|---------------|---------|----------------|
| GaaP workflows (G02, G04, G05, G07, G09) embedded in OmniDM | GaaP logic duplicated if new L7 app launches | GaaP MCP shared by all L7 apps |
| OmniDM owns Bakong/CamDX credentials | Credential sprawl, audit complexity | Centralized credential management |
| Compliance logic scattered | NBC audit requires tracing across products | Single audit point in MCP |
| Tight coupling to Telegram | Hard to add WhatsApp/TikTok GaaP flows | Channel-agnostic GaaP services |

**GaaP Layer Model (Cambodia)**:
- L0: Legal Foundation → Stays external (NBC regulations)
- L1: Identity (CamDigiKey) → **Extract to MCP**
- L2: Interoperability (CamDX) → **Extract to MCP**
- L3: Payments (Bakong/KHQR) → **Extract to MCP**
- L4: Compliance (CamDL) → **Extract to MCP**
- L5-L6: Economic/Sectoral → Application-specific, stays in L7 apps
- L7: Applications → OmniDM, future apps consume MCP

---

## 2. MCP Tool Boundaries

### Tools TO EXTRACT (Platform Capabilities)

```
Identity Tools (from G02):
├── gaap_identity_verify        - CamDigiKey verification flow
├── gaap_identity_check_level   - Query current identity level
└── gaap_identity_generate_qr   - Generate verification QR/deeplink

Policy Tools (from G02/G04):
├── gaap_policy_evaluate        - CamDX policy decision (amount band routing)
└── gaap_policy_publish_intent  - Register payment intent with CamDX

Payment Tools (from G05/G07):
├── gaap_khqr_generate          - Generate KHQR via Bakong API
├── gaap_khqr_verify_settlement - Check payment status
└── gaap_khqr_poll_status       - Polling support for workflows

Compliance Tools (from G09):
├── gaap_audit_log_event        - Log event with CamDL anchoring
├── gaap_audit_anchor_batch     - Batch anchor to blockchain
├── gaap_audit_verify           - Verify event against blockchain
└── gaap_audit_generate_proof   - Generate compliance evidence package
```

### Tools TO KEEP in OmniDM (Application-Specific)

```
Channel Ingress (G01)      - Platform-specific webhook parsing
Intent Building (G03)      - Order creation business logic
Telegram Delivery (G06)    - Channel-specific formatting
Fulfillment (G08)          - Grab/logistics integration
Conversation State         - Flow management, negotiation
Product Catalogs           - Tenant-specific data
```

---

## 3. API Contract Design

### Request Envelope
```typescript
{
  tool: "gaap_khqr_generate",
  tenant_context: {
    tenant_id: "uuid",
    merchant_id: "MER-2025-001",
    correlation_id: "CRR-2025-abc123"
  },
  params: { amount, currency, order_reference, ttl_seconds },
  meta: { request_id, source_workflow, idempotency_key }
}
```

### Response Envelope
```typescript
{
  success: boolean,
  result?: { data, correlation_id, audit_event_id },
  error?: { code, message, recoverable, suggested_action },
  meta: { request_id, execution_ms, gaap_layer, camdl_anchored }
}
```

### Authentication Model
- HTTP headers: `X-Tenant-ID`, `X-API-Key`, `X-Request-Signature`
- Request signature: HMAC-SHA256(body, webhook_secret)
- Credentials resolved per-request from encrypted store
- Credentials NEVER returned in responses

---

## 4. Tenant Isolation Model

### Database Segregation
```
gaap_mcp schema (NEW):
├── credentials         - AES-256-GCM encrypted, scoped by tool
├── tool_invocations    - Audit log of all MCP calls
└── rate_limits         - Per-tenant throttling

All tables use:
├── Row-Level Security (RLS) with tenant_id
├── SET app.current_tenant_id before queries
└── Explicit WHERE tenant_id = X (no cross-tenant access)
```

### Execution Isolation Tiers
| Tier | Model | Use Case |
|------|-------|----------|
| Shared | Single n8n instance, DB RLS | SME tenants, <1K req/min |
| Dedicated Workers | Horizontal n8n workers, queue-based | Enterprise, high throughput |
| Dedicated Instance | Isolated n8n + database | Banks, regulated entities |

---

## 5. OmniDM Consumption Pattern

### Workflow Mapping
| OmniDM Workflow | GaaP MCP Tool | Trigger |
|-----------------|---------------|---------|
| G12.01-MT | `gaap_policy_evaluate` | Before order creation |
| G12.05 | `gaap_policy_publish_intent` | Order confirmed |
| G12.06 | `gaap_khqr_generate` | Payment needed |
| G12.07 | `gaap_khqr_verify_settlement` | Poll for payment |
| G12.09 | `gaap_audit_log_event` | All state changes |

### Error Handling Pattern
```javascript
1. Call MCP tool
2. If success → return result
3. If recoverable error → retry with exponential backoff (3x)
4. If exhausted/non-recoverable → queue for manual review
5. Return graceful degradation to customer
```

---

## 6. Benefits and Risks

### Benefits
| Benefit | Impact |
|---------|--------|
| Licensable platform | Revenue from other L7 apps |
| Reduced duplication | Single GaaP implementation for all products |
| Compliance centralization | One audit point for NBC/MEF |
| Faster time-to-market | New apps get GaaP in hours |
| Independent scaling | MCP scales separately from apps |
| Clear ownership | GaaP team owns rails, product teams own apps |

### Risks and Mitigations
| Risk | Mitigation |
|------|------------|
| Breaking OmniDM during migration | Shadow mode first, feature flags, gradual rollout |
| Latency overhead | Same-network deployment, connection pooling |
| Credential exposure | mTLS, never log credentials |
| Single point of failure | HA deployment, multi-node n8n |

---

## 7. Migration Plan

### Phase 1: Parallel Operation (Weeks 1-4)
- Create `platforms/gaap-mcp/` directory structure
- Implement MCP server skeleton
- Mirror G05, G07, G09 logic into MCP tools
- Shadow-invoke MCP on every call (compare outputs, no production impact)

### Phase 2: Gradual Migration (Weeks 5-8)
Migration order by risk:
1. `gaap_audit_log_event` - Lowest risk, fire-and-forget
2. `gaap_policy_evaluate` - Read-only check
3. `gaap_khqr_generate` - Customer-facing
4. `gaap_khqr_verify_settlement` - Payment critical
5. `gaap_identity_*` - Most complex (defer)

### Phase 3: Full Separation (Weeks 9-12)
- Archive original G01-G09 (keep for audit)
- Remove fallback paths
- Document GaaP MCP for external consumers
- Onboard first non-OmniDM customer

---

## 8. Directory Structure

```
telegraph-workflows/
├── platforms/                          # NEW
│   └── gaap-mcp/
│       ├── workflows/
│       │   ├── tools/                  # MCP tool workflows
│       │   │   ├── identity_verify.json
│       │   │   ├── policy_evaluate.json
│       │   │   ├── khqr_generate.json
│       │   │   ├── khqr_verify_settlement.json
│       │   │   └── audit_log_event.json
│       │   └── internal/
│       │       └── credential_resolver.json
│       ├── database/
│       │   └── gaap_mcp_schema.sql
│       ├── docs/
│       │   └── API_REFERENCE.md
│       └── tests/
├── products/omnidm/                    # EXISTING (becomes MCP consumer)
└── workflows/g01-g09/                  # ARCHIVE after Phase 3
```

---

## 9. Critical Files

| File | Action |
|------|--------|
| `products/omnidm/database/multi_tenant_schema.sql` | Extend for MCP credentials |
| `shared/database/compliance_schema.sql` | Add tenant_id, MCP event types |
| `workflows/g05-khqr-generation/G05.KHQR.Generator.v1.json` | Extract to MCP |
| `workflows/g09-audit/G09.Audit.CamDL.v1.json` | Extract to MCP |
| `products/omnidm/workflows/g12-order-management/G12_01_MT*.json` | Add MCP client calls |

---

## 10. Verification Plan

1. **Unit Tests**: Each MCP tool validates inputs, returns correct structure
2. **Integration Tests**: OmniDM → MCP → Bakong/CamDL mock chain
3. **Shadow Mode Validation**: Compare MCP vs direct workflow outputs for 1 week
4. **Load Testing**: Verify tenant isolation under concurrent multi-tenant load
5. **Compliance Audit**: Verify CamDL anchoring works end-to-end
6. **Rollback Test**: Verify fallback to direct workflows works

---

## Decisions Confirmed

- **Credential Migration**: Migrate existing credentials from `tenants.credentials` to `gaap_mcp.credentials` (seamless for tenants)
- **MCP Hosting**: Same n8n instance (automation.omnidm.ai) - deployed and operational
- **First Tool Extracted**: `gaap_audit_log_event` - deployed and tested successfully

---

## 11. Claude Desktop MCP Integration Plan

### Overview

Create a Node.js MCP server that wraps the GaaP MCP HTTP API, enabling Claude Desktop to invoke GaaP tools directly via stdio transport.

### Architecture

```
┌─────────────────────┐     stdio      ┌─────────────────────┐
│   Claude Desktop    │◄──────────────►│  gaap-mcp-server    │
│                     │                │  (Node.js)          │
└─────────────────────┘                └──────────┬──────────┘
                                                  │ HTTPS + HMAC
                                                  ▼
                                       ┌─────────────────────┐
                                       │  GaaP MCP Gateway   │
                                       │  automation.omnidm  │
                                       │  .ai/webhook/       │
                                       │  gaap-mcp/invoke    │
                                       └─────────────────────┘
```

### Directory Structure

```
platforms/gaap-mcp/
├── mcp-server/                    # NEW - Claude Desktop MCP server
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts               # Entry point, MCP server setup
│   │   ├── auth.ts                # HMAC signature generation
│   │   ├── client.ts              # HTTP client for GaaP API
│   │   └── tools/
│   │       ├── index.ts           # Tool definitions export
│   │       └── audit_log_event.ts # gaap_audit_log_event handler
│   └── dist/                      # Compiled output
├── workflows/                     # Existing n8n workflows
├── database/                      # Existing schema
└── docs/
```

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gaap-mcp": {
      "command": "node",
      "args": [
        "/Users/myownip/workspace/telegraph-workflows/platforms/gaap-mcp/mcp-server/dist/index.js"
      ],
      "env": {
        "GAAP_TENANT_ID": "your-tenant-uuid",
        "GAAP_API_KEY": "your-api-key",
        "GAAP_WEBHOOK_SECRET": "your-webhook-secret"
      }
    }
  }
}
```

### Testing Plan

1. **Build the server**:
   ```bash
   cd platforms/gaap-mcp/mcp-server
   npm install && npm run build
   ```

2. **Test standalone**:
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
     GAAP_TENANT_ID=test GAAP_API_KEY=key GAAP_WEBHOOK_SECRET=secret \
     node dist/index.js
   ```

3. **Test with Claude Desktop**:
   - Restart Claude Desktop after config update
   - Ask Claude: "Log an audit event for order ORD-TEST-001 being created"
   - Verify response includes audit_event_id

4. **Verify in database**:
   ```sql
   SELECT * FROM gaap_mcp.audit_events
   ORDER BY recorded_at DESC LIMIT 5;
   ```

### Security Considerations

- Webhook secret stored in environment variable, never committed
- HMAC signature prevents request tampering
- Nonce prevents replay attacks
- Timestamp validation (5-minute window) on server side
- Tenant isolation via RLS in database

---

## 12. Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| n8n Gateway Workflow | ✅ Deployed | ID: 3vLXOy0apy1WWYiy |
| Audit Log Tool Workflow | ✅ Deployed | ID: yEHuyUc77ReheE6F |
| KHQR Generate Workflow | ✅ Deployed | ID: aW3qmBkEQNvQNqQ3 |
| Policy Evaluate Workflow | ✅ Deployed | ID: PaKMq5XXHMqPu3XC |
| Identity Verify Workflow | ✅ Deployed | ID: 2INT2fn8LAQHacYB |
| AML Screen Workflow | ✅ Deployed | ID: us6RXQCbb2ooufhI |
| Database Schema | ✅ Applied | 6 tables with RLS |
| HTTP Endpoint | ✅ Live | automation.omnidm.ai/webhook/gaap-mcp/invoke |
| Claude Desktop MCP Server | ✅ Tested | mcp-server/ - 7 tools available |
| GitHub Repository | ✅ Pushed | github.com/camfintech/gaap-mcp |
| AWS Mock DPI Endpoints | ✅ Integrated | lg99tn8y8g.execute-api.ap-southeast-1.amazonaws.com |

### Available MCP Tools

| Tool | Layer | Description |
|------|-------|-------------|
| `gaap_audit_log_event` | L4 | Log compliance events with optional CamDL blockchain anchoring |
| `gaap_khqr_generate` | L3 | Generate Cambodia KHQR payment QR codes via Bakong |
| `gaap_policy_evaluate` | L2 | Evaluate CamDX policy based on amount bands and identity levels |
| `gaap_khqr_verify_settlement` | L3 | Verify payment settlement via Bakong MD5 |
| `gaap_policy_publish_intent` | L2 | Publish payment intent to CamDX X-Road |
| `gaap_identity_verify` | L1 | Verify identity via CamDigiKey (L1/L2) or phone OTP |
| `gaap_aml_screen` | L4 | AML/CFT screening for transactions, PEP, and sanctions |

### AWS Mock DPI Endpoints

All workflows call AWS mock DPI endpoints with automatic fallback to local logic on HTTP errors.

| Service | AWS Endpoint | Used By |
|---------|--------------|---------|
| CamDigiKey | POST `/v1/camdigikey/verify` | `gaap_identity_verify` |
| Bakong KHQR | POST `/v1/bakong/khqr/generate` | `gaap_khqr_generate` |
| CamDL Audit | POST `/v1/camdl/audit/log` | `gaap_audit_log_event` |
| GaaS AML | POST `/aml/screen` | `gaap_aml_screen` |

---

## 13. Implementation Progress Summary

### Completed (7 of 7 core tools) ✅

| Tool | Layer | Use Case | Status |
|------|-------|----------|--------|
| `gaap_audit_log_event` | L4 Compliance | Audit trails, state changes, CamDL anchoring | ✅ AWS integrated |
| `gaap_khqr_generate` | L3 Payments | Cambodia KHQR payment QR codes via Bakong | ✅ AWS integrated |
| `gaap_policy_evaluate` | L2 Interoperability | CamDX policy decisions, identity requirements | ✅ Local logic |
| `gaap_khqr_verify_settlement` | L3 Payments | Verify payment settlement via Bakong MD5 | ✅ Local logic |
| `gaap_policy_publish_intent` | L2 Interoperability | CamDX X-Road intent publication for AML/CFT | ✅ Local logic |
| `gaap_identity_verify` | L1 Identity | CamDigiKey L1/L2 and phone OTP verification | ✅ AWS integrated |
| `gaap_aml_screen` | L4 Compliance | AML/CFT screening (transaction, PEP, sanctions) | ✅ AWS integrated |

### Future Enhancements (Optional)

| Tool | Layer | Notes |
|------|-------|-------|
| `gaap_audit_anchor_batch` | L4 | Batch merkle anchoring |
| `gaap_audit_generate_proof` | L4 | Generate compliance evidence package |

### Architecture Achieved

```
┌─────────────────────┐     stdio      ┌─────────────────────┐
│   Claude Desktop    │◄──────────────►│  gaap-mcp-server    │
│   (or any MCP       │                │  (Node.js)          │
│    client)          │                │  7 tools available  │
└─────────────────────┘                └──────────┬──────────┘
                                                  │ HTTPS + HMAC
                                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    n8n Gateway Workflow                      │
│              automation.omnidm.ai/webhook/gaap-mcp/invoke    │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────────┐  │
│  │ Audit Log │ │   KHQR    │ │  Policy   │ │ Settlement  │  │
│  │ (L4)      │ │   (L3)    │ │  (L2)     │ │ Verify (L3) │  │
│  └───────────┘ └───────────┘ └───────────┘ └─────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                  │
│  │ Identity  │ │   AML     │ │  Publish  │                  │
│  │Verify (L1)│ │Screen (L4)│ │Intent (L2)│                  │
│  └─────┬─────┘ └─────┬─────┘ └───────────┘                  │
│        │             │                                       │
│        ▼             ▼                                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          AWS Mock DPI Endpoints (with fallback)      │    │
│  │   lg99tn8y8g.execute-api.ap-southeast-1.amazonaws.com │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │     PostgreSQL          │
              │  gaap_mcp schema (RLS)  │
              └─────────────────────────┘
```

---

## 14. G01-G09 Gap Analysis

### Workflow-to-MCP Tool Mapping

| Workflow | Name | GaaP Layer | MCP Tool Required | Status |
|----------|------|------------|-------------------|--------|
| G01 | Channel Ingress | L7 App | NO (Telegram-specific) | N/A |
| G02 | Identity Policy | L2 CamDX | `gaap_policy_evaluate` | ✅ Implemented |
| G03 | Intent Builder | L7 App | NO (Business logic) | N/A |
| G04 | CamDX PublishIntent | L2 CamDX | `gaap_policy_publish_intent` | ✅ Implemented |
| G05 | KHQR Generation | L3 Payments | `gaap_khqr_generate` | ✅ Implemented |
| G06 | Telegram Delivery | L7 App | NO (Channel-specific) | N/A |
| G07 | Settlement Verify | L3 Payments | `gaap_khqr_verify_settlement` | ✅ Implemented |
| G08 | Fulfillment | L7 App | NO (Logistics-specific) | N/A |
| G09 | Audit CamDL | L4 Compliance | `gaap_audit_log_event` | ✅ Implemented |

### Current Coverage Summary

```
GaaP MCP Tool Coverage: 100% (7 of 7 core tools)
├── L1 Identity (CamDigiKey)
│   └── gaap_identity_verify          ✅ Implemented (AWS DPI integrated)
├── L2 Interoperability (CamDX)
│   ├── gaap_policy_evaluate          ✅ Implemented (from G02)
│   └── gaap_policy_publish_intent    ✅ Implemented (from G04)
├── L3 Payments (Bakong/KHQR)
│   ├── gaap_khqr_generate            ✅ Implemented (AWS DPI integrated)
│   └── gaap_khqr_verify_settlement   ✅ Implemented (from G07)
└── L4 Compliance (CamDL/GaaS)
    ├── gaap_audit_log_event          ✅ Implemented (AWS DPI integrated)
    └── gaap_aml_screen               ✅ Implemented (AWS DPI integrated)
```

---

## 15. Commerce Usage Examples

### Example 1: Coffee Shop Purchase ($8 USD) - Band A

**Scenario**: Anonymous customer orders coffee via Telegram bot

```
1. Policy Check (before order creation)
───────────────────────────────────────
gaap_policy_evaluate({
  amount: 8,
  currency: "USD",
  identity_level: "anonymous"
})

→ Result: { decision: "allowed", amount_band: "A" }
   (Band A ≤$10 allows anonymous)

2. Generate Payment QR
───────────────────────────────────────
gaap_khqr_generate({
  amount: 8,
  currency: "USD",
  merchant_name: "Cafe Noir",
  account_id: "cafenoir@aba",
  bill_number: "ORD-2026-001"
})

→ Result: { qr_data: "00020101...", md5: "a1b2c3...", txn_ref: "TXN-..." }

3. Verify Payment (poll until settled)
───────────────────────────────────────
gaap_khqr_verify_settlement({
  md5: "a1b2c3...",
  txn_ref: "TXN-..."
})

→ Result: { settled: true, amount: 8, bakong_ref: "BK123..." }

4. Log Audit Event
───────────────────────────────────────
gaap_audit_log_event({
  event_type: "payment.completed",
  entity_type: "order",
  entity_id: "ORD-2026-001",
  new_state: { status: "paid", amount: 8 }
})

→ Result: { audit_event_id: "...", event_hash: "..." }
```

**Note**: Band A transactions don't require `gaap_policy_publish_intent` (regulatory threshold not met)

---

### Example 2: Electronics Purchase ($250 USD) - Band C

**Scenario**: Customer with basic identity buys a phone

```
1. Policy Check
───────────────────────────────────────
gaap_policy_evaluate({
  amount: 250,
  currency: "USD",
  identity_level: "basic"
})

→ Result: {
    decision: "blocked",
    amount_band: "C",
    required_identity_level: "verified",
    step_up_instructions: "CamDigiKey Level 2 required"
  }

❌ BLOCKED - Customer must verify identity first

--- Customer completes CamDigiKey verification ---

2. Policy Check (retry after verification)
───────────────────────────────────────
gaap_policy_evaluate({
  amount: 250,
  currency: "USD",
  identity_level: "verified"
})

→ Result: { decision: "allowed", amount_band: "C" }

3. Publish Intent to CamDX (regulatory requirement for Band C)
───────────────────────────────────────
gaap_policy_publish_intent({
  order_id: "ORD-2026-002",
  merchant_id: "MER-TECHSHOP-001",
  amount: 250,
  currency: "USD",
  amount_band: "C",
  identity_level: "verified",
  customer_id: "CUST-123",
  camdigi_key_id: "CDK-456",
  items: [{ name: "Samsung Galaxy A54", quantity: 1, unit_price: 250 }]
})

→ Result: {
    status: "success",
    intent_id: "CAMDX-2026-PAY-...",
    x_road_id: "XR-2026-..."
  }

4. Generate Payment QR
───────────────────────────────────────
gaap_khqr_generate({
  amount: 250,
  merchant_name: "TechShop Cambodia",
  account_id: "techshop@acleda",
  bill_number: "ORD-2026-002"
})

5. Verify Settlement
───────────────────────────────────────
gaap_khqr_verify_settlement({ md5: "...", txn_ref: "..." })

6. Log Audit with Blockchain Anchoring
───────────────────────────────────────
gaap_audit_log_event({
  event_type: "order.completed",
  entity_type: "order",
  entity_id: "ORD-2026-002",
  previous_state: { status: "pending_payment" },
  new_state: { status: "paid", amount: 250, camdx_intent_id: "CAMDX-2026-PAY-..." },
  anchor_to_camdl: true,  // High-value = blockchain anchor
  correlation_id: "CRR-..."
})

→ Result: { audit_event_id: "...", camdl_tx_hash: "0x..." }
```

---

### Example 3: Bulk Restaurant Order ($45 USD) - Band B

**Scenario**: Office manager orders lunch for team

```
1. Policy Check
───────────────────────────────────────
gaap_policy_evaluate({
  amount: 45,
  currency: "USD",
  identity_level: "anonymous"
})

→ Result: {
    decision: "limited",
    amount_band: "B",
    required_identity_level: "basic",
    constraints: { daily_limit: 50, remaining: 50 }
  }

⚠️ LIMITED - Can proceed but recommend basic identity

2. Generate Payment QR
───────────────────────────────────────
gaap_khqr_generate({
  amount: 45,
  merchant_name: "Phnom Penh Kitchen",
  account_id: "ppkitchen@wing",
  store_label: "BKK1 Branch",
  expiry_minutes: 30  // Longer expiry for group coordination
})

3. Verify Settlement
───────────────────────────────────────
gaap_khqr_verify_settlement({ md5: "...", txn_ref: "..." })

4. Log Audit
───────────────────────────────────────
gaap_audit_log_event({
  event_type: "order.paid",
  entity_type: "order",
  entity_id: "ORD-2026-003",
  new_state: {
    status: "paid",
    amount: 45,
    items_count: 8,
    delivery_address: "Office Tower Floor 12"
  },
  metadata: { channel: "telegram", bot_id: "ppkitchen_bot" }
})
```

---

### Example 4: High-Value Jewelry ($1,200 USD) - Band D

**Scenario**: Verified customer purchases gold necklace

```
1. Policy Check
───────────────────────────────────────
gaap_policy_evaluate({
  amount: 1200,
  currency: "USD",
  identity_level: "verified"
})

→ Result: {
    decision: "blocked",
    amount_band: "D",
    required_identity_level: "high_assurance",
    step_up_instructions: "CamDigiKey Level 3 + biometric required"
  }

❌ BLOCKED - Even verified isn't enough for Band D

--- Customer completes enhanced due diligence ---

2. Policy Check (after high assurance verification)
───────────────────────────────────────
gaap_policy_evaluate({
  amount: 1200,
  currency: "USD",
  identity_level: "high_assurance"
})

→ Result: { decision: "allowed", amount_band: "D" }

3. Publish Intent (MANDATORY for Band D)
───────────────────────────────────────
gaap_policy_publish_intent({
  order_id: "ORD-2026-004",
  merchant_id: "MER-GOLDSTAR-001",
  amount: 1200,
  amount_band: "D",
  identity_level: "high_assurance",
  camdigi_key_id: "CDK-789",
  items: [{ name: "18K Gold Necklace 24g", quantity: 1, unit_price: 1200 }]
})

→ Result: { status: "success", x_road_id: "XR-2026-..." }

4. Generate KHQR
───────────────────────────────────────
gaap_khqr_generate({
  amount: 1200,
  merchant_name: "GoldStar Jewelry",
  account_id: "goldstar@aba",
  merchant_id: "MER-GOLDSTAR-001",
  qr_type: "merchant"
})

5. Verify Settlement
───────────────────────────────────────
gaap_khqr_verify_settlement({ md5: "...", txn_ref: "..." })

6. Audit with CamDL Anchoring (required for Band D)
───────────────────────────────────────
gaap_audit_log_event({
  event_type: "high_value_sale.completed",
  entity_type: "order",
  entity_id: "ORD-2026-004",
  new_state: {
    status: "completed",
    amount: 1200,
    camdx_intent_id: "CAMDX-2026-PAY-...",
    x_road_id: "XR-2026-...",
    identity_level: "high_assurance"
  },
  anchor_to_camdl: true,  // MANDATORY for compliance
  correlation_id: "CRR-..."
})
```

---

### Tool Usage Matrix by Amount Band

| Band | Amount | Identity | Tools Used | Regulatory |
|------|--------|----------|------------|------------|
| **A** | ≤$10 | Anonymous | evaluate → generate → verify → audit | None |
| **B** | $10-50 | Basic | evaluate → generate → verify → audit | Optional |
| **C** | $50-500 | Verified | evaluate → **publish_intent** → generate → verify → audit (anchor) | Required |
| **D** | >$500 | High Assurance | evaluate → **publish_intent** → generate → verify → audit (**anchor required**) | Mandatory |

### Typical Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Commerce Transaction Flow                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐                                               │
│  │ 1. Policy Check  │ gaap_policy_evaluate                          │
│  └────────┬─────────┘                                               │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │    Allowed?      │─NO─►│  Step-up Flow    │                      │
│  └────────┬─────────┘     │  (Identity KYC)  │                      │
│           │YES            └──────────────────┘                      │
│           ▼                                                          │
│  ┌──────────────────┐                                               │
│  │ 2. Publish Intent│ gaap_policy_publish_intent (Band C/D only)    │
│  └────────┬─────────┘                                               │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────┐                                               │
│  │ 3. Generate QR   │ gaap_khqr_generate                            │
│  └────────┬─────────┘                                               │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │ 4. Poll Payment  │────►│  Customer Pays   │                      │
│  │    (loop)        │◄────│  via Bakong App  │                      │
│  └────────┬─────────┘     └──────────────────┘                      │
│           │ gaap_khqr_verify_settlement                             │
│           ▼                                                          │
│  ┌──────────────────┐                                               │
│  │ 5. Log Audit     │ gaap_audit_log_event                          │
│  │    (+ CamDL?)    │ anchor_to_camdl: true for high-value          │
│  └──────────────────┘                                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 16. G12 Order Management Compatibility Analysis

### G12 Workflow Inventory (22 Workflows)

| Workflow | Name | Purpose | GaaP MCP Tool Needed |
|----------|------|---------|---------------------|
| G12.00 | Credential Resolver | Secure credential management | None (L7 App) |
| G12.00A | Telegram Adapter | Parse Telegram webhooks | None (L7 App) |
| G12.00B | WhatsApp Adapter | Parse WhatsApp webhooks | None (L7 App) |
| G12.00C | Messenger Adapter | Parse Messenger webhooks | None (L7 App) |
| G12.00D | Web Embed Adapter | Parse web widget messages | None (L7 App) |
| G12.00E | Intent Detection | LLM-based intent classification | None (L7 App) |
| G12.01-MT | Multi-Tenant Orchestrator | Route messages to flows | None (L7 App) |
| G12.02 | Order Creation | Create orders, calc amount bands | `gaap_policy_evaluate` |
| G12.04 | Policy Enforcement | Enforce GaaP policies | `gaap_policy_evaluate` |
| G12.05 | Payment Intent Publish | CamDX X-Road publishing | `gaap_policy_publish_intent` |
| G12.06 | KHQR Generation | Generate Bakong QR codes | `gaap_khqr_generate` |
| G12.07 | Payment Verification | Poll Bakong settlement | `gaap_khqr_verify_settlement` |
| G12.08 | Delivery Management | Grab API integration | None (L7 App) |
| G12.09 | Audit Anchoring | CamDL blockchain anchoring | `gaap_audit_log_event` |
| G12.10 | Error Handler | Centralized error handling | None (L7 App) |
| G12.11 | Queue Consumer | Async message processing | None (L7 App) |
| G12.12 | Saga Orchestrator | Distributed saga pattern | None (L7 App) |
| G12.13 | Metrics Dashboard | Real-time metrics | None (L7 App) |
| G12.16 | STR/LTR Detection | Suspicious transaction detection | `gaap_audit_log_event` |
| G12.17 | NBC Monthly Report | Regulatory reporting | None (uses audit data) |
| G12.18 | Daily Reconciliation | Settlement reconciliation | `gaap_khqr_verify_settlement` |

### Platform Adapters (G12.00A-D)

**Verdict: NOT part of GaaP MCP (correctly)**

Platform adapters are **L7 Application** components that:
- Parse platform-specific webhook formats
- Transform to/from UnifiedMessage format
- Handle platform constraints (button limits, char limits)
- Manage platform-specific credentials

```
┌──────────────────────────────────────────────────────────────────┐
│                    Platform Adapters (L7)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Telegram │ │ WhatsApp │ │Messenger │ │Web Embed │            │
│  │ G12.00A  │ │ G12.00B  │ │ G12.00C  │ │ G12.00D  │            │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘            │
│       └────────────┼────────────┼────────────┘                   │
│                    ▼                                              │
│            UnifiedMessage Format                                  │
│                    │                                              │
│                    ▼                                              │
│          G12.01-MT Orchestrator                                  │
│                    │                                              │
└────────────────────┼─────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                    GaaP MCP Tools (L2-L4)                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                 │
│  │ Policy      │ │ KHQR        │ │ Audit       │                 │
│  │ Evaluate    │ │ Generate    │ │ Log Event   │                 │
│  └─────────────┘ └─────────────┘ └─────────────┘                 │
│  ┌─────────────┐ ┌─────────────┐                                 │
│  │ Publish     │ │ Verify      │                                 │
│  │ Intent      │ │ Settlement  │                                 │
│  └─────────────┘ └─────────────┘                                 │
└──────────────────────────────────────────────────────────────────┘
```

### GaaP MCP Tool Coverage Assessment

| Capability | G12 Workflow | MCP Tool | Status |
|------------|--------------|----------|--------|
| Policy evaluation | G12.02, G12.04 | `gaap_policy_evaluate` | ✅ Covered |
| KHQR generation | G12.06 | `gaap_khqr_generate` | ✅ Covered (AWS DPI) |
| Settlement verification | G12.07, G12.18 | `gaap_khqr_verify_settlement` | ✅ Covered |
| CamDX intent publishing | G12.05 | `gaap_policy_publish_intent` | ✅ Covered |
| Audit logging | G12.09, G12.16 | `gaap_audit_log_event` | ✅ Covered (AWS DPI) |
| Identity verification | G12.02 (step-up) | `gaap_identity_verify` | ✅ Covered (AWS DPI) |
| AML/CFT screening | G12.02, G12.16 | `gaap_aml_screen` | ✅ Covered (AWS DPI) |
| Batch anchoring | G12.09 | `gaap_audit_anchor_batch` | ❌ Not implemented |
| Merkle proof generation | G12.09 | `gaap_audit_generate_proof` | ❌ Not implemented |

### Verdict: Are 7 MCP Tools Sufficient?

**For Chat-Based Order Automation: YES (100% coverage)**

The 7 core tools cover all critical financial rails:

| Commerce Step | Tool | Sufficient? |
|---------------|------|-------------|
| 1. Check policy before order | `gaap_policy_evaluate` | ✅ Yes |
| 2. Verify customer identity | `gaap_identity_verify` | ✅ Yes |
| 3. Screen for AML/CFT | `gaap_aml_screen` | ✅ Yes |
| 4. Publish intent to CamDX | `gaap_policy_publish_intent` | ✅ Yes |
| 5. Generate payment QR | `gaap_khqr_generate` | ✅ Yes |
| 6. Verify payment settled | `gaap_khqr_verify_settlement` | ✅ Yes |
| 7. Log audit events | `gaap_audit_log_event` | ✅ Yes |

**What's NOT covered (and shouldn't be in GaaP MCP):**

| Component | Why Not in MCP |
|-----------|----------------|
| Platform Adapters | L7 application-specific, varies by product |
| Intent Detection (LLM) | L7 application logic, not FinTech rails |
| Conversation State | L7 application flow management |
| Product Catalogs | L7 tenant-specific data |
| Delivery Integration | L7 logistics (Grab/Lalamove), not FinTech |
| Credential Management | Already in G12.00, cross-cutting concern |

### Migration Path: G12 → GaaP MCP

To fully migrate G12 to use GaaP MCP tools:

| G12 Workflow | Current Implementation | Migration Action |
|--------------|------------------------|------------------|
| G12.02 | Hardcoded policy matrix | Replace with `gaap_policy_evaluate` call |
| G12.05 | Direct HTTP to CamDX | Replace with `gaap_policy_publish_intent` call |
| G12.06 | Manual EMV/TLV encoding | Replace with `gaap_khqr_generate` call |
| G12.07 | Manual Bakong polling | Replace with `gaap_khqr_verify_settlement` call |
| G12.09 | Manual merkle construction | Replace with `gaap_audit_log_event` + new batch tool |

**Estimated Effort**: 5-7 workflow modifications, ~20-30 node updates

### Recommended Additional Tools (Optional)

If batch anchoring and proof verification are critical:

```
Future Tools (Phase 2):
├── gaap_audit_anchor_batch     - Batch merkle anchoring
├── gaap_audit_verify_proof     - Verify event against blockchain
└── gaap_identity_verify        - CamDigiKey integration (complex)
```

### Conclusion

**The 7 core GaaP MCP tools provide COMPLETE coverage for automating order management in chat sessions.**

Platform adapters (G12.00A-D) correctly remain outside GaaP MCP because:
1. They are L7 application-specific (Telegram vs WhatsApp vs Messenger)
2. Different products may need different adapters
3. GaaP MCP focuses on FinTech rails (L1-L4), not messaging platforms

The current tool set enables:
- Any chat platform to process Cambodia-compliant payments
- Policy-based transaction approval with identity requirements
- CamDigiKey identity verification (L1/L2/phone OTP)
- AML/CFT screening for transactions, PEP, and sanctions
- Bakong KHQR payments with AWS mock DPI integration
- CamDX regulatory compliance
- Audit trail with optional blockchain anchoring

**Remaining work**: Migrate G12 workflows to call MCP tools instead of implementing logic inline.
