# EventwithEase

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas%2Flocal-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)

**EventwithEase** is a production-style event ticketing platform: organisers publish events and ticket types, attendees browse and book (including QR passes and optional Stripe checkout), and hosts run **live check-in**, refunds, reviews, and lightweight analytics — all in a single full-stack codebase.

---

## Table of contents

- [Why this project](#why-this-project)
- [Capabilities](#capabilities)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Scripts & tooling](#scripts--tooling)
- [API surface (overview)](#api-surface-overview)
- [Client routes](#client-routes)
- [Demo data](#demo-data)
- [Deployment](#deployment)
- [Security & operations](#security--operations)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Why this project

- **End-to-end flow** from catalogue → booking → QR ticket → door scan → attendee status update  
- **Role-aware UX**: attendee paths (`/tickets`, `/event/:id`) stay separate from organiser tools (`/organise`, `/check-in`)  
- **Deployable defaults**: CORS, env-driven API URL, SPA rewrites on Vercel, Node service on Render (or any host)  
- **Demo-ready**: seed script for a rich catalogue, reviews, bookings, and crowd accounts  

---

## Capabilities

| Area | Highlights |
|------|------------|
| **Attendees** | JWT + optional Google OAuth, wishlist, discounts, waitlist, **My tickets** with QR, public reviews + private organiser feedback, networking opt-in for ticket holders |
| **Organisers** | Event CRUD, multiple ticket types, cover image, discount codes, **booking promo** banner (pre-book / flash messaging), host profile (`/host/:id`), dashboards (registrations, revenue, check-in list, CSV export) |
| **Door staff** | Invited accounts see assigned events and use the same check-in tools with a selected gate |
| **Payments** | Stripe Checkout + webhook path when configured; simulate booking in dev when appropriate |
| **Platform** | Email verify / reset (SMTP), scheduled jobs (reminders, refunds lifecycle, feedback invites), admin routes, **page-view analytics** (`/stats` for admins, neutral `/api/app/*` paths to reduce ad-block false positives) |

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Browser (Vite + React Router)                               │
│  • Top navigation → dedicated routes (/organise, /check-in…)   │
│  • Axios → VITE_API_URL (must end with /api)                 │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼─────────────────────────────────┐
│  Express API (PORT / Render)                                 │
│  • /api/* JSON routes + Stripe raw webhook                   │
│  • MongoDB via Mongoose                                      │
│  • CORS: CLIENT_URL must match SPA origin exactly            │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  MongoDB (Atlas or self-hosted)                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Repository layout

| Path | Purpose |
|------|---------|
| [`client/`](client/) | React SPA, Vite build, `vercel.json` SPA fallback |
| [`server/`](server/) | Express app, models, routes, background jobs |
| [`docs/`](docs/) | Supplementary notes (e.g. hackathon coverage) |
| [`scripts/`](scripts/) | Optional maintenance scripts (e.g. layout extraction helpers) |

---

## Prerequisites

- **Node.js** 18+ (20 LTS recommended)
- **npm** (ships with Node)
- **MongoDB** 6+ (local or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas))
- Optional: **Stripe** account, **Google Cloud** OAuth client, **SMTP** provider (Gmail app password, SendGrid, etc.)

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/ArnavDesai1/EventwithEase.git
cd EventwithEase
```

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Set at minimum in `server/.env`:

- `MONGODB_URI`
- `JWT_SECRET` (long random string)
- `CLIENT_URL` (e.g. `http://localhost:5173` locally)

Set in `client/.env`:

- `VITE_API_URL=http://localhost:5000/api`

### 3. Run API and client (two terminals)

```bash
cd server && npm run dev
```

```bash
cd client && npm run dev
```

Open **http://localhost:5173**. Health check: **http://localhost:5000/api/health**

### 4. Production build (client)

```bash
cd client && npm run build && npm run preview
```

---

## Environment variables

### Server (`server/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Listen port (Render injects this) |
| `MONGODB_URI` | **Yes** | Mongo connection string |
| `JWT_SECRET` | **Yes** | HMAC secret for JWTs |
| `CLIENT_URL` | **Yes** (prod) | Exact SPA origin for CORS (scheme + host, no path) |
| `GOOGLE_CLIENT_ID` | No | Verify Google ID tokens server-side |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | No | Transactional email |
| `STRIPE_SECRET_KEY` | No | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | No | Validates Stripe webhook signatures |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | No | Alternate payment experiments |

See [`server/.env.example`](server/.env.example) for the full template.

### Client (`client/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | API base **including `/api`** (e.g. `https://your-api.onrender.com/api`) |
| `VITE_GOOGLE_CLIENT_ID` | Enables Google sign-in button when set |

**Deploy tip:** `VITE_*` variables are baked in at **build** time on Vercel — redeploy the frontend after changing them.

---

## Scripts & tooling

| Location | Command | Description |
|----------|---------|-------------|
| `server/` | `npm run dev` | Nodemon API |
| `server/` | `npm start` | Production `node` |
| `server/` | `npm run seed:demo` | Seed demo events, users, reviews, bookings |
| `client/` | `npm run dev` | Vite dev server |
| `client/` | `npm run build` | Optimised bundle → `dist/` |
| `client/` | `npm run lint` | ESLint |

---

## API surface (overview)

All JSON routes are under **`/api`** unless noted.

- **`/api/auth`** — register, login, Google, verify email, password reset  
- **`/api/events`** — CRUD, public list, my events, networking (ticket-gated)  
- **`/api/bookings`** — create from cart or Stripe session  
- **`/api/refunds`**, **`/api/reviews`**, **`/api/feedback`**, **`/api/wishlist`**, **`/api/waitlist`**  
- **`/api/checkin`** — validate / mark attended  
- **`/api/payments`** — Stripe session creation, etc.  
- **`/api/app/*`** — analytics / page views (neutral path names)  
- **`POST /api/payments/stripe/webhook`** — raw body, Stripe signature verification  

Interactive exploration: use the Network tab while using the SPA, or attach Postman with a `Bearer` JWT from login.

---

## Client routes

| Route | Audience | Description |
|-------|----------|-------------|
| `/` | All | Discover grid, account, hero |
| `/event/:id` | All | Event detail, booking, reviews |
| `/tickets` | Signed-in | QR tickets, cancellations |
| `/wishlist` | Signed-in | Saved events |
| `/organise` | Organisers | Create event (gated) |
| `/check-in` | Host / staff | Check-in dashboard (gated) |
| `/stats` | Admin | Site analytics |
| `/host/:id` | All | Public organiser profile |

---

## Demo data

```bash
cd server
npm run seed:demo
```

Creates a large catalogue (past + upcoming), reviews, feedback rows, and sample bookings with QR codes. Safe to re-run (skips duplicates where implemented). Crowd accounts use password **`demo1234`** (`crowd.*@eventwithease.com`).

---

## Deployment

### Recommended split

1. **API** — Node service (e.g. [Render](https://render.com/)): root `server/`, start `npm start`, set env vars.  
2. **SPA** — Static host (e.g. [Vercel](https://vercel.com/)): root `client/`, framework **Vite**, output **`dist`**, set `VITE_API_URL` to your API **+ `/api`**.

[`client/vercel.json`](client/vercel.json) rewrites unknown paths to `index.html` for client-side routing.

### Checklist

- [ ] `CLIENT_URL` matches the live frontend origin exactly (no trailing slash path).  
- [ ] `VITE_API_URL` is correct in the **build** environment.  
- [ ] MongoDB Atlas IP allowlist / VPC allows the API host.  
- [ ] HTTPS everywhere (camera APIs and Stripe require secure contexts).  
- [ ] Stripe webhook URL and signing secret configured if using Checkout.  

---

## Security & operations

- Store **secrets only** in environment variables, never in the repo.  
- Rotate `JWT_SECRET` invalidates existing sessions — plan maintenance windows.  
- Rate limits apply to sensitive routes (see `server/src/middleware/`).  
- Prefer least-privilege MongoDB users for production.  

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| **403 on `/events/:id/networking`** | Expected without a ticket; client only calls after booking. |
| **CORS errors** | `CLIENT_URL` mismatch vs browser origin. |
| **404 / “no server” from frontend** | Wrong `VITE_API_URL` (hostname typo, missing `/api`). |
| **Blank production screen** | Failed API load; check Network tab and `GET /api/health`. |
| **QR camera black / no feed** | HTTPS required (except localhost); permissions; see `QrScannerPanel` layout timing fixes. |
| **Analytics missing** | Some extensions block “tracking” URLs; this app uses `/api/app/*` by design. |

---

## Contributing

1. Fork the repository and create a feature branch.  
2. Keep changes focused; match existing formatting and patterns.  
3. Run `npm run lint` in `client/` before opening a PR.  
4. Describe **what** and **why** in the PR — screenshots for UI changes help.  

---

## Further reading

- [`docs/HACKATHON_COVERAGE.md`](docs/HACKATHON_COVERAGE.md) — when present, maps spec to implementation.

---

## License

**ISC** — see [`server/package.json`](server/package.json). Standardise on another license file if you prefer MIT/Apache for the whole repo.

---

<p align="center">
  Built with EventwithEase — <strong>events · tickets · check-in</strong>
</p>
