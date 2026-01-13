/**
 * KHQR Verify Settlement Tool Definition
 * GaaP Layer: L3 (Payments/Bakong)
 *
 * Verifies payment settlement status by querying Bakong API with MD5 hash.
 * Used after gaap_khqr_generate to confirm payment completion.
 */

export const KHQR_VERIFY_SETTLEMENT_TOOL = {
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
};
