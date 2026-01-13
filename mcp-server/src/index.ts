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
    description: 'Log compliance events with optional CamDL blockchain anchoring. Supports single event or batch mode for bulk anchoring. Use for audit trails, state changes, and regulatory compliance.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        // Single event mode properties
        event_type: {
          type: 'string',
          description: 'Event type (e.g., order.created, payment.completed). Required for single event mode.'
        },
        entity_type: {
          type: 'string',
          description: 'Entity type being audited (e.g., order, payment, user). Required for single event mode.'
        },
        entity_id: {
          type: 'string',
          description: 'Unique identifier of the entity. Required for single event mode.'
        },
        previous_state: {
          type: 'object',
          description: 'State of the entity before the change (optional)'
        },
        new_state: {
          type: 'object',
          description: 'State of the entity after the change'
        },
        // Batch mode properties
        batch_mode: {
          type: 'boolean',
          description: 'Enable batch mode for bulk event anchoring. When true, use events[] array instead of single event properties.'
        },
        batch_id: {
          type: 'string',
          description: 'Unique batch identifier (e.g., BATCH-1234567890). Required when batch_mode is true.'
        },
        event_count: {
          type: 'number',
          description: 'Number of events in the batch. Used for validation.'
        },
        events: {
          type: 'array',
          description: 'Array of events to anchor in batch mode. Each event should have event_id, event_type, event_data, event_hash, event_timestamp.',
          items: {
            type: 'object',
            properties: {
              event_id: { type: 'string', description: 'Unique event identifier' },
              event_type: { type: 'string', description: 'Event type' },
              correlation_id: { type: 'string', description: 'Correlation ID' },
              event_data: { type: 'object', description: 'Event data payload' },
              event_hash: { type: 'string', description: 'SHA-256 hash of event data' },
              event_timestamp: { type: 'string', description: 'ISO timestamp of event' }
            }
          }
        },
        // Common properties
        anchor_to_camdl: {
          type: 'boolean',
          description: 'Whether to anchor event(s) to CamDL blockchain (default: false)'
        },
        correlation_id: {
          type: 'string',
          description: 'Correlation ID for tracing related events'
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata to store with the event(s)'
        }
      },
      required: [],  // Validation handled dynamically: single mode needs event_type/entity_type/entity_id, batch mode needs events[]
    },
  },
  {
    name: 'gaap_khqr_generate',
    description: 'Generate a Cambodia KHQR payment QR code via Bakong. Returns QR data string and MD5 hash for payment verification.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        amount: {
          type: 'number',
          description: 'Payment amount. Use 0 for static QR (customer enters amount)'
        },
        currency: {
          type: 'string',
          description: 'Currency code: USD or KHR. Default: USD'
        },
        merchant_name: {
          type: 'string',
          description: 'Merchant or recipient name (max 25 characters)'
        },
        merchant_city: {
          type: 'string',
          description: 'Merchant city. Default: Phnom Penh'
        },
        account_id: {
          type: 'string',
          description: 'Bakong account ID in format username@bankcode (e.g., merchant@aba)'
        },
        merchant_id: {
          type: 'string',
          description: 'Merchant ID from acquiring bank (for merchant QR type)'
        },
        qr_type: {
          type: 'string',
          description: 'QR type: individual (personal) or merchant (business). Default: merchant'
        },
        bill_number: {
          type: 'string',
          description: 'Bill/invoice reference number (optional)'
        },
        store_label: {
          type: 'string',
          description: 'Store or branch label (optional)'
        },
        terminal_label: {
          type: 'string',
          description: 'Terminal/POS label (optional)'
        },
        expiry_minutes: {
          type: 'number',
          description: 'QR expiry time in minutes. Default: 15'
        },
        correlation_id: {
          type: 'string',
          description: 'Correlation ID for tracing related events'
        }
      },
      required: ['amount', 'merchant_name', 'account_id'],
    },
  },
  {
    name: 'gaap_policy_evaluate',
    description: 'Evaluate CamDX policy decision based on transaction amount and identity level. Returns whether transaction is allowed, requires identity verification, or is blocked. Use before order creation to check compliance requirements.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        amount: {
          type: 'number',
          description: 'Transaction amount to evaluate'
        },
        currency: {
          type: 'string',
          description: 'Currency code: USD or KHR. Default: USD'
        },
        identity_level: {
          type: 'string',
          description: 'Current identity verification level: anonymous, basic, verified, or high_assurance. Default: anonymous'
        },
        entity_type: {
          type: 'string',
          description: 'Type of transaction entity (e.g., order, payment, transfer)'
        },
        entity_id: {
          type: 'string',
          description: 'Optional entity identifier for audit correlation'
        },
        correlation_id: {
          type: 'string',
          description: 'Correlation ID for tracing related events'
        }
      },
      required: ['amount'],
    },
  },
  {
    name: 'gaap_khqr_verify_settlement',
    description: 'Verify KHQR payment settlement status via Bakong. Use after generating a KHQR code to check if payment has been completed. Returns settlement confirmation with transaction details.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        md5: {
          type: 'string',
          description: 'MD5 hash returned from gaap_khqr_generate'
        },
        txn_ref: {
          type: 'string',
          description: 'Transaction reference returned from gaap_khqr_generate'
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds for the verification request. Default: 5000'
        },
        correlation_id: {
          type: 'string',
          description: 'Correlation ID for tracing related events'
        }
      },
      required: ['md5', 'txn_ref'],
    },
  },
  {
    name: 'gaap_policy_publish_intent',
    description: 'Publish payment intent to CamDX X-Road for regulatory compliance. Required for AML/CFT monitoring. Call after order confirmation to register the transaction with Cambodia\'s interoperability platform.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        order_id: {
          type: 'string',
          description: 'Unique order identifier'
        },
        merchant_id: {
          type: 'string',
          description: 'Merchant identifier (e.g., MER-2025-001)'
        },
        amount: {
          type: 'number',
          description: 'Transaction amount'
        },
        currency: {
          type: 'string',
          description: 'Currency code: USD or KHR. Default: USD'
        },
        amount_band: {
          type: 'string',
          description: 'Amount band from policy evaluation: A (≤$10), B ($10-50), C ($50-500), D (>$500)'
        },
        identity_level: {
          type: 'string',
          description: 'Customer identity level: anonymous, basic, verified, or high_assurance'
        },
        items: {
          type: 'array',
          description: 'Optional array of order items with name, quantity, and unit_price',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              quantity: { type: 'number' },
              unit_price: { type: 'number' }
            }
          }
        },
        customer_id: {
          type: 'string',
          description: 'Optional customer identifier for tracking'
        },
        camdigi_key_id: {
          type: 'string',
          description: 'Optional CamDigiKey ID if customer is verified'
        },
        correlation_id: {
          type: 'string',
          description: 'Correlation ID for tracing related events'
        }
      },
      required: ['order_id', 'merchant_id', 'amount'],
    },
  },
  // Future tools:
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

  // Special validation for gaap_audit_log_event (single vs batch mode)
  if (name === 'gaap_audit_log_event') {
    const batchMode = args?.batch_mode as boolean;
    if (batchMode) {
      // Batch mode: require events array
      if (!args?.events || !Array.isArray(args.events) || args.events.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'Error: batch_mode=true requires non-empty events[] array',
          }],
          isError: true,
        };
      }
    } else {
      // Single event mode: require event_type, entity_type, entity_id
      if (!args?.event_type || !args?.entity_type || !args?.entity_id) {
        return {
          content: [{
            type: 'text',
            text: 'Error: Single event mode requires event_type, entity_type, and entity_id. Use batch_mode=true with events[] for bulk operations.',
          }],
          isError: true,
        };
      }
    }
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
