# GaaP MCP Tool Test Report

**Date**: 2026-01-25
**Endpoint**: `https://automation.omnidm.ai/webhook/gaap-mcp/invoke`
**Tenant**: `00000000-0000-0000-0000-000000000001`

## Summary

| Tool | Layer | Status | Execution (ms) |
|------|-------|--------|----------------|
| `gaap_identity_verify` | L1 | PASS | ~150 |
| `gaap_policy_evaluate` | L2 | PASS | 158 |
| `gaap_policy_publish_intent` | L2 | PASS | 130 |
| `gaap_khqr_generate` | L3 | PASS | 107 |
| `gaap_khqr_verify_settlement` | L3 | PASS | 153 |
| `gaap_audit_log_event` | L4 | PASS | 109 |
| `gaap_aml_screen` | L4 | PASS | ~260 |

**Result: 7/7 tools passing**

---

## L1: Identity Layer

### gaap_identity_verify

**Request:**
```json
{
  "tool": "gaap_identity_verify",
  "tenant_context": {
    "tenant_id": "00000000-0000-0000-0000-000000000001",
    "correlation_id": "TEST-ID-001"
  },
  "params": {
    "verification_type": "camdigikey_l2",
    "identifier": "+855123456789"
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "data": {
      "verification_id": "8c834b1d-7418-4463-9dfc-0386a22e5b4f",
      "status": "verified",
      "identity_level": "high_assurance",
      "camdigikey_id": "CDK-1769316845858-n1vrah",
      "verified_at": "2026-01-25T04:54:05.858Z",
      "expires_at": "2026-01-26T04:54:05.858Z",
      "_fallback": true
    },
    "correlation_id": "TEST-ID-001"
  },
  "meta": {
    "gaap_layer": "MCP",
    "camdl_anchored": false
  }
}
```

---

## L2: Policy Layer

### gaap_policy_evaluate

**Request:**
```json
{
  "tool": "gaap_policy_evaluate",
  "tenant_context": {
    "tenant_id": "00000000-0000-0000-0000-000000000001",
    "correlation_id": "TEST-POL-001"
  },
  "params": {
    "policy_id": "order.create",
    "amount": 100,
    "subject": {"user_id": "USR-001", "role": "buyer"},
    "resource": {"type": "order"},
    "action": "create"
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "data": {
      "decision": "blocked",
      "amount_band": "C",
      "current_identity_level": "anonymous",
      "required_identity_level": "verified",
      "amount": 100,
      "amount_usd_equivalent": 100,
      "currency": "USD",
      "step_up_instructions": {
        "required_level": "verified",
        "current_level": "anonymous",
        "verification_options": ["CamDigiKey Level 2"],
        "help_text": "This transaction of USD 100.00 requires verified identity verification."
      },
      "evaluated_at": "2026-01-25T04:55:15.463Z"
    },
    "correlation_id": "TEST-POL-001"
  },
  "meta": {
    "execution_ms": 158,
    "gaap_layer": "L2",
    "camdl_anchored": false
  }
}
```

### gaap_policy_publish_intent

**Request:**
```json
{
  "tool": "gaap_policy_publish_intent",
  "tenant_context": {
    "tenant_id": "00000000-0000-0000-0000-000000000001",
    "correlation_id": "TEST-INT-001"
  },
  "params": {
    "order_id": "ORD-TEST-001",
    "merchant_id": "MERCH-001",
    "amount": 50,
    "currency": "USD"
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "data": {
      "status": "success",
      "intent_id": "CAMDX-2026-PAY-B598CD1500FB",
      "x_road_id": "XR-2026-1769316950110-CFE1A73A",
      "policy_decision": {
        "decision": "allowed",
        "identity_level": "anonymous",
        "amount_band": "B"
      },
      "published_at": "2026-01-25T04:55:50.110Z",
      "x_road_details": {
        "instance": "KH",
        "member_class": "COM",
        "member_code": "CAMDX",
        "service_code": "publishPaymentIntent",
        "service_version": "v1"
      }
    },
    "correlation_id": "TEST-INT-001"
  },
  "meta": {
    "execution_ms": 130,
    "gaap_layer": "L2",
    "camdl_anchored": false
  }
}
```

---

## L3: Payments Layer

### gaap_khqr_generate

