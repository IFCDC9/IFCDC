export interface PaymentIntent {
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, string>;
  customerId?: string;
}

export interface PaymentResult {
  success: boolean;
  id?: string;
  clientSecret?: string;
  error?: string;
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret?: string;
}

export function createStripePayments(config: StripeConfig) {
  let stripeInstance: import("stripe").default | null = null;

  async function getStripe() {
    if (!stripeInstance) {
      const Stripe = (await import("stripe")).default;
      stripeInstance = new Stripe(config.secretKey);
    }
    return stripeInstance;
  }

  return {
    async createPaymentIntent(intent: PaymentIntent): Promise<PaymentResult> {
      try {
        const stripe = await getStripe();
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(intent.amount * 100),
          currency: intent.currency,
          description: intent.description,
          metadata: intent.metadata,
          customer: intent.customerId,
        });
        return {
          success: true,
          id: paymentIntent.id,
          clientSecret: paymentIntent.client_secret ?? undefined,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Payment failed",
        };
      }
    },

    async verifyWebhook(payload: string | Buffer, signature: string): Promise<unknown | null> {
      if (!config.webhookSecret) return null;
      try {
        const stripe = await getStripe();
        return stripe.webhooks.constructEvent(payload, signature, config.webhookSecret);
      } catch {
        return null;
      }
    },
  };
}

export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}
