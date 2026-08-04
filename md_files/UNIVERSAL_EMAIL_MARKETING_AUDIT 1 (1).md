# Email Marketing Module Technical Specification
## For Integration into Growth Hacker App

**Version:** 1.0  
**Date:** 2026-07-06  
**Status:** Draft for Development Team  

---

## 1. Overview

The Email Marketing Module enables automated, AI‑powered audits of any website’s email marketing health. It covers multiple subtypes (Lead Capture, Deliverability, Compliance, etc.), generates actionable recommendations, and manages follow‑up tasks. The module also provides a rollup dashboard for tracking all audits and their outcomes, plus two‑way email communication with the audited client.

### 1.1 Goals
- Provide a self‑service audit tool for users to check and improve their email marketing.
- Deliver personalised, actionable reports (PDF/Markdown) with AI‑drafted executive summaries.
- Track audit status, scores, and tasks via a central dashboard.
- Enable automated email delivery and inbound reply handling.

### 1.2 Integration with Growth Hacker App
- Reuse existing user authentication (JWT or session).
- Store audit results under each user account.
- Expose REST APIs for the frontend to trigger audits and fetch reports/dashboard data.
- Use existing user notification settings for email reports.

---

## 2. Functional Requirements

### 2.1 Audit Subtypes (Modules)
Users can select one or more of the following audit types:

| **Subtype**               | **Scope**                                                                 |
|---------------------------|---------------------------------------------------------------------------|
| Lead Capture              | Forms, CTAs, pop‑ups, lead magnets, placement                             |
| Deliverability            | SPF, DKIM, DMARC, MX records, blacklist status                            |
| Content & Engagement      | Email copy, design, subject lines, CTAs, personalisation (based on sample)|
| Compliance & Trust        | Privacy policy, GDPR/CAN‑SPAM, unsubscribe link, consent                  |
| Automation & Workflows    | Welcome series, nurture, cart abandonment, re‑engagement                  |
| Conversion Optimization   | Landing pages, pricing pages, social proof, A/B testing readiness         |
| Customer Retention        | Post‑purchase emails, review requests, loyalty, churn prevention          |

*Only selected subtypes are analysed; scores are weighted average of chosen ones.*

### 2.2 User Inputs (via API)
- `website_url`: string (mandatory)
- `subtypes`: array of strings (optional; defaults to all)
- `business_type`: string (SaaS/Ecommerce/Agency etc.) – influences benchmarking and recommendations
- `email_report_to`: string (optional; if not provided, use user’s primary email)
- `additional_context`: string (free text for AI prompting)

### 2.3 Data Collection
- **Web Scraping**: Use Playwright (headless Chromium) to:
  - Load the homepage and up to 3 internal pages (blog, pricing, product).
  - Identify all forms (action, method, inputs, visible text).
  - Detect CTAs (button/link text related to sign‑up).
  - Capture social proof elements (testimonials, logos, user counts).
  - Check for privacy policy, terms, contact page links.
  - Take a screenshot of each page (for later reference).
- **DNS Checks**: Use `dnspython` to resolve and validate:
  - SPF (`TXT` record containing `v=spf1`)
  - DKIM (`TXT` record with `v=DKIM1` – usually selector‑specific)
  - DMARC (`TXT` record `_dmarc.domain`)
  - MX records (for mail server existence)
- **Blacklist Lookup**: Optionally query free APIs (e.g., **Spamhaus**). If paid/rate‑limited, skip but note it.
- **Compliance Verification**:
  - Presence of privacy policy URL, terms, contact page.
  - Scan forms for consent checkboxes (checked by default?).

### 2.4 Analysis Engine
- **Scoring System**: Each subtype has a set of checkpoints with weighted points. Total score = (achieved points / max points) * 100.
  - Example for Lead Capture: +20 for homepage form, +10 for exit‑intent, +15 for lead magnet, etc.
- **Gap Identification**: List all missing critical elements (e.g., missing SPF, no form above fold).
- **Benchmark Comparison**: Compare scores against industry averages (provided as constants) and flag above/below.

