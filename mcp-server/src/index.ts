#!/usr/bin/env node
/**
 * GaaP MCP Server for Claude Desktop
 *
 * Bridges Claude Desktop to the Cambodia GaaP platform HTTP API.
 * Implements MCP protocol over stdio transport.
 *
 * Environment variables:
 * - GAAP_TENANT_ID: Tenant UUID
 * - GAAP_API_KEY: API key for authentication
 * - GAAP_WEBHOOK_SECRET: Secret for HMAC signature
 * - GAAP_MCP_URL: Optional override for API endpoint
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AuthConfig } from './auth.js';
import { invokeGaapTool } from './client.js';

// Validate required environment variables
const requiredEnvVars = ['GAAP_TENANT_ID', 'GAAP_API_KEY', 'GAAP_WEBHOOK_SECRET'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const config: AuthConfig = {
  tenantId: process.env.GAAP_TENANT_ID!,
  apiKey: process.env.GAAP_API_KEY!,
  webhookSecret: process.env.GAAP_WEBHOOK_SECRET!,
};

// Create MCP server
const server = new Server(
  { name: 'gaap-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Define available tools
const GAAP_TOOLS = [
  {
    name: 'gaap_audit_log_event',
    description: 'Log a compliance event with optional CamDL blockchain anchoring. Use for audit trails, state changes, and regulatory compliance.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        event_type: {
          type: 'string',
          description: 'Event type (e.g., order.created, payment.completed, identity.verified)'
        },
        entity_type: {
          type: 'string',
          description: 'Entity type being audited (e.g., order, payment, user)'
        },
        entity_id: {
          type: 'string',
          description: 'Unique identifier of the entity'
        },
        previous_state: {
          type: 'object',
          description: 'State of the entity before the change (optional)'
        },
        new_state: {
          type: 'object',
          description: 'State of the entity after the change'
        },
        anchor_to_camdl: {
          type: 'boolean',
          description: 'Whether to anchor this event to CamDL blockchain (default: false)'
        },
        correlation_id: {
          type: 'string',
          description: 'Correlation ID for tracing related events'
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata to store with the event'
        }
      },
      required: ['event_type', 'entity_type', 'entity_id'],
    },
  },
  // Future tools will be added here:
  // - gaap_khqr_generate
  // - gaap_policy_evaluate
  // - gaap_identity_verify
];

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: GAAP_TOOLS,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Validate tool exists
  const tool = GAAP_TOOLS.find(t => t.name === name);
  if (!tool) {
    return {
      content: [{
        type: 'text',
        text: `Error: Unknown tool '${name}'. Available tools: ${GAAP_TOOLS.map(t => t.name).join(', ')}`,
      }],
      isError: true,
    };
  }

  // Build correlation ID if not provided
  const correlationId = (args?.correlation_id as string) || `mcp-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Invoke the GaaP API
  const response = await invokeGaapTool(config, {
    tool: name,
    tenant_context: {
      tenant_id: config.tenantId,
      correlation_id: correlationId,
    },
    params: args as Record<string, unknown>,
    meta: {
      source_workflow: 'claude-desktop-mcp',
      request_id: `mcp-${Date.now()}`,
    },
  });

  // Handle errors
  if (!response.success) {
    const errorMsg = response.error
      ? `${response.error.code}: ${response.error.message}${response.error.suggested_action ? ` (${response.error.suggested_action})` : ''}`
      : 'Unknown error occurred';

    return {
      content: [{
        type: 'text',
        text: `Error: ${errorMsg}`,
      }],
      isError: true,
    };
  }

  // Format successful response
  const resultText = [
    `Tool: ${name}`,
    `Layer: ${response.meta.gaap_layer}`,
    `Execution: ${response.meta.execution_ms}ms`,
    response.meta.camdl_anchored ? `CamDL Anchored: Yes` : '',
    response.result?.audit_event_id ? `Audit Event ID: ${response.result.audit_event_id}` : '',
    `Correlation ID: ${response.result?.correlation_id || correlationId}`,
    '',
    'Result:',
    JSON.stringify(response.result?.data || response.result, null, 2),
  ].filter(Boolean).join('\n');

  return {
    content: [{
      type: 'text',
      text: resultText,
    }],
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start GaaP MCP server:', error);
  process.exit(1);
});
