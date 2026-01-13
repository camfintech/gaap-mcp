/**
 * KHQR Generate Tool Definition
 * GaaP Layer: L3 (Payments)
 *
 * Generates Cambodia KHQR payment codes via Bakong API
 */

export const KHQR_GENERATE_TOOL = {
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
        enum: ['USD', 'KHR'],
        description: 'Currency code (USD or KHR). Default: USD'
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
        description: 'Merchant ID from acquiring bank (required for merchant QR)'
      },
      qr_type: {
        type: 'string',
        enum: ['individual', 'merchant'],
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
};
