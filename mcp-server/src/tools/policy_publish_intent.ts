/**
 * Policy Publish Intent Tool Definition
 * GaaP Layer: L2 (Interoperability/CamDX)
 *
 * Publishes payment intent to CamDX X-Road for regulatory compliance.
 * Required for AML/CFT monitoring of commerce transactions.
 */

export const POLICY_PUBLISH_INTENT_TOOL = {
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
};
