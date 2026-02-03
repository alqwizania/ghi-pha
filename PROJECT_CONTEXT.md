# GHI System - Project Context

## 📋 Project Overview

**Global Health Intelligence (GHI) System** is a real-time disease surveillance and outbreak detection platform developed for the **Public Health Authority (PHA)** of Saudi Arabia.

The system automates the collection, analysis, and escalation of global health threats through a structured intelligence workflow: **Signal Collection → Triage → Risk Assessment → Emergency Escalation**.

---

## 🎯 Project Goals

1. **Automated Intelligence Collection**: Continuously monitor global disease outbreaks via Beacon Bio's epidemiological intelligence feed.
2. **Risk-Based Triage**: Enable analysts to rapidly accept/reject incoming signals based on priority scoring.
3. **Structured Risk Assessment**: Implement WHO's IHR (International Health Regulations) and RRA (Rapid Risk Assessment) frameworks for systematic threat evaluation.
4. **Emergency Escalation**: Provide a formal escalation pathway for critical public health emergencies requiring immediate response.
5. **Professional UI/UX**: Deliver a modern, glassmorphic interface with PHA branding optimized for technical intelligence analysis.

---

## ✅ Completed Features

### Backend (Cloudflare Workers + Hono)
- ✅ RESTful API with authentication (JWT)
- ✅ PostgreSQL database integration (Neon via Hyperdrive)
- ✅ Automated Beacon Bio collector (6-hour cron schedule)
- ✅ De-duplication logic to prevent duplicate signals
- ✅ User management with role-based permissions
- ✅ Signal → Assessment → Escalation workflow APIs

### Frontend (React + Vite + Tailwind)
- ✅ Login view with PHA branding
- ✅ Interactive global health signals map (react-simple-maps)
- ✅ Dashboard with real-time metrics and sparklines
- ✅ Triage view (Accept/Reject workflow)
- ✅ Assessment view (IHR Matrix + RRA Form)
- ✅ Escalation management view
- ✅ Personnel management (User CRUD)
- ✅ Mobile-responsive design with adaptive layouts
- ✅ Glass-morphism design system

### Intelligence Collection
- ✅ Beacon Bio integration via Jina AI proxy (bypasses 403 blocks)
- ✅ Markdown parsing for event extraction
- ✅ Priority scoring algorithm (disease type, location, case count)
- ✅ Automatic database synchronization

### Branding & UX
- ✅ PHA (وقاية) logo integration
- ✅ DIN Next LT Pro typography unification
- ✅ Global fixed footer with authority branding
- ✅ System Architect attribution with hover reveal
- ✅ Readability audit (10-11px minimum font sizes)

---

## 🛡️ Rules & Constraints for AI Agents

### Authentication & Security
- **Email Domain Enforcement**: All user accounts MUST use `@pha.gov.sa` email addresses.
- **Password Storage**: Currently using plain-text passwords (development only). DO NOT deploy to production without proper hashing (bcrypt/argon2).
- **JWT Secret**: Must be rotated before production deployment.

### Design System
- **Typography**: Use **DIN Next LT Pro** font family exclusively. Fallback: `system-ui`.
- **Font Sizes**: Minimum 10px for technical labels, 11px for body text. Never use sizes below 8px.
- **Color Palette**:
  - Primary: `#00F2FF` (ghi-teal)
  - Critical: `#FF3131` (ghi-critical)
  - Warning: `#F4B400` (ghi-warning)
  - Success: `#39FF14` (ghi-success)
  - Background: `#0A0F1C` (ghi-navy)
- **Glass-morphism**: Use `glass-panel` utility class for cards and containers.
- **Spacing**: Use Tailwind's standard spacing scale. Avoid arbitrary values unless absolutely necessary.

### Code Quality
- **No Hardcoded Values**: Use environment variables for sensitive data (DATABASE_URL, JWT_SECRET, API endpoints).
- **TypeScript Strict Mode**: Maintain type safety. Avoid `@ts-ignore` unless documenting a known limitation.
- **Component Structure**: Keep components under 300 lines. Extract reusable logic into hooks or utilities.
- **Naming Conventions**: 
  - Components: PascalCase (e.g., `UserManagement.tsx`)
  - Utilities: camelCase (e.g., `calculatePriority`)
  - Database tables: snake_case (e.g., `beacon_event_id`)

### Database
- **Schema Migrations**: Use Drizzle Kit for all schema changes (`npm run db:generate` → `npm run db:push`).
- **Foreign Keys**: Always define relationships explicitly in the schema.
- **Timestamps**: Include `createdAt` and `updatedAt` for all core tables.

### Intelligence Collection
- **De-duplication**: ALWAYS check for existing `beaconEventId` before inserting new signals.
- **Error Handling**: Log collection errors but do not crash the worker. The next scheduled run should recover.
- **Priority Scoring**: Update the algorithm in `beacon-collector.ts` if new threat criteria are identified.

### Deployment
- **Frontend**: Deployed to Cloudflare Pages via `npm run build` + `wrangler pages deploy ./dist`.
- **Backend**: Deployed to Cloudflare Workers via `npm run deploy` in the backend directory.
- **Cron Schedule**: Configured in `wrangler.toml` as `0 */6 * * *` (every 6 hours).

---

## 📂 Project Structure

```
GHI System/
├── backend/
│   ├── src/
│   │   ├── db/schema.ts          # Drizzle ORM schema
│   │   ├── services/
│   │   │   └── beacon-collector.ts  # Automated intelligence collection
│   │   └── index.ts              # Hono API + cron trigger
│   ├── test-collector.ts         # Manual collection test script
│   ├── wrangler.toml             # Cloudflare Workers config
│   └── .env                      # Environment variables
├── frontend/
│   ├── src/
│   │   ├── views/                # Main application views
│   │   ├── lib/api.ts            # API client
│   │   └── App.tsx               # Root component
│   ├── public/
│   │   └── pha-logo.png          # PHA branding asset
│   └── index.css                 # Global styles + design tokens
└── PROJECT_CONTEXT.md            # This file
```

---

## 🚀 Quick Start for AI Agents

1. **Review the schema**: Start by reading `backend/src/db/schema.ts` to understand the data model.
2. **Check the API**: Review `backend/src/index.ts` for available endpoints.
3. **Understand the workflow**: Signals → Triage → Assessment → Escalation.
4. **Follow the design system**: Use existing components and styles as references.
5. **Test locally**: Run `npm run dev` in both `frontend/` and `backend/` directories.
6. **Verify collector**: Run `npx tsx test-collector.ts` to test intelligence collection.

---

## 📊 Current Deployment

- **Frontend**: https://ghi-pha.pages.dev
- **Backend API**: https://ghi-core.rads-pha.workers.dev
- **Database**: Neon PostgreSQL (eu-west-2)
- **Cron Status**: Active (every 6 hours)

---

## 📝 Notes for Future Development

- **Mobile Optimization**: Personnel view uses card layout on mobile. Apply similar patterns to other tables if needed.
- **Accessibility**: Ensure all interactive elements have proper ARIA labels and keyboard navigation.
- **Internationalization**: Consider Arabic RTL support if required by PHA.
- **Analytics**: Implement tracking for signal processing times and escalation rates.
- **Testing**: Add unit tests for critical workflows (authentication, triage, escalation).

---

*Last Updated: 2026-02-03*  
*Maintained by: Global Health Intelligence Development Team*
