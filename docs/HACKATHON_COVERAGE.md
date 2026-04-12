# DevFusion problem statement — coverage

## Implemented in this codebase

| Area | Notes |
|------|--------|
| Event creation | Title, datetime, physical/online, category, description, banner URL, venue map, agenda, speakers, FAQ |
| Ticket types | Free (₹0) and paid; multiple tiers; per-type capacity |
| Discounts & early bird | Codes (% or flat), expiry; early bird price + end date |
| Organiser dashboard | Registrations, revenue, check-in count, refunds, payout estimate, attendee table, CSV |
| QR tickets | Unique code per ticket; download PNG from dashboard |
| Attendee browse | Search, category, date window, city, free/paid (early-bird-aware) |
| Event detail | Agenda, speakers, FAQ, map/link; `/event/:id` shareable URL |
| Checkout | Multi-ticket cart; Stripe Checkout (with key) or sandbox; Razorpay order summary (sandbox) |
| Wishlist | Server-synced for signed-in users (guests: localStorage); in-app reminders (72h) |
| Check-in | Manual ticket code + optional camera QR scan; live stats |
| Recommendations | Heuristic from past tickets + wishlist categories |
| AI-style tools | Bullet → description draft; smart schedule from sessions |
| Refunds & cancellation | Paid: cancel creates refund request; free: booking removed; organiser approve/reject refunds |
| Reviews & feedback | Public reviews; private post-event feedback |
| Networking | Opt-in LinkedIn visible to other ticket holders |
| Email | Verification, password reset, post-event feedback invites (when SMTP set) |

## Remaining / partial (typical hackathon gaps)

| Item | Status |
|------|--------|
| “True” LLM | Description/schedule use templates/heuristics, not OpenAI API |
| Razorpay hosted checkout | Simulated path + order summary; full widget optional |
| Production hardening | Rate limits, audit logs, webhooks for Stripe, etc. |

## Demo data

Run from `server` (with `MONGODB_URI` set):

```bash
npm run seed:demo
```

Safe to run multiple times: new events are added by unique title; reviews/bookings skip duplicates where noted in script logs.
