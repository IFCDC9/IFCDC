# @ifcdc/notifications

Unified notification service for IFCDC applications.

## Channels

- Email (via custom provider)
- SMS (via Twilio)
- Push / in-app (local queue)

## Usage

```typescript
import { createNotificationService, createTwilioSmsProvider } from "@ifcdc/notifications";

const notifications = createNotificationService({
  sms: createTwilioSmsProvider(sid, token, fromNumber),
});

await notifications.send({
  to: "+15551234567",
  body: "Your appointment is confirmed.",
  channel: "sms",
});
```
