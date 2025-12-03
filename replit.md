# ChapterForm Admin

## Overview

ChapterForm Admin is a Policy Acknowledgement System for managing policy chapters and tracking user acknowledgements. Staff members can view policy chapters and track which policies have been acknowledged. Built with a modern React frontend and Express backend, it uses PostgreSQL for data persistence and includes authentication for secure access.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript using Vite as the build tool and development server.

**UI Component Library**: shadcn/ui components built on Radix UI primitives, providing a comprehensive set of accessible, customizable components with Tailwind CSS styling.

**Routing**: wouter for client-side routing, a lightweight alternative to React Router.

**State Management**: 
- TanStack Query (React Query) for server state management, caching, and data synchronization
- Local component state using React hooks

**Styling**: 
- Tailwind CSS with custom theme configuration
- CSS variables for dynamic theming
- Custom design tokens defined in index.css with support for dark mode

**Design Pattern**: The frontend follows a component-based architecture with:
- Page components in `client/src/pages/` for each route
- Reusable UI components in `client/src/components/ui/`
- Shared layout component for consistent navigation and structure
- API client abstraction in `client/src/lib/api.ts`

### Backend Architecture

**Framework**: Express.js with TypeScript, running on Node.js.

**API Design**: RESTful API with the following endpoint structure:
- `/api/auth/*` - Authentication endpoints (login, register)
- `/api/chapters/*` - Chapter CRUD operations
- `/api/users/*` - User management
- `/api/acknowledgements/*` - Policy acknowledgement tracking

**Data Access Layer**: Storage abstraction pattern with an `IStorage` interface implemented by `DatabaseStorage`, allowing for potential storage backend changes without affecting business logic.

**ORM**: Prisma 7 with driver adapters for type-safe database operations and schema management.

**Validation**: Zod schemas for runtime type validation, shared between frontend and backend via the `shared/` directory.

**Authentication**: 
- bcryptjs for password hashing
- Session-based authentication (infrastructure present in dependencies)

**Build Strategy**: 
- esbuild for server bundling with selective dependency bundling
- Vite for client bundling
- Custom build script that bundles allowlisted dependencies to reduce cold start times

**Development Environment**:
- Vite middleware for HMR in development
- Custom logging middleware for request tracking
- Replit-specific plugins for development experience

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

### External Dependencies

**Database Service**: 
- Neon PostgreSQL serverless database
- Requires `DATABASE_URL` environment variable for connection

**UI Component Libraries**:
- Radix UI for accessible, unstyled component primitives
- Lucide React for icons
- cmdk for command palette functionality

**Development Tools**:
- Replit-specific plugins for dev banner, cartographer, and runtime error overlay
- Custom Vite plugin for OpenGraph image meta tag management

**Third-party Services Integration Points**:
- Session store ready (connect-pg-simple in dependencies)
- Authentication infrastructure prepared for expansion

### Shared Code

**Location**: `shared/` directory containing TypeScript code used by both frontend and backend.

**Schema Definitions**: Zod validation schemas defined once and shared across the stack, ensuring type safety and validation consistency.

**Import Pattern**: Path aliases configured for clean imports:
- `@/` maps to client source
- `@shared/` maps to shared directory
- `@assets/` maps to attached_assets directory

### Prisma 7 Configuration

The project uses Prisma 7 with the new adapter-based approach:

**Schema Location**: `prisma/schema.prisma`
**Generated Client**: `generated/prisma/`
**Config File**: `prisma.config.ts`

**Key Changes from Drizzle**:
- Schema defined in Prisma Schema Language (PSL)
- Driver adapters required (using @prisma/adapter-pg)
- Types imported from generated client path
