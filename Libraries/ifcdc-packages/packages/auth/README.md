# @ifcdc/auth

Shared authentication library for IFCDC applications.

## Features

- JWT token signing and verification
- Password hashing with bcrypt
- Express authentication middleware
- Configurable token expiration

## Usage

```typescript
import { createAuthService, createAuthMiddleware } from "@ifcdc/auth";

const auth = createAuthService({ jwtSecret: process.env.JWT_SECRET! });
const token = auth.signToken({ userId: 1, role: "admin" });

const authMiddleware = createAuthMiddleware({ jwtSecret: process.env.JWT_SECRET! });
app.use("/api/protected", authMiddleware);
```