### 2.5 AI Drafting Module
- **LLM Backend**: Use locally hosted **Ollama** with Mistral 7B or Llama 3 (no external API cost).
- **Prompt Engineering**: Construct a detailed prompt that includes:
  - Business type, selected subtypes, full list of findings and gaps.
  - Request for: executive summary (2 paragraphs), 5‑7 prioritized recommendations with each containing:
    - Title, problem statement, why it matters, specific solution, expected impact, difficulty (Easy/Medium/Hard), timeline (days/weeks).
  - Tone: professional, actionable, positive.
- **Parsing**: Extract structured data from LLM output using regex or JSON mode (if model supports). Fallback: ask LLM to output JSON.

### 2.6 Report Generation
- **Template**: Use Jinja2 to fill the report structure (based on UNIVERSAL_EMAIL_MARKETING_AUDIT.md).
- **Sections**: Scores per subtype, detailed findings, missing items, AI recommendations, action plan.
- **Formats**: Generate both Markdown (for web preview) and PDF (via WeasyPrint or pandoc).
- **Storage**: Store raw JSON of all data, generated Markdown, and PDF in S3‑compatible storage or filesystem with public/private URLs.

### 2.7 Email Management (Communication)
- **Sending**: Integrate with **Mautic** (self‑hosted) or use a transactional email API (SendGrid/Mailgun free tiers) to send the report to the user.
- **Tracking**: Add tracking pixel (1x1 transparent GIF) and UTM parameters to links. Record open/click events in database.
- **Inbound Replies**: Set up a webhook endpoint that receives email replies (via Mailgun routes or Mautic webhooks). The reply is stored as a note linked to the audit record.
- **Reply Parsing**: Extract sender, subject, body, and any attachments (store as files). Allow frontend to display replies.

### 2.8 Rollup Dashboard & Task Management
- **Dashboard**: Provide endpoints to aggregate:
  - Number of audits per user, average score per subtype, trend over time.
  - List all audits with status (Pending, Running, Completed, Failed).
- **Actionable Tasks**: For each audit, generate a list of tasks (from AI recommendations). Store tasks with:
  - `audit_id`, `title`, `description`, `priority`, `status` (To Do, In Progress, Done), `due_date` (optional).
- **Frontend Integration**: Expose CRUD endpoints for tasks so users can update statuses.

### 2.9 Automation (Optional)
- Schedule periodic re‑audits (e.g., monthly) using Celery Beat. The system can automatically re‑scan and email an updated report if score drops.

---

## 3. Technical Architecture

### 3.1 High‑Level Components

┌───────────────────┐ ┌─────────────────────────────────────────────────┐
│ Frontend (React) │────▶│ Backend (FastAPI) – REST APIs │
└───────────────────┘ │ • /auth (reuse existing) │
│ • /audit – start audit │
│ • /audit/{id} – get report │
│ • /dashboard – aggregations │
│ • /tasks – CRUD │
│ • /webhook/inbound – email replies │
└────────────────┬─────────────────────────────┘
│
┌────────────────▼─────────────────────────────┐
│ Task Queue (Celery + Redis) │
│ • scrape_website │
│ • dns_check │
│ • run_analysis │
│ • generate_ai_recommendations (Ollama) │
│ • render_report │
│ • send_email │
└────────────────┬─────────────────────────────┘
│
┌────────────────▼─────────────────────────────┐
│ External Services │
│ • Playwright (headless browser) │
│ • Ollama (LLM) │
│ • Mautic / SendGrid (email) │
│ • PostgreSQL (metadata, reports) │
│ • Redis (cache, Celery broker) │
└─────────────────────────────────────────────┘

text

### 3.2 Database Schema (Key Tables)

**Users** – existing table (id, email, name, etc.)

**Audits**:
- `id` UUID PK
- `user_id` FK references Users
- `website_url` text
- `subtypes` jsonb (array of strings)
- `business_type` varchar(50)
- `status` enum (pending, running, completed, failed)
- `scores` jsonb (subtype → score)
- `findings` jsonb (structured results)
- `missing_items` jsonb
- `ai_recommendations` jsonb (from LLM)
- `report_markdown` text
- `report_pdf_url` text
- `created_at` timestamp
- `updated_at` timestamp
- `error_log` text (if failed)

