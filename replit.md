# IFCDC Health System API

## Overview

IFCDC Health System API is a comprehensive management system for the Imperial Foundation Community Development Center. It includes client management, encounter tracking, audit logging, and a public-facing website with Mental Health & Wellness Program information. This is a standalone REST API built with Express and TypeScript, using SQLite for data persistence.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Architecture

**Framework**: Express.js with TypeScript, running on Node.js.

**Database**: SQLite via sqlite/sqlite3 (file: `data/ifcdc.db`)

**Authentication**: JWT-based authentication via `Authorization: Bearer <token>` header

**Project Structure**:
```
├─ server/index.ts      # Main server with all routes
├─ data/ifcdc.db        # SQLite database (auto-created)
└─ public/              # Static HTML pages
   ├─ index.html
   ├─ mental-health.html
   ├─ records-policy.html
   ├─ roi.html
   └─ style.css
```

### Data Storage

**Database Tables**:
- `users` - Staff members with id, name, role, api_key
- `clients` - Client records with full_name, date_of_birth, contact_info, programs
- `encounters` - Visit/encounter logs linked to clients and staff
- `audit_logs` - Complete audit trail of all API actions

### Development Commands

- `npm run dev` - Start development server
- `npm run start` - Run production server

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
- `POST /api/clients` - Create client (EXEC, CLINICIAN, CASE_MANAGER)
- `GET /api/clients` - List all clients (EXEC, CLINICIAN, CASE_MANAGER)
- `GET /api/clients/:id` - Get client by ID (EXEC, CLINICIAN, CASE_MANAGER)
- `POST /api/clients/:id/encounters` - Add encounter/visit (EXEC, CLINICIAN, CASE_MANAGER, CHW)
- `GET /api/clients/:id/encounters` - Get client encounters (EXEC, CLINICIAN, CASE_MANAGER)
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
