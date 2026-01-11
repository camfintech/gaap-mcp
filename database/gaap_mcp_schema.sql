-- =============================================================================
-- GaaP MCP Database Schema
-- Cambodia Government-as-a-Platform Model Context Protocol Server
-- =============================================================================
-- Multi-tenant, strict isolation, GDPR/CCPA aligned
-- All tables enforce tenant_id segregation via RLS
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create schema
CREATE SCHEMA IF NOT EXISTS gaap_mcp;

-- =============================================================================
-- TENANT CONTEXT (for RLS)
-- =============================================================================
-- Set before any query: SET app.current_tenant_id = 'uuid';

-- =============================================================================
-- CREDENTIALS TABLE
-- Stores encrypted credentials scoped by tool
-- =============================================================================
CREATE TABLE gaap_mcp.credentials (
    credential_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,

    -- Credential identification
    credential_type VARCHAR(50) NOT NULL,
    -- Types: 'camdigikey_merchant', 'camdx_api_key', 'camdx_mtls_cert',
    --        'bakong_merchant_id', 'bakong_api_key', 'camdl_api_key',
    --        'tenant_api_key', 'tenant_webhook_secret'

    -- Encrypted storage (AES-256-GCM format: {iv}:{ciphertext}:{authTag})
    encrypted_value TEXT NOT NULL,
    encryption_key_id VARCHAR(50) NOT NULL DEFAULT 'gaap-mcp-key-v1',

    -- Scopes: Which MCP tools can access this credential?
    scopes TEXT[] NOT NULL DEFAULT ARRAY['gaap_audit_log_event'],
    -- Examples: 'gaap_khqr_generate', 'gaap_policy_evaluate', 'gaap_identity_verify'

    -- GaaP Layer mapping (L1=Identity, L2=Interop, L3=Payments, L4=Compliance)
    gaap_layer VARCHAR(10) NOT NULL CHECK (gaap_layer IN ('L1', 'L2', 'L3', 'L4', 'MCP')),

    -- Lifecycle
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    rotation_policy VARCHAR(50) DEFAULT '90d',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Uniqueness per tenant
    CONSTRAINT uq_tenant_gaap_cred UNIQUE (tenant_id, credential_type)
);

-- Index for credential lookup
CREATE INDEX idx_credentials_tenant_type ON gaap_mcp.credentials(tenant_id, credential_type) WHERE is_active = TRUE;
CREATE INDEX idx_credentials_scopes ON gaap_mcp.credentials USING GIN(scopes);

-- =============================================================================
-- CREDENTIAL ACCESS LOG
-- Audit trail for credential access (values NEVER logged)
-- =============================================================================
CREATE TABLE gaap_mcp.credential_access_log (
    access_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    credential_id UUID NOT NULL REFERENCES gaap_mcp.credentials(credential_id),
    tenant_id UUID NOT NULL,

    -- Access context
    tool_name VARCHAR(100) NOT NULL,
    workflow_id VARCHAR(100),
    request_id VARCHAR(100),

    -- Access result
    access_granted BOOLEAN NOT NULL,
    denial_reason VARCHAR(255),

    -- Timing
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- IP/source (for security audit)
    source_ip INET,
    user_agent TEXT
);

-- Index for audit queries
CREATE INDEX idx_cred_access_tenant ON gaap_mcp.credential_access_log(tenant_id, accessed_at DESC);
CREATE INDEX idx_cred_access_credential ON gaap_mcp.credential_access_log(credential_id, accessed_at DESC);

-- =============================================================================
-- TOOL INVOCATIONS
-- Audit log of all MCP tool calls
-- =============================================================================
CREATE TABLE gaap_mcp.tool_invocations (
    invocation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,

    -- Request identification
    request_id VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(255),
    correlation_id VARCHAR(100),

    -- Tool details
    tool_name VARCHAR(100) NOT NULL,
    gaap_layer VARCHAR(10) NOT NULL,

    -- Request/Response (sanitized - no credentials)
    request_params JSONB NOT NULL DEFAULT '{}',
    response_data JSONB,

    -- Execution metrics
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    execution_ms INTEGER,

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'success', 'error', 'timeout')),
    error_code VARCHAR(100),
    error_message TEXT,
    is_recoverable BOOLEAN,

    -- Source context
    source_workflow VARCHAR(100),
    source_platform VARCHAR(50),
    source_ip INET,

    -- CamDL anchoring
    camdl_anchored BOOLEAN DEFAULT FALSE,
    camdl_anchor_id VARCHAR(100)
);