**Tasks**:
- `id` UUID PK
- `audit_id` FK
- `title` text
- `description` text
- `priority` enum (high, medium, low)
- `status` enum (todo, in_progress, done)
- `due_date` date (nullable)
- `created_at` timestamp

**Notes** (for email replies and internal comments):
- `id` UUID PK
- `audit_id` FK
- `user_id` FK (who wrote it, or null for system replies)
- `content` text
- `is_inbound` boolean (true if from email reply)
- `sender_email` text (for inbound)
- `attachment_urls` jsonb (array)
- `created_at` timestamp

**EmailTracking**:
- `id` UUID PK
- `audit_id` FK
- `recipient_email` text
- `open_count` int
- `click_count` int
- `last_opened_at` timestamp
- `last_clicked_at` timestamp
- `opens` jsonb (timeline)

### 3.3 API Endpoints (Draft)

All endpoints under `/api/v1/email-marketing/`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/audits` | Start a new audit (async). Returns audit_id. |
| GET | `/audits` | List audits for the authenticated user. |
| GET | `/audits/{id}` | Get full audit report (includes scores, findings, recommendations). |
| GET | `/audits/{id}/tasks` | Get all tasks for this audit. |
| PUT | `/tasks/{id}` | Update task status or details. |
| GET | `/dashboard` | Aggregated stats (total audits, average scores, etc.). |
| POST | `/webhook/inbound` | Inbound email webhook (Mailgun/Mautic). |
| GET | `/track/open/{tracking_id}` | Tracking pixel (returns 1x1 GIF). |
| GET | `/track/click/{tracking_id}?url=...` | Redirect to target URL, log click. |

### 3.4 Celery Task Definitions

- `scrape_website(audit_id, url)` – runs Playwright, saves HTML fragments and screenshots.
- `check_dns(audit_id, domain)` – checks SPF, DKIM, DMARC, MX; stores results.
- `run_analysis(audit_id, subtypes, scraped_data, dns_data)` – computes scores and gaps.
- `generate_ai_recommendations(audit_id, business_type, findings, missing)` – calls Ollama, parses JSON, saves.
- `render_report(audit_id)` – generates Markdown and PDF, stores URLs.
- `send_report_email(audit_id, email)` – sends email with PDF attachment and tracking.

---

## 4. Implementation Plan (Phases)

### Phase 0: Setup
- Provision PostgreSQL, Redis, and a worker server.
- Install Playwright, Ollama, and required Python packages.
- Configure Mautic (or email provider) and set up webhook endpoints.

### Phase 1: Core Scraping & DNS (Weeks 1–2)
- Build `scrape_website` and `check_dns` tasks.
- Store raw data in JSON fields in `Audits`.
- Create basic FastAPI endpoints to trigger and retrieve status.

### Phase 2: Analysis & Scoring (Week 3)
- Implement scoring logic for each subtype with defined weights.
- Add gap detection.
- Write unit tests.

### Phase 3: AI Integration (Week 4)
- Set up Ollama and test prompt engineering.
- Build `generate_ai_recommendations` task.
- Parse LLM output into structured JSON.

### Phase 4: Report Generation (Week 5)
- Design Jinja2 templates for all sections.
- Generate Markdown and PDF.
- Store in database/filesystem.

### Phase 5: Email & Tracking (Week 6)
- Integrate with Mautic or SendGrid.
- Implement tracking pixel and click redirect.
- Set up inbound webhook for replies.

### Phase 6: Dashboard & Tasks (Week 7)
- Build dashboard APIs.
- Implement task CRUD.
- Connect to frontend (coordination with FE team).

### Phase 7: Testing, Documentation, Deployment (Week 8)
- End‑to‑end tests.
- API documentation (OpenAPI).
- Deployment scripts (Docker Compose).

---

## 5. Open‑Source Tool Stack

| **Component**          | **Tool**                          | **Purpose**                               |
|------------------------|-----------------------------------|-------------------------------------------|
| **Web Scraping**       | Playwright (Python)               | Headless browser for JavaScript‑rendered sites |
| **DNS**                | dnspython                         | Query DNS records                         |
| **LLM**                | Ollama (with Mistral/Llama 3)     | Local AI recommendations                  |
| **Backend**            | FastAPI + Python 3.10+            | REST API, async support                   |
| **Database**           | PostgreSQL (or SQLite for dev)    | Relational data store                     |
| **Queue**              | Celery + Redis                    | Async task processing                     |
| **Email**              | Mautic (self‑hosted)              | Campaigns, automation, tracking, webhooks |
| **Or**                 | SendGrid / Mailgun (free tiers)   | Simpler email delivery and inbound        |
| **PDF Generation**     | WeasyPrint / pandoc               | Convert Markdown to PDF                   |
| **Monitoring**         | Prometheus + Grafana (optional)   | Health metrics                            |
| **Frontend (if new)**  | React + Vite (or existing)        | User interface for audits and dashboard   |

---

## 6. Integration with Existing Growth Hacker App

### 6.1 Authentication
- The module should reuse the existing user authentication middleware (JWT tokens).
- All API calls must include the token; the backend extracts `user_id` from token.

### 6.2 UI Integration
- The frontend team should add a new section (menu item) for "Email Marketing Audit".
- The UI will:
  - Display a form to input website URL and select subtypes.
  - Show a list of previous audits with status.
  - Allow viewing detailed reports (preview Markdown/PDF).
  - Display tasks and allow status updates.
  - Show a dashboard with summary metrics.

### 6.3 Notification Hooks
- Use existing notification service to send alerts when audits complete.

### 6.4 Data Ownership
- All audit data belongs to the user; no sharing without explicit consent.

---

## 7. Actionable Item Generation

For each recommendation from AI, the system must create a task. We will define a mapping from recommendation fields to task attributes:

- **Title**: recommendation title
- **Description**: problem + solution
- **Priority**: from recommendation’s “difficulty” (Easy→Low, Medium→Medium, Hard→High)
- **Status**: always “todo” initially

Tasks are stored in the `Tasks` table and are exposed via the API for the frontend to display as a checklist.

---

## 8. Security & Privacy Considerations

- All user inputs (URLs, additional context) are sanitised to prevent injection attacks.
- Scraping respects `robots.txt` and uses reasonable delays to avoid overloading target sites.
- Email tracking adheres to privacy laws; we only track opens/clicks of our own emails.
- Data retention policy: Audit reports are kept for 1 year (configurable); tasks and notes remain.
- LLM runs locally, so user data is not sent to third parties.

---

## 9. Testing Requirements

- **Unit tests**: For scoring, DNS parsing, report generation.
- **Integration tests**: With Playwright on a dummy test website.
- **End‑to‑end**: Trigger a full audit and verify output matches expectations.
- **Performance**: Ensure scraping timeout (e.g., 30s) and queuing works under load.

---

## 10. Deployment Strategy

- Dockerise all services (backend, worker, Ollama, Redis, PostgreSQL, Mautic).
- Use docker‑compose for local development and staging.
- For production, use Kubernetes or a cloud VM with enough RAM for Ollama (≥16GB recommended).

---

## 11. Documentation

- API documentation will be auto‑generated with FastAPI’s OpenAPI.
- Provide a developer guide for setting up local environment.
- Provide an admin guide for monitoring and troubleshooting.

---

## 12. Glossary

- **SPF**: Sender Policy Framework – prevents email spoofing.
- **DKIM**: DomainKeys Identified Mail – digital signature.
- **DMARC**: Domain‑based Message Authentication, Reporting & Conformance.
- **Lead Magnet**: Free resource offered in exchange for email address.
- **Exit‑Intent Popup**: A modal triggered when user moves cursor to close tab.

---

## 13. Next Steps for Dev Team

1. **Review** this spec and raise questions/concerns.
2. **Setup** the local development environment (Python, PostgreSQL, Redis, Playwright, Ollama).
3. **Implement Phase 1** as a proof‑of‑concept (scraping + DNS) and demo.
4. **Iterate** with product team on scoring weights and UI mockups.
5. **Proceed** with subsequent phases in parallel with frontend development.

---

**Contact**: For technical clarifications, reach out to the project lead / architect.

---
**END OF DOCUMENT**