import { AuthConfig, generateAuthHeaders } from './auth.js';

const GAAP_MCP_URL = process.env.GAAP_MCP_URL || 'https://automation.omnidm.ai/webhook/gaap-mcp/invoke';

export interface GaapRequest {
  tool: string;
  tenant_context: {
    tenant_id: string;
    correlation_id?: string;
  };
  params: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface GaapResponse {
  success: boolean;
  result?: {
    data: Record<string, unknown>;
    audit_event_id?: string;
    correlation_id?: string;
  };
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
    suggested_action?: string;
  };
  meta: {
    request_id: string;
    execution_ms: number;
    gaap_layer: string;
    camdl_anchored: boolean;
  };
}

/**
 * Invoke a GaaP MCP tool via the HTTP API.
 * Handles authentication, request signing, and error parsing.
 */
export async function invokeGaapTool(
  config: AuthConfig,
  request: GaapRequest
): Promise<GaapResponse> {
  const body = JSON.stringify(request);
  const headers = generateAuthHeaders(config, body);

  try {
    const response = await fetch(GAAP_MCP_URL, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: `HTTP error: ${response.status} ${response.statusText}`,
          recoverable: response.status >= 500,
        },
        meta: {
          request_id: 'unknown',
          execution_ms: 0,
          gaap_layer: 'MCP',
          camdl_anchored: false,
        },
      };
    }

    return response.json() as Promise<GaapResponse>;
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Unknown network error',
        recoverable: true,
      },
      meta: {
        request_id: 'unknown',
        execution_ms: 0,
        gaap_layer: 'MCP',
        camdl_anchored: false,
      },
    };
  }
}