-- Indexes for query patterns
CREATE INDEX idx_invocations_tenant_time ON gaap_mcp.tool_invocations(tenant_id, started_at DESC);
CREATE INDEX idx_invocations_request ON gaap_mcp.tool_invocations(request_id);
CREATE INDEX idx_invocations_idempotency ON gaap_mcp.tool_invocations(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_invocations_correlation ON gaap_mcp.tool_invocations(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_invocations_status ON gaap_mcp.tool_invocations(status) WHERE status IN ('pending', 'processing');

-- =============================================================================
-- NONCE REGISTRY
-- Prevents replay attacks (stores used nonces with TTL)
-- =============================================================================
CREATE TABLE gaap_mcp.nonce_registry (
    nonce_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    nonce VARCHAR(100) NOT NULL,

    -- Request context
    request_timestamp TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Auto-expire after 5 minutes (handled by cleanup job)
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),

    -- Uniqueness: one nonce per tenant
    CONSTRAINT uq_tenant_nonce UNIQUE (tenant_id, nonce)
);

-- Index for nonce lookup
CREATE INDEX idx_nonce_tenant ON gaap_mcp.nonce_registry(tenant_id, nonce);
CREATE INDEX idx_nonce_expires ON gaap_mcp.nonce_registry(expires_at);

-- =============================================================================
-- RATE LIMITS
-- Per-tenant rate limiting configuration and state
-- =============================================================================
CREATE TABLE gaap_mcp.rate_limits (
    rate_limit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,

    -- Rate limit scope
    scope VARCHAR(50) NOT NULL DEFAULT 'global',
    -- Scopes: 'global', 'tool:<tool_name>', 'layer:<L1-L4>'

    -- Limit configuration
    max_requests INTEGER NOT NULL DEFAULT 1000,
    window_seconds INTEGER NOT NULL DEFAULT 60,

    -- Current window state
    current_count INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Metadata
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_tenant_scope UNIQUE (tenant_id, scope)
);

-- Index for rate limit checks
CREATE INDEX idx_rate_limits_tenant ON gaap_mcp.rate_limits(tenant_id, scope);

-- =============================================================================
-- AUDIT EVENTS
-- Compliance event log with CamDL anchoring support
-- =============================================================================
CREATE TABLE gaap_mcp.audit_events (
    audit_event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,

    -- Event identification
    correlation_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    -- Types: 'identity.verified', 'policy.evaluated', 'payment.initiated',
    --        'payment.captured', 'audit.anchored', 'error.logged'

    -- Entity reference (what this event is about)
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    -- Examples: entity_type='order', entity_id='ORD-2025-001'

    -- State change tracking
    previous_state JSONB,
    new_state JSONB,
    state_change_summary TEXT,

    -- Hash chain for integrity
    event_hash VARCHAR(64) NOT NULL,  -- SHA-256
    previous_hash VARCHAR(64),         -- Links to previous event

    -- Metadata
    metadata JSONB DEFAULT '{}',

    -- Timing
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- CamDL blockchain anchoring
    camdl_anchored BOOLEAN NOT NULL DEFAULT FALSE,
    camdl_anchor_id VARCHAR(100),
    camdl_block_number BIGINT,
    camdl_tx_hash VARCHAR(100),
    camdl_anchored_at TIMESTAMPTZ,

    -- Source
    source_tool VARCHAR(100),
    source_workflow VARCHAR(100),
    source_ip INET
);

-- Indexes for audit queries
CREATE INDEX idx_audit_tenant_time ON gaap_mcp.audit_events(tenant_id, event_timestamp DESC);
CREATE INDEX idx_audit_correlation ON gaap_mcp.audit_events(correlation_id);
CREATE INDEX idx_audit_entity ON gaap_mcp.audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_type ON gaap_mcp.audit_events(event_type);
CREATE INDEX idx_audit_pending_anchor ON gaap_mcp.audit_events(tenant_id) WHERE camdl_anchored = FALSE;

-- =============================================================================
-- ROW-LEVEL SECURITY POLICIES
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE gaap_mcp.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaap_mcp.credential_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaap_mcp.tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaap_mcp.nonce_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaap_mcp.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE gaap_mcp.audit_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies (tenant can only see their own data)
CREATE POLICY tenant_isolation_credentials ON gaap_mcp.credentials
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_cred_access ON gaap_mcp.credential_access_log
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_invocations ON gaap_mcp.tool_invocations
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_nonces ON gaap_mcp.nonce_registry
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_rate_limits ON gaap_mcp.rate_limits
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_audit ON gaap_mcp.audit_events
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to check and update rate limit
CREATE OR REPLACE FUNCTION gaap_mcp.check_rate_limit(
    p_tenant_id UUID,
    p_scope VARCHAR DEFAULT 'global'
) RETURNS BOOLEAN AS $$
DECLARE
    v_limit RECORD;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    -- Get or create rate limit record
    INSERT INTO gaap_mcp.rate_limits (tenant_id, scope, current_count, window_start)
    VALUES (p_tenant_id, p_scope, 0, v_now)
    ON CONFLICT (tenant_id, scope) DO NOTHING;

    -- Lock and check
    SELECT * INTO v_limit
    FROM gaap_mcp.rate_limits
    WHERE tenant_id = p_tenant_id AND scope = p_scope
    FOR UPDATE;

    -- Reset window if expired
    IF v_now > v_limit.window_start + (v_limit.window_seconds || ' seconds')::INTERVAL THEN
        UPDATE gaap_mcp.rate_limits
        SET current_count = 1, window_start = v_now, updated_at = v_now
        WHERE tenant_id = p_tenant_id AND scope = p_scope;
        RETURN TRUE;
    END IF;

    -- Check if within limit
    IF v_limit.current_count < v_limit.max_requests THEN
        UPDATE gaap_mcp.rate_limits
        SET current_count = current_count + 1, updated_at = v_now
        WHERE tenant_id = p_tenant_id AND scope = p_scope;
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Function to check nonce (returns TRUE if nonce is new and valid)
CREATE OR REPLACE FUNCTION gaap_mcp.check_nonce(
    p_tenant_id UUID,
    p_nonce VARCHAR,
    p_timestamp TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_max_age INTERVAL := INTERVAL '5 minutes';
BEGIN
    -- Check timestamp freshness
    IF p_timestamp < v_now - v_max_age OR p_timestamp > v_now + INTERVAL '1 minute' THEN
        RETURN FALSE;  -- Timestamp too old or in future
    END IF;

    -- Try to insert nonce (fails if duplicate)
    BEGIN
        INSERT INTO gaap_mcp.nonce_registry (tenant_id, nonce, request_timestamp)
        VALUES (p_tenant_id, p_nonce, p_timestamp);
        RETURN TRUE;
    EXCEPTION WHEN unique_violation THEN
        RETURN FALSE;  -- Nonce already used
    END;
END;
$$ LANGUAGE plpgsql;

-- Function to compute event hash
CREATE OR REPLACE FUNCTION gaap_mcp.compute_event_hash(
    p_tenant_id UUID,
    p_event_type VARCHAR,
    p_entity_type VARCHAR,
    p_entity_id VARCHAR,
    p_new_state JSONB,
    p_previous_hash VARCHAR,
    p_timestamp TIMESTAMPTZ
) RETURNS VARCHAR AS $$
DECLARE
    v_canonical TEXT;
BEGIN
    -- Canonical format for hashing
    v_canonical := p_tenant_id::TEXT || '|' ||
                   p_event_type || '|' ||
                   p_entity_type || '|' ||
                   p_entity_id || '|' ||
                   COALESCE(p_new_state::TEXT, '') || '|' ||
                   COALESCE(p_previous_hash, '') || '|' ||
                   p_timestamp::TEXT;

    RETURN encode(digest(v_canonical, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================================================
-- CLEANUP JOB (run via cron or n8n schedule)
-- =============================================================================

-- Function to clean up expired nonces
CREATE OR REPLACE FUNCTION gaap_mcp.cleanup_expired_nonces() RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM gaap_mcp.nonce_registry
    WHERE expires_at < NOW();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON SCHEMA gaap_mcp IS 'Cambodia GaaP MCP - Multi-tenant platform orchestration';
COMMENT ON TABLE gaap_mcp.credentials IS 'Encrypted credential storage with scope-based access control';
COMMENT ON TABLE gaap_mcp.tool_invocations IS 'Audit log of all MCP tool invocations';
COMMENT ON TABLE gaap_mcp.nonce_registry IS 'Replay attack prevention via nonce tracking';
COMMENT ON TABLE gaap_mcp.audit_events IS 'Compliance event log with CamDL blockchain anchoring';
