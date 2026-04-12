# EventwithEase

Full-stack event ticketing MVP: browse events, book QR tickets, organiser dashboards, check-in, refunds, reviews, waitlists, and optional Stripe checkout. Built with **React (Vite)** and **Express + MongoDB**.

## Table of contents

- [Features](#features)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Run locally](#run-locally)
- [Environment variables](#environment-variables)
- [Demo data](#demo-data)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Further docs](#further-docs)

## Features

**Attendees**

- Sign up / log in (JWT) and Google OAuth (when configured)
- Event catalogue, search/filter, event detail and booking
- Multiple ticket types per event, discount codes, waitlist
- **My tickets** with QR codes; simulate booking in dev when payments are off
- Wishlist, reviews (public), private post-event feedback
- **Networking** list for events you have booked (API returns 403 without a ticket — expected)
- **Booking promos**: organisers can configure an optional banner (headline, subtext, badge, end date) shown on the booking panel to highlight early-bird or pre-book offers

**Organisers**

- Create and manage events (ticket types, cover image, discounts, **booking promo** block)
- Dashboards: registrations, revenue, attendees, refunds, feedback
- **Dedicated routes**: **`/organise`** (create event) and **`/check-in`** (managed events, door staff, live check-in, refunds) — same tools as before, reachable from any page via the navbar
- Door staff role: assigned users can open check-in for specific events

**Platform / admin**

- Email verification and password reset (SMTP)
- Stripe Checkout + webhook path for paid bookings (when keys are set)
- Analytics / gamification strip and **`/stats`** page (page views beacon)

## Repository layout

| Path | Role |
|------|------|
| `client/` | React SPA (Vite), `react-router-dom` |
| `server/` | REST API under `/api`, Mongoose models, jobs (reminders, refunds, feedback invites) |
| `docs/` | Extra notes (e.g. hackathon coverage) |

## Prerequisites

- **Node.js** 18+ recommended  
- **MongoDB** (local or Atlas)  
- Optional: **Stripe** account, **Google OAuth** client, **SMTP** for mail

## Run locally

### API (`server/`)

1. Copy `server/.env.example` → `server/.env` and set variables (see [Environment variables](#environment-variables)).
2. Start MongoDB and run:

```bash
cd server
npm install
npm run dev
```

API defaults to `http://localhost:5000` with routes under `http://localhost:5000/api`.

### Client (`client/`)

1. Copy `client/.env.example` → `client/.env` and set `VITE_API_URL=http://localhost:5000/api`.
2. Run:

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173`. The UI expects the API at `VITE_API_URL`.

### Production build (sanity check)

```bash
cd client
npm run build
```

## Environment variables

### Server (`server/.env`)

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (Render sets this automatically) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing JWTs |
| `CLIENT_URL` | **Origin** of the web app for CORS (e.g. `https://your-app.vercel.app`) |
| `GOOGLE_CLIENT_ID` | Server-side Google token verification (optional) |
| `SMTP_*`, `EMAIL_FROM` | Transactional email (optional) |
| `STRIPE_SECRET_KEY` | Stripe API (optional) |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures (production) |
| `RAZORPAY_*` | Alternate payment path if used in your deployment |

Use `server/.env.example` as the checklist.

### Client (`client/.env`)

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Base URL for Axios, **must end with `/api`** (e.g. `https://your-service.onrender.com/api`) |
| `VITE_GOOGLE_CLIENT_ID` | Google Sign-In button (optional) |

**Important:** A typo in the Render hostname (e.g. `eventwith-ease` vs `eventwithease`) or a missing `/api` suffix usually shows up as failed loads or 404s, not as “Mongo errors.”

## Demo data

With `MONGODB_URI` set:

```bash
cd server
npm run seed:demo
```

Seeds many events, reviews, feedback, and sample bookings/tickets. Safe to re-run (skips duplicates where implemented). Crowd reviewer logins use password **`demo1234`** (emails `crowd.*@eventwithease.com`).

## Deployment

Typical split:

1. **Backend on Render (or similar)** — Node service, root `server/`, start command `npm start`, set env vars including `CLIENT_URL` to your **exact** frontend origin.
2. **Frontend on Vercel** — root `client/`, framework Vite, output `dist`. Set `VITE_API_URL` to `https://<your-render-service>.onrender.com/api`.

`client/vercel.json` rewrites unknown paths to `index.html` for client-side routing.

After deploy:

- Confirm `GET https://<api>/api/health` returns JSON.
- Confirm the browser calls `VITE_API_URL` (Network tab) with no mixed-content or CORS errors.

### Stripe

Configure Checkout in your payment flow and register the webhook URL your server exposes for Stripe (see `server/src/routes/stripeWebhook.js`). Without Stripe, many flows still work using simulate booking where enabled.

## App routes (client)

| Route | Purpose |
|-------|---------|
| `/` | Home / event grid |
| `/event/:id` | Event detail, booking, reviews |
| `/tickets` | My tickets |
| `/wishlist` | Wishlist |
| `/organise` | Create event (organisers; gated) |
| `/check-in` | Host check-in & staff tools (gated) |
| `/stats` | Analytics / engagement view |

## Troubleshooting

**403 on `/events/:id/networking` in the console**  
The networking endpoint is restricted to users who hold a non-refunded ticket for that event. The client avoids calling it until you have a booking; after Stripe return or a successful booking it refreshes networking when possible.

**CORS errors**  
`CLIENT_URL` on the server must match the browser origin of the SPA (scheme + host, no trailing path).

**Blank or partial UI in production**  
Check `VITE_API_URL` at build time, API health, and that ad blockers are not blocking neutral `/api/app/...` analytics paths (the project uses those paths by design).

## Further docs

- `docs/HACKATHON_COVERAGE.md` — spec vs implementation notes (if present)

## License

ISC (per `server/package.json`; adjust if you standardise the repo on another license).
