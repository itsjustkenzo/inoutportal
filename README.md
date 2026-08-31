# IN/OUT Portal

A MERN (MongoDB · Express · React · Node) app for tracking who is in and who is out.
Employees punch in and out with an optional note; everyone sees a live board; admins get
per-person hour totals and role management.

## Stack

| Layer    | Tech                                                      |
| -------- | --------------------------------------------------------- |
| Database | MongoDB + Mongoose 8                                       |
| API      | Node 18+, Express 4, JWT auth, bcrypt, rate-limited login   |
| Client   | React 18, Vite 6, React Router 6, Axios                     |

## Project layout

```
inout-portal/
├─ server/
│  └─ src/
│     ├─ index.js              # Express app + bootstrap
│     ├─ config/db.js
│     ├─ models/               # User, Entry, Schedule, Media, AuditLog
│     ├─ middleware/           # auth (JWT + roles), error handling
│     ├─ controllers/          # auth, entry, user, schedule, media, audit
│     ├─ utils/audit.js        # change-trail helper
│     └─ routes/
└─ client/
   └─ src/
      ├─ App.jsx               # routes
      ├─ api/client.js         # axios instance + token interceptor
      ├─ context/             # Auth, Theme, Prefs
      ├─ components/           # DashLayout, Pager, ProtectedRoute, AvatarCropper
      ├─ pages/                # Login, Dashboard, History, Admin, TeamReport,
      │                        # ModeratorManagement, Schedule, Finance,
      │                        # ServerManager, Profile
      └─ utils/time.js
```

## Setup

**1. Install dependencies** (root, server and client in one go):

```bash
npm run install:all
```

**2. Configure the server:**

```bash
cd server
cp .env.example .env      # Windows: copy .env.example .env
```

Then edit `server/.env`:

- `MONGO_URI` — `mongodb://127.0.0.1:27017/inout-portal` for a local install, or your
  MongoDB Atlas connection string.
- `JWT_SECRET` — any long random string. Generate one with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

> Upgrading an existing database? Logins moved from email to a new required
> `username` field. Run `npm run backfill:usernames` once to derive usernames
> from existing email addresses.

**3. Run both apps:**

```bash
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:5000 (Vite proxies `/api` to it, so no CORS fiddling in dev)

The **first account you register becomes the admin**; every other account is
created from inside the app. Every page reads live from MongoDB.

### Demo data (optional)

To preview how the pages look with a full roster:

```bash
npm run demo:add      # 18 moderators, ~5 weeks of shifts, schedules, activity log
npm run demo:clear    # removes every trace of them
```

Demo accounts are tagged by an `@demo.local` email domain, and `demo:clear`
matches on nothing else — real accounts (`@inout.local`) are never touched.
Demo logins all use the password `demo1234`.

## API

All routes are prefixed `/api`. Authenticated routes need `Authorization: Bearer <token>`.

| Method | Route                  | Access   | Purpose                                       |
| ------ | ---------------------- | -------- | --------------------------------------------- |
| GET    | `/health`              | public   | Liveness + DB state                           |
| POST   | `/auth/register`       | public   | Create account (first one becomes admin)      |
| POST   | `/auth/login`          | public   | Exchange credentials for a JWT                |
| GET    | `/auth/me`             | user     | Current user from token                       |
| POST   | `/entries/in`          | user     | Punch in (409 if already in)                  |
| POST   | `/entries/out`         | user     | Punch out (409 if not in)                     |
| GET    | `/entries/current`     | user     | Your open entry, if any                       |
| GET    | `/entries/board`       | user     | Everyone's current status                     |
| GET    | `/entries/history`     | user     | Your entries; admins may pass `?userId=`      |
| GET    | `/entries/summary`     | admin    | Minutes + sessions per person over a range    |
| PATCH  | `/entries/:id`         | admin    | Correct a punch record                        |
| DELETE | `/entries/:id`         | admin    | Delete a punch record                         |
| PATCH  | `/users/me`            | user     | Update name / department                      |
| POST   | `/users/me/password`   | user     | Change password                               |
| GET    | `/users`               | admin    | List all accounts                             |
| PATCH  | `/users/:id`           | admin    | Change role / department / active flag        |

Query params on `/entries/history` and `/entries/summary`: `from`, `to` (ISO dates),
plus `page` and `limit` on history.

## Data model

**User** — `name`, `username` (unique, the login identifier), `email` (unique, contact only),
`password` (bcrypt, `select: false`), `role`
(`employee` | `admin`), `department`, `status` (`in` | `out`), `lastSeenAt`, `statusNote`,
`active`.

**Entry** — `user` ref, `in`, `out` (null while punched in), `minutes` (computed on save),
`note`. The open-entry-has-null-`out` convention makes "who's in right now" a single query.

## Deploying

1. `npm run build` produces `client/dist`. Serve it from any static host, or add
   `express.static` to the server and point it at that folder.
2. Set `NODE_ENV=production`, a real `MONGO_URI`, a strong `JWT_SECRET`, and
   `CLIENT_ORIGIN` to the deployed client URL.
3. Never commit `server/.env` — it is gitignored.

## Ideas to build on

- Socket.IO for a board that updates without the 30s poll
- CSV export of the admin summary
- Scheduled reminder for anyone still punched in after hours
- Geofencing or an office-network check on punch-in
