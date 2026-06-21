# @ifcdc/payments

Payment processing library for IFCDC applications.

## Features

- Stripe payment intents
- Webhook verification
- Currency formatting utilities

## Usage

```typescript
import { createStripePayments } from "@ifcdc/payments";

const payments = createStripePayments({ secretKey: process.env.STRIPE_SECRET_KEY! });
const result = await payments.createPaymentIntent({
  amount: 49.99,
  currency: "usd",
  description: "IFCDC service payment",
});
```
