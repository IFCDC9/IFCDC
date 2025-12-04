# IFCDC Manual API

## Overview

IFCDC Manual API is a Policy Acknowledgement System for managing policy chapters and tracking user acknowledgements. Staff members can view policy chapters and track which policies have been acknowledged. This is a standalone REST API built with Express and TypeScript, using PostgreSQL for data persistence via Prisma ORM.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Architecture

**Framework**: Express.js with TypeScript, running on Node.js.

**API Design**: RESTful API with the following endpoint structure:
- `GET /` - API status check
- `/health` - Health check endpoints
- `/auth/*` - Authentication endpoints (login, register)
- `/chapters/*` - Chapter CRUD operations
- `/users/*` - User management
- `/acknowledgements/*` - Policy acknowledgement tracking

**Route Organization**: Routes are organized into separate files:
- `server/routes/health.routes.ts` - Health check endpoints
- `server/routes/auth.routes.ts` - Authentication (register, login)
- `server/routes/chapters.routes.ts` - Chapter CRUD
- `server/routes/users.routes.ts` - User management
- `server/routes/acknowledgements.routes.ts` - Acknowledgement tracking
- `server/routes/index.ts` - Route registration

**Data Access Layer**: Storage abstraction pattern with an `IStorage` interface implemented by `DatabaseStorage`, allowing for potential storage backend changes without affecting business logic.

**ORM**: Prisma 7 with driver adapters for type-safe database operations and schema management.

**Validation**: Zod schemas for runtime type validation, shared between frontend and backend via the `shared/` directory.

**Authentication**: 
- bcryptjs for password hashing
- Session-based authentication (infrastructure present in dependencies)

### Data Storage

**Database**: PostgreSQL accessed via Prisma with @prisma/adapter-pg.

**Schema Design** (Prisma models):
- `User` - Staff members with name, email, password, role (admin/director/staff), active status
- `Chapter` - Policy chapters with number, title, section, slug, body content, version, and active status
- `PolicyAcknowledgement` - Tracks which users acknowledged which policy versions
- Foreign key relationships with cascade delete on user/chapter deletion

**Connection Management**: Connection pooling via `pg` Pool with PrismaPg adapter.

**Migrations**: Prisma Migrate for schema migrations, stored in `prisma/migrations/` directory.

**Prisma Commands**:
- `npx prisma migrate dev` - Create and apply migrations
- `npx prisma db push` - Push schema changes directly
- `npx prisma generate` - Regenerate Prisma client

### Configuration

**Environment Configuration**: `server/config/env.ts` exports configuration from environment variables:
- `port` - Server port (default: 5000)
- `nodeEnv` - Node environment
- `databaseUrl` - PostgreSQL connection string
- `jwtSecret` - JWT secret for authentication

### Shared Code

**Location**: `shared/` directory containing TypeScript code used by the API.

**Schema Definitions**: Zod validation schemas defined once and shared across the stack, ensuring type safety and validation consistency.

**Import Pattern**: Path aliases configured for clean imports:
- `@shared/` maps to shared directory

### Development Commands

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Run production build
- `npm run check` - TypeScript type checking

### API Endpoints

#### Root
- `GET /` - Returns `{ status: "IFCDC Manual API online" }`

#### Health
- `GET /health` - Health check with timestamp and uptime
- `GET /health/ready` - Readiness check

#### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login user

#### Chapters
- `GET /chapters` - List all chapters with acknowledgement counts
- `GET /chapters/active` - List active chapters only
- `GET /chapters/:id` - Get chapter by ID
- `POST /chapters` - Create new chapter
- `PATCH /chapters/:id` - Update chapter
- `DELETE /chapters/:id` - Delete chapter

#### Users
- `GET /users` - List all users
- `GET /users/:id` - Get user by ID

#### Acknowledgements
- `GET /acknowledgements` - Get acknowledgement statistics
- `GET /acknowledgements/user/:userId` - Get user's acknowledgements
- `GET /acknowledgements/chapter/:chapterId` - Get chapter's acknowledgements
- `POST /acknowledgements` - Create acknowledgement

#### Health System API (x-api-key auth)
- `POST /api/users` - Create staff user with role (EXEC only)
- `GET /api/users` - List all users (EXEC only)
- `POST /api/patients` - Create patient/client (EXEC, CLINICIAN, CASE_MANAGER)
- `GET /api/patients` - List all patients (EXEC, CLINICIAN, CASE_MANAGER)
- `GET /api/patients/:id` - Get patient by ID (EXEC, CLINICIAN, CASE_MANAGER)
- `POST /api/patients/:id/encounters` - Add encounter/visit (EXEC, CLINICIAN, CASE_MANAGER, CHW)
- `GET /api/patients/:id/encounters` - Get patient encounters (EXEC, CLINICIAN, CASE_MANAGER)
- `GET /api/audit-logs` - View audit logs (EXEC only)
- `POST /api/generate-exec-key` - Generate API key for EXEC user (requires ADMIN_SECRET env var)

**Staff Roles**: EXEC, CLINICIAN, CASE_MANAGER, CHW, ADMIN

#### Bookings (Barbershop)
- `GET /api/bookings` - List all barbershop bookings
- `POST /api/bookings` - Create a new booking
- `PATCH /api/bookings/:id/status` - Update booking status
- `DELETE /api/bookings/:id` - Delete a booking

#### Twilio Webhooks
- `POST /twiml/voice` - Voice call TwiML handler (routes based on called number)
- `POST /twiml/sms` - SMS TwiML handler (routes based on called number)
- `POST /twiml/voicemail-complete` - Voicemail completion handler

**Twilio Phone Numbers**:
- `+13313168167` - IFCDC Barbershop line (forwards to +17327435048)
- `+18587588791` - IFCDC Radio line (voicemail for shoutouts)
- Default - General IFCDC greeting

**Note**: Twilio integration is configured manually (not using Replit integration). If credentials are needed in the future, they should be stored as TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN secrets.
