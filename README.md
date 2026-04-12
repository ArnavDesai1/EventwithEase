# EventwithEase

<p align="center">
  <strong>Full-stack event ticketing</strong> — discovery, QR tickets, organiser dashboards, door check-in, refunds, and optional Stripe Checkout.<br />
  <sub>React · Vite · Express · MongoDB</sub>
</p>

---

## Overview

**EventwithEase** is a production-style web application for publishing events, selling multiple ticket types, and running **live QR check-in** at the door. Attendees browse a catalogue, book passes, and carry scannable codes; hosts and invited **door staff** validate tickets from a dedicated **Check-in dashboard**.

The UI is a single-page app with **client-side routes** (`/tickets`, `/organise`, `/check-in`, etc.), backed by a **REST API** under `/api` and **MongoDB** for persistence.

| Layer | Stack |
|--------|--------|
| **Frontend** | React 19, Vite 5, React Router 7, Axios |
| **Backend** | Node.js, Express 5, Mongoose 8 |
| **Payments** | Stripe (optional), Razorpay hooks where configured |
| **Auth** | JWT, optional Google OAuth |

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Client routes](#client-routes)
- [API surface (summary)](#api-surface-summary)
- [Prerequisites](#prerequisites)
- [Run locally](#run-locally)
- [Environment variables](#environment-variables)
- [Demo data](#demo-data)
- [Deployment](#deployment)
- [Security & privacy notes](#security--privacy-notes)
- [Troubleshooting](#troubleshooting)
- [Scripts](#scripts)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Attendees

- Email/password auth with JWT; **Google sign-in** when `VITE_GOOGLE_CLIENT_ID` / server OAuth are configured  
- Event discovery, filters, detail pages, **wishlist**  
- Booking with multiple ticket types, **discount codes**, optional **Stripe Checkout**  
- **My tickets** with QR codes; dev **simulate booking** when payments are off  
- **Reviews** (public) and **private feedback** to organisers after events  
- **Networking** opt-in (e.g. LinkedIn) for ticket holders — gated API (`403` without a valid ticket is expected)  
- **Booking promos** — optional banner (headline, badge, end time) on the booking panel for early-bird / pre-book messaging  

### Organisers & door staff

- **Create events** — ticket types, cover image, discounts, promo copy, agenda, FAQ  
- **Dashboards** — registrations, revenue, attendee list, refunds, feedback  
- **Dedicated routes**: [`/organise`](#client-routes) (create/publish flow) and [`/check-in`](#client-routes) (gate selection, paste/scan codes, CSV export)  
- **Door staff** — hosts assign staff per event; staff see assignments under check-in  

### Platform

- Email verification & password reset (SMTP)  
- Background jobs: check-in reminders, refund lifecycle, feedback invites  
- **Admin** tooling and **`/stats`** analytics (page views, paths, aggregates) for administrator roles  
- **OG/meta** routes for shareable event and host previews  

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Browser (Vercel / static host)                              │
│  React SPA · axios → VITE_API_URL                            │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS / JSON
┌────────────────────────────▼────────────────────────────────┐
│  API (Render / Node)                                         │
│  Express · /api/* · JWT middleware · rate limits               │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  MongoDB Atlas / self-hosted                                 │
│  Events, Users, Bookings, Tickets, Reviews, …              │
└──────────────────────────────────────────────────────────────┘
```

- **CORS** is locked to `CLIENT_URL` (your SPA origin).  
- **Stripe webhooks** use a dedicated raw body route — mount order matters (see `server/src/index.js`).  

---

## Repository layout

| Path | Purpose |
|------|---------|
| [`client/`](client/) | Vite React app; UI, routing, QR display & scanner |
| [`server/`](server/) | Express app, models, routes, jobs, seed scripts |
| [`docs/`](docs/) | Supplementary notes (e.g. hackathon coverage) |
| [`scripts/`](scripts/) | Optional maintenance / extraction helpers |

---

## Client routes

| Route | Description |
|-------|-------------|
| `/` | Home — discovery grid, account panel |
| `/event/:id` | Event detail, booking, reviews |
| `/tickets` | Purchased tickets & QR codes |
| `/wishlist` | Saved events |
| `/organise` | Create event (organisers; gated UI) |
| `/check-in` | Host / staff check-in dashboard |
| `/stats` | Admin analytics (gated) |
| `/host/:id` | Public organiser profile |

Unknown paths fall through to the SPA via [`client/vercel.json`](client/vercel.json) rewrites on Vercel.

---

## API surface (summary)

All JSON endpoints are prefixed with **`/api`** (e.g. `https://api.example.com/api/health`).

| Area | Examples |
|------|----------|
| Auth | `POST /api/auth/register`, `login`, `verify-email`, password reset |
| Events | `GET /api/events`, `POST /api/events`, event-specific networking & analytics |
| Bookings | `POST /api/bookings`, ticket lifecycle |
| Check-in | `POST /api/checkin` |
| Reviews & feedback | Under `/api/reviews`, `/api/feedback` |
| Payments | Stripe/Razorpay routes + webhook |

Refer to [`server/src/index.js`](server/src/index.js) for the authoritative route map.

---

## Prerequisites

- **Node.js** 18+  
- **MongoDB** 6+ (local or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas))  
- Optional: **Stripe** account, **Google Cloud OAuth** client, **SMTP** (Gmail app password, SendGrid, etc.)

---

## Run locally

### 1. API

```bash
cd server
cp .env.example .env   # Windows: copy .env.example .env
# Edit .env — set MONGODB_URI and JWT_SECRET at minimum
npm install
npm run dev
```

Default base URL: `http://localhost:5000` — API routes: `http://localhost:5000/api`.

### 2. Client

```bash
cd client
cp .env.example .env
# VITE_API_URL=http://localhost:5000/api
npm install
npm run dev
```

Open **http://localhost:5173**.

### 3. Production build (client)

```bash
cd client
npm run build
npm run preview   # optional local test of dist/
```

---

## Environment variables

### Server (`server/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Secret for signing JWTs |
| `PORT` | No | Listen port (default 5000; Render injects this) |
| `CLIENT_URL` | **Deploy: Yes** | Exact SPA origin for CORS, e.g. `https://your-app.vercel.app` |
| `GOOGLE_CLIENT_ID` | No | Server-side Google ID token verification |
| `SMTP_*`, `EMAIL_FROM` | No | Transactional mail |
| `STRIPE_SECRET_KEY` | No | Payments |
| `STRIPE_WEBHOOK_SECRET` | No | Verifies Stripe webhook signatures in production |
| `RAZORPAY_*` | No | Alternate payment integration |

See [`server/.env.example`](server/.env.example).

### Client (`client/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | **Must** be the API base including `/api`, e.g. `https://your-api.onrender.com/api` |
| `VITE_GOOGLE_CLIENT_ID` | Enables Google button in the UI |

**Deploy tip:** `VITE_*` variables are baked in at **build time**. Changing them on the host requires a **rebuild** of the client.

---

## Demo data

```bash
cd server
npm run seed:demo
```

Seeds a large catalogue of events, reviews, feedback, and sample bookings/tickets. Safe to re-run (skips duplicates where implemented). Demo crowd accounts use password **`demo1234`** (emails like `crowd.*@eventwithease.com`).

---

## Deployment

### Recommended split

1. **Frontend** — [Vercel](https://vercel.com) (or Netlify, Cloudflare Pages): project root **`client/`**, framework **Vite**, output **`dist`**.  
2. **Backend** — [Render](https://render.com), Railway, Fly.io, etc.: root **`server/`**, start **`npm start`**, health check **`/api/health`**.

### Checklist

- [ ] `CLIENT_URL` matches your live site (scheme + host, no trailing path).  
- [ ] `VITE_API_URL` in the **client build** points to `https://<api-host>/api`.  
- [ ] HTTPS everywhere (camera QR scanning requires secure context except localhost).  
- [ ] Stripe webhook URL and secret configured if using live payments.  

`client/vercel.json` includes SPA fallbacks so deep links (`/check-in`, `/event/...`) resolve to `index.html`.

---

## Security & privacy notes

- Passwords are hashed server-side; JWTs are stored in `localStorage` on the client (typical SPA pattern).  
- Never commit `.env` files — use platform secret stores in production.  
- **Networking** and **ticket** APIs enforce **booking** and **role** checks server-side — do not rely on UI hiding alone.  
- Rate limiting is applied on sensitive routes (see `server/src/middleware/`).  

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| API 404 / “no server” | Wrong `VITE_API_URL`, typo in host name, or missing `/api` suffix |
| CORS errors | `CLIENT_URL` does not match the browser origin |
| `403` on `/events/:id/networking` | Expected without a ticket; client only loads after booking |
| Blank screen in production | Bad API URL at build time, or API down — check Network tab |
| QR camera black / fails | Needs HTTPS (or localhost); grant camera permission; iOS needs inline video (handled in app) |

---

## Scripts

| Command | Where | Purpose |
|---------|--------|---------|
| `npm run dev` | `client`, `server` | Development servers |
| `npm run build` | `client` | Production bundle |
| `npm start` | `server` | Production Node process |
| `npm run seed:demo` | `server` | Populate demo data |

---

## Contributing

1. Fork and branch from `main`.  
2. Keep changes focused; match existing code style.  
3. Run `npm run build` in `client` before opening a PR.  
4. Describe **what** changed and **why** in the PR body.  

---

## Further reading

- [`docs/HACKATHON_COVERAGE.md`](docs/HACKATHON_COVERAGE.md) — if present, spec vs implementation notes  

---

## License

ISC (see [`server/package.json`](server/package.json)). Update the root license file if you standardise on MIT, Apache-2.0, etc.

---

<p align="center">
  Built with EventwithEase — events, tickets, and check-in in one flow.
</p>
