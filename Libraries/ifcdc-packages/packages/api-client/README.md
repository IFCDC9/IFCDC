# @ifcdc/api-client

Typed HTTP client for IFCDC API communication.

## Usage

```typescript
import { createApiClient } from "@ifcdc/api-client";

const api = createApiClient({ baseUrl: "https://api.ifcdc.org", token: jwt });
const { data, error } = await api.get<User>("/api/users/me");
```
