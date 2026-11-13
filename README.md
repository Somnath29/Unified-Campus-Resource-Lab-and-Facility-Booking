# Unified Campus Resource, Laboratory and Facility Booking Platform

An enterprise university facility and resource booking platform designed with a custom **LPU-inspired visual identity** (Orange `#F58220`, Charcoal `#292929`, Light Grey `#F5F5F5`, Blue `#1976B9`).

---

## 1. System Architecture & Tech Stack

This project is structured as a production-grade monorepo containing three interconnected applications sharing a PostgreSQL database and a shared types package:

```
├── packages/
│   └── shared/          # Shared TypeScript interfaces, enums, DTOs, and constants
├── apps/
│   ├── backend/         # Node.js + Express + TypeScript + Prisma ORM (Port 5001)
│   ├── web/             # Next.js (App Router) + TypeScript + Tailwind CSS (Port 3000)
│   └── admin/           # React + Vite + TypeScript + Recharts + React Router (Port 5173)
```

- **Backend**: Node.js, Express.js, TypeScript, PostgreSQL, Prisma ORM, JWT, bcryptjs, Zod.
- **Main Web Application**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS, Lucide Icons, QRCode.
- **Admin Analytics Application**: React + Vite, TypeScript, React Router v6, Recharts, Tailwind CSS.
- **Database**: PostgreSQL with Prisma ORM.

---

## 2. User Roles & Demo Credentials

The platform implements four distinct roles with role-based access control (RBAC):

| Role | Name | Email | Password | Access Privileges |
| :--- | :--- | :--- | :--- | :--- |
| **Student** | Ketan Meshram | `ketan.12204598@lpu.in` | `Lpu@12345` | Classrooms, Labs, Sports, Equipment, personal timetable, QR check-in |
| **Faculty** | Dr. Arvind Sharma | `arvind.cse@lpu.in` | `Lpu@12345` | Priority booking, Seminar Halls, Lab Sessions, bypass approval |
| **Department Approver** | Prof. Meenakshi Sundaram | `approver.sece@lpu.in` | `Lpu@12345` | Review pending queue, approve, decline with reasons, modify rooms |
| **Administrator** | Rajesh Verma | `admin.estate@lpu.in` | `Lpu@12345` | Full access, Vite Recharts analytics, user roles, policies, maintenance |

> **Pro-Tip**: The login page and sidebar include a **1-Click Instant Demo Login** bar that allows you to switch between all 4 roles immediately without typing credentials!

---

## 3. Ten Development Modules Implemented

1. **Authentication (Module 1)**:
   - Split-screen hero login with campus backdrop and 4 capability pills.
   - JWT authentication, bcrypt password hashing, role-based guard middleware.
   - 1-Click fast role switcher for evaluations.

2. **Dashboard (Module 2)**:
   - Matches the LPU UMS screenshot with greeting `Good morning, [Name] ☀️`.
   - 4 Stat Cards: Upcoming Bookings, Pending Requests, Available Resources, Club Bookings.
   - **Smart Allocation Assistant**: Recommends best-fit rooms based on expected attendance, activity type, and timing.
   - **My Schedule (This Week)**: Interactive weekday picker (Mon-Sun) with visual lecture and meeting timeline.
   - **Upcoming Bookings**: Quick check-in QR code launch, status indicators.
   - **Recommended Facilities**: Smart room suggestions with capacity tags and instant booking.

3. **Resource Discovery (Module 3)**:
   - Matches Screenshot 3 with category filter pills (Classrooms, Labs, Seminar Halls, Meeting Rooms, Sports, Equipment, Vehicles).
   - Multi-criteria filter: Date, Time Slot, Building / Block, Capacity range, Equipment checkboxes (Projector, AC, Smart Board, Whiteboard, Computers, etc.), Availability.
   - Grid and List view switcher, Sort by Relevance / Capacity / Name.
   - Resource Detail modal with full facility specs and booking buttons.

4. **Availability Calendar (Module 4)**:
   - Weekly matrix view integrating regular academic classes (e.g. INT-306 DBMS, CSE-316 DAA).
   - Confirmed bookings and free slots with 1-click `Reserve Slot` trigger.

5. **Booking System (Module 5)**:
   - Comprehensive reservation form with agenda, attendance, priority, and date/time.
   - **Strict Double-Booking Prevention**: Prohibits overlapping room reservations.
   - **Timetable Conflict Verification**: Blocks bookings during scheduled lectures.
   - Auto-generates unique 8-character reference (`LPU-2026-XXXX`) and 6-digit verification PIN.

6. **Approval Workflow (Module 6)**:
   - Dedicated Approvals queue for Approvers & Administrators.
   - Review attendee size, requester identity, and agenda.
   - **Approve**: Confirms request and issues check-in code.
   - **Decline**: Rejects with custom explanatory notes.
   - **Modify & Reassign**: Reallocates booking to an alternative facility with suitable capacity.

7. **Check-in System (Module 7)**:
   - High-resolution SVG QR code generation for venue scanning.
   - 6-digit numeric PIN verification (`/api/checkin/verify`).
   - **Background Auto-Release Daemon**: Periodically scans for unverified bookings past the 15-minute start deadline, marks them `NO_SHOW`, releases the room back to the pool, and notifies the requester.
   - "Trigger Background Auto-Release Scanner" button to simulate no-show releases on demand.

8. **Analytics Dashboard (Module 8 - React + Vite + Recharts)**:
   - Standalone Vite application running on port 5173.
   - Hourly Peak Occupancy Heatmap (AreaChart) comparing weekday vs weekend demand.
   - Facility category allocation breakdown (BarChart).
   - Weekly reservations vs verified check-ins vs no-shows (Multi-BarChart).
   - Department space distribution (PieChart / Donut).
   - Top-5 high demand facilities ranking table.

9. **Administration (Module 9)**:
   - **User Management**: View all users and update roles with instant persistence.
   - **Facility Governance**: Toggle maintenance downtime with custom reasons; create new facilities; delete decommissioned assets.
   - **Department Policies**: Configure max advance booking window (days), weekly student quotas, and auto-release timeouts.
   - **System Audit Trail**: Complete immutable log of all platform activities.

10. **Notifications & Polish (Module 10)**:
    - Notification bell with unread badge counter and dropdown.
    - Full alerts inbox with "Mark all read" action.
    - Fully responsive desktop, tablet, and mobile layouts with clean typography.

---

## 4. How to Run the Platform

### Prerequisites
- Node.js `v18+` or `v20+`
- PostgreSQL running locally (Database name: `lpu_campus_booking`)

### Starting the Applications

1. **Start Backend API** (Express + TypeScript + PostgreSQL):
   ```bash
   npm --workspace=@lpu/backend run start
   # Server runs on http://localhost:5001
   ```

2. **Start Main Web Portal** (Next.js):
   ```bash
   npm --workspace=@lpu/web run dev
   # Web portal runs on http://localhost:3000
   ```

3. **Start Admin Analytics Portal** (React + Vite + Recharts):
   ```bash
   npm --workspace=@lpu/admin run dev
   # Admin portal runs on http://localhost:5173
   ```

