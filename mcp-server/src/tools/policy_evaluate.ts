/**
 * Policy Evaluate Tool Definition
 * GaaP Layer: L2 (Interoperability/CamDX)
 *
 * Evaluates CamDX policy decisions based on transaction amount bands
 * and identity levels. Used for compliance routing before order creation.
 */

export const POLICY_EVALUATE_TOOL = {
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
        enum: ['USD', 'KHR'],
        description: 'Currency code (USD or KHR). Default: USD'
      },
      identity_level: {
        type: 'string',
        enum: ['anonymous', 'basic', 'verified', 'high_assurance'],
        description: 'Current identity verification level of the user. Default: anonymous'
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
};