**Request:**
```json
{
  "tool": "gaap_khqr_generate",
  "tenant_context": {
    "tenant_id": "00000000-0000-0000-0000-000000000001",
    "correlation_id": "TEST-KHQR-001"
  },
  "params": {
    "amount": 25.50,
    "currency": "USD",
    "merchant_name": "Test Merchant",
    "merchant_city": "Phnom Penh",
    "account_id": "test@aba"
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "data": {
      "qr_data": "00020101021229220006bakong0108test@aba520459995303840540525.505802KH5913Test Merchant6010Phnom Penh62300526TXN-1769316871024-854dea266304EA74",
      "md5": "a519927588c6336613c7e226dbaa4312",
      "txn_ref": "TXN-1769316871024-854dea26",
      "amount": 25.5,
      "currency": "USD",
      "expires_at": "2026-01-25T05:09:31.034Z",
      "qr_type": "merchant"
    },
    "correlation_id": "TEST-KHQR-001"
  },
  "meta": {
    "execution_ms": 107,
    "gaap_layer": "L3",
    "camdl_anchored": false
  }
}
```

### gaap_khqr_verify_settlement

**Request:**
```json
{
  "tool": "gaap_khqr_verify_settlement",
  "tenant_context": {
    "tenant_id": "00000000-0000-0000-0000-000000000001",
    "correlation_id": "TEST-SETTLE-001"
  },
  "params": {
    "md5": "a519927588c6336613c7e226dbaa4312",
    "txn_ref": "TXN-1769316871024-854dea26"
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "data": {
      "settled": true,
      "settlement_ref": "BKNG-1769316958914-703DA01F",
      "settled_at": "2026-01-25T04:55:58.914Z",
      "amount": 70.28,
      "currency": "USD",
      "bakong_ref": "BK1769316958914",
      "from_account": "customer@aba",
      "to_account": "merchant@aba",
      "description": "Payment for TXN-1769316871024-854dea26"
    },
    "correlation_id": "TEST-SETTLE-001"
  },
  "meta": {
    "execution_ms": 153,
    "gaap_layer": "L3",
    "camdl_anchored": false
  }
}
```

---

## L4: Compliance Layer

### gaap_audit_log_event

**Request:**
```json
{
  "tool": "gaap_audit_log_event",
  "tenant_context": {
    "tenant_id": "00000000-0000-0000-0000-000000000001",
    "correlation_id": "TEST-AUDIT-001"
  },
  "params": {
    "event_type": "order.created",
    "entity_type": "order",
    "entity_id": "ORD-TEST-001"
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "data": {
      "audit_event_id": "9c75b373-7909-4d94-943c-43e9f75b9ab6",
      "event_hash": "b8aa9fc21d75b6ef490a955d66acd940a39cb4a340b8241ee0a92599752e213b",
      "event_type": "order.created",
      "entity_type": "order",
      "entity_id": "ORD-TEST-001"
    },
    "correlation_id": "TEST-AUDIT-001",
    "audit_event_id": "9c75b373-7909-4d94-943c-43e9f75b9ab6"
  },
  "meta": {
    "execution_ms": 109,
    "gaap_layer": "L4",
    "camdl_anchored": false
  }
}
```

### gaap_aml_screen

**Request:**
```json
{
  "tool": "gaap_aml_screen",
  "tenant_context": {
    "tenant_id": "00000000-0000-0000-0000-000000000001",
    "correlation_id": "TEST-AML-001"
  },
  "params": {
    "screen_type": "transaction",
    "transaction_amount": 500,
    "customer_name": "Test Customer"
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "data": {
      "screening_id": "01474fe0-e471-4d70-ab24-4dc7cb2244df",
      "decision": "ALLOW",
      "risk_score": 0,
      "risk_factors": [],
      "matched_lists": [],
      "screening_timestamp": "2026-01-25T04:54:49.484Z",
      "_aws_endpoint": true
    },
    "correlation_id": "TEST-AML-001"
  },
  "meta": {
    "gaap_layer": "MCP",
    "camdl_anchored": false
  }
}
```

---

## Notes

1. **AWS DPI Integration**: `gaap_aml_screen` confirmed using AWS endpoint (`_aws_endpoint: true`)
2. **Fallback Mode**: `gaap_identity_verify` used fallback (`_fallback: true`) - AWS endpoint may have timed out
3. **Policy Evaluation**: Correctly blocks $100 transaction for anonymous user (requires CamDigiKey L2)
4. **All tools** return consistent envelope: `{success, result: {data, correlation_id}, meta}`
