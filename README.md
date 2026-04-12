# EventwithEase

EventwithEase is a simple full-stack event platform MVP built with React, Express, and MongoDB.

## Features

- JWT signup and login for attendees and organisers
- Event creation with multiple ticket types
- Public event browsing and event details
- Ticket booking with unique QR-based ticket codes
- Organiser dashboard with registrations, revenue, attendees, and check-in
- Local MongoDB and deployment-friendly environment setup

## Run locally

### Backend

1. Copy `server/.env.example` to `server/.env`
2. Set `MONGODB_URI` and `JWT_SECRET`
3. Run:

```bash
cd server
npm install
npm run dev
```

### Frontend

1. Copy `client/.env.example` to `client/.env`
2. Run:

```bash
cd client
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` and expects the API on `http://localhost:5000/api`.

## Tested MVP flow

- Organiser signup and login
- Event creation with ticket types
- Attendee signup and booking
- QR ticket generation
- Organiser check-in using ticket code
