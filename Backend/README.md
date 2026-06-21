# Backend Services

Standalone APIs, microservices, and backend infrastructure for the IFCDC ecosystem.

## Structure

Place new backend services here:

```
Backend/
├── api-gateway/       # Central API gateway
├── auth-service/      # Dedicated authentication service
└── webhook-handler/   # Payment and event webhooks
```

## Note

Most IFCDC applications currently use integrated Express backends within their app directories under `Apps/`. As the ecosystem scales, shared backend services will be extracted here.
