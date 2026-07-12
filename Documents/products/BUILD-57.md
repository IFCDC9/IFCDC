# IFCDC HQ — Build 57: Enterprise Document Management Suite

**Status:** Implemented (July 12, 2026)  
**Goal:** Make Document Management the central enterprise repository for every HQ document.

## Delivered

### Document Library (`/hq/documents`)
- Centralized vault with drag-and-drop uploads (up to 50 MB)
- MIME support: PDF, Word, Excel, PowerPoint, images, video, audio, ZIP, CSV, text
- Organize by department, program, project, category, tags, labels, custom metadata
- Visibility: private · shared · department · organization

### Search & Filtering
- Enterprise search across title, tags, labels, OCR text, program/project IDs
- Filters: department, program, project, category, file type, dates, owner, status, visibility, tag
- Search index table (`hq_document_search_index`) with reindex endpoint

### Preview
- In-app PDF viewer, images, text, video, and audio playback
- Office documents: clear download path (native browser preview not supported for DOCX/XLSX/PPTX)

### Version Control
- Automatic version history, restore previous versions, change notes, uploader attribution

### Permissions & Security
- New permission: `hq.documents` (department roles can access the vault)
- Module gate: `documents` (broader than settings-only)
- Access levels + visibility ACL
- Secure download endpoint with activity logging
- Full activity audit (view, upload, version, restore, approve, archive, download)

### Integrations
Vault deep-links from:
- Grant Center
- Executive Dashboard
- Finance
- HR / People
- Programs
- Compliance (policies)
- Board Portal
- Contracts / Reports categories
- Enterprise Reporting Center

## APIs
- `GET /api/hq/documents/` — filtered library list + facets
- `GET /api/hq/documents/search`
- `GET /api/hq/documents/overview` · `/library`
- `GET /api/hq/documents/modules` · `/modules/:id`
- `POST /api/hq/documents/upload`
- `POST /api/hq/documents/:id/download`
- `GET /api/hq/documents/:id/activity`
- `POST /api/hq/documents/reindex`
- Existing version / approval / archive / OCR routes retained

## Engine
`server/hq/documentEnterpriseEngine.ts`

## Deploy
1. Push `main`
2. Render Manual Deploy
3. Verify `/hq/documents` upload, search, preview, version restore, and module links

## Next
**Build 58 — Enterprise Quality Assurance & System Hardening** → see `BUILD-58.md` (shipped)  
**Build 59 — Grant Center Foundation**
