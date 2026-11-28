# EventPass — App design (Member 3: App Lead, Product/UX)

Input for `docs/design.pdf` (Milestone 1), sections **1. Product** (journeys),
**4. App** (wireframes, navigation map, features and their blocs) and
**5. Architecture** (layers of one feature). It describes the target design of
`app/lib/features/{events,tickets,clubs,dashboard}`; the screens are merged
one pull request at a time:

| Part | Pull request | Status |
|------|--------------|--------|
| Events list: search, filter, paging, offline cache | #2 | merged |
| Dashboard endpoint (`GET /events/:eventId/dashboard`) | #3 | merged |
| Bottom navigation, My clubs, club page | #4 | in review |
| Event details, create / edit / cancel (organizer) | next | planned |
| Registration and My tickets (optimistic cancel) | next | planned |
| Dashboard screen | next | planned |
| QR code on the ticket | after Member 4's `/tickets/:ticketId/qr` | blocked |

## 1. User journeys

The global role is `user` or `admin`; the **club role** (`organizer`, `staff`)
comes from the club memberships (`myRole` in the clubs API). One account can
be an attendee everywhere and an organizer of one club.

| Actor | Journey | Screens |
|-------|---------|---------|
| Attendee | Opens the app → browses / searches events → opens one → registers → sees "confirmed" or "waiting list, position N" → finds the ticket in *My tickets* → may cancel | Events → Event details → My tickets |
| Attendee (full event) | Registers on a full event → joins the waiting list → is promoted automatically when a place is freed (server) → the ticket shows *Confirmed* | Event details → My tickets |
| Organizer | *My clubs* → club → **New event** (form) → event details → **Edit** / **Dashboard** / **Cancel event** | My clubs → Club → Event form → Event details → Dashboard |
| Door staff | *My clubs* → club → scan tickets at the door (Member 4: scanner, offline check-in) | My clubs → Club → (scanner, Member 4) |
| Anyone offline | Opens the app without network → sees the last events list saved on the phone, with an "Offline" banner and Retry | Events |

## 2. Navigation map

```
            ┌──────────┐  signed out   ┌─────────┐   ┌───────────┐
  start ───►│ /splash  │──────────────►│ /login  │◄─►│ /register │
            └────┬─────┘               └────┬────┘   └───────────┘
                 │ signed in                │ signed in
                 ▼                          ▼
  ┌──────────────────────── HomeShell (bottom bar) ────────────────────────┐
  │  /home  Events          /tickets  My tickets       /clubs  My clubs    │
  └────┬────────────────────────┬───────────────────────────┬──────────────┘
       │ tap event              │ tap ticket                │ tap club
       ▼                        ▼                           ▼
  /events/:eventId  ◄───────────┘                     /clubs/:clubId
  details + Register                                  club + its events
       │ organizer of the club                             │ organizer
       ├──► /events/:eventId/edit       (form)             └──► /clubs/:clubId/new-event (form)
       └──► /events/:eventId/dashboard  (figures)
```

The route guard (`authRedirect`, Member 1) sends every signed-out user to
`/login`; it needs no change for these screens. Organizer actions are shown
only when `myRole == organizer`, and the API checks the role again on every
request (A7).

## 3. Wireframes (main screens)

```
┌ Events ─────────────[⎋]┐ ┌ ← Event ───────[▥][✎]┐ ┌ My tickets ────────────┐
│ [🔍 Search events    ✕] │ │ Jazz night            │ │ ┌────────────────────┐ │
│ (Upcoming only)         │ │ by Music Club         │ │ │Jazz night [Confirm.]│ │
│ ┌─────────────────────┐ │ │ ▶ Starts Mon 1 Dec 18h│ │ │Dec 1 · Main hall   │ │
│ │Jazz night [3 left]  │ │ │ ■ Ends   Mon 1 Dec 22h│ │ │          [Cancel]  │ │
│ │🕑 Dec 1 · 18:30     │ │ │ ⌖ Where  Main hall    │ │ └────────────────────┘ │
│ │⌖ Main hall          │ │ │ ⊞ Places 3 of 40 left │ │ ┌────────────────────┐ │
│ └─────────────────────┘ │ │ ───────────────────── │ │ │Open mic [Waiting]  │ │
│ ┌─────────────────────┐ │ │ About                 │ │ │Waiting list pos: 2 │ │
│ │Open mic [Full·wait] │ │ │ Programme, artists,   │ │ └────────────────────┘ │
│ └─────────────────────┘ │ │ dress code...         │ │                        │
│        ...  (scroll)    │ │ [   Register        ] │ │                        │
├─────────────────────────┤ ├───────────────────────┤ ├────────────────────────┤
│ Events  Tickets  Clubs  │ │ (organizer only)      │ │ Events  Tickets  Clubs │
└─────────────────────────┘ │ [ Cancel this event ] │ └────────────────────────┘
                            └───────────────────────┘
┌ ← New event ────────────┐ ┌ ← Dashboard ──────────┐ ┌ My clubs ──────────────┐
│ Title    [_____________]│ │ Jazz night · Dec 1    │ │ (M) Music Club         │
│ Location [_____________]│ │ ┌─────────┐┌─────────┐│ │     Concerts [Organizer]│
│ Starts   [Dec 1 18:00 📅]│ │ │Confirmed││Waiting  ││ │ (C) Chess Club         │
│ Ends     [Dec 1 22:00 📅]│ │ │ 38 / 40 ││   5     ││ │     [Door staff]       │
│ Places   [40__] empty=∞ │ │ └─────────┘└─────────┘│ │                        │
│ Description             │ │ │Checked in││Cancelled││ │                        │
│ [Programme, artists,   ]│ │ Attendance ▓▓▓▓░ 80 % │ │                        │
│ [dress code...         ]│ │ Registrations per day │ │                        │
│ [   Publish event     ] │ │ ▁▃▇▅▂                 │ │                        │
└─────────────────────────┘ └───────────────────────┘ └────────────────────────┘
```

Every screen that loads data has four distinct states (F7): **loading**
(spinner, or a thin progress bar over data already shown), **empty** (icon +
sentence + what to do), **error** (message + **Retry**), **content**. Shared
views: `core/widgets/state_views.dart`.

## 4. Features and their blocs

| Feature | Bloc / Cubit | Events or methods | States | Transformer / technique |
|---------|--------------|-------------------|--------|--------------------------|
| Events list | `EventsBloc` | Started, Refreshed, SearchChanged, UpcomingToggled, NextPageRequested | one class + `status` (loading/success/failure), items, query, filter, page, `cachedAt`, failure | **debounce + restartable** (search), **droppable** (next page, refresh), **cache then network** (F9), stale answers ignored (`_version`) |
| Club page | `ClubCubit` + `EventsBloc(clubId)` | `load(clubId)` | Loading / Loaded(club) / Failure | same list bloc, restricted to one club, no cache |
| My clubs | `MyClubsCubit` | `load()` | Loading / Loaded(clubs) / Failure | Cubit: one action |
| Event details | `EventDetailCubit` | `load(id)`, `cancelEvent()` | Loading / Loaded(event, club, isCancelling, actionFailure) / Failure | role from `myRole` decides the organizer actions |
| Registration | `RegistrationCubit` | `register(eventId)` | Idle / Submitting / Done(ticket) / Failed | double tap ignored while submitting |
| My tickets | `MyTicketsBloc` | Started, Refreshed, NextPageRequested, CancelRequested | one class + status, tickets, `pendingCancelIds`, `cancelFailure` | **optimistic update with rollback** (F8), droppable paging |
| Event form | `EventFormCubit` | `startCreate`, `startEdit`, `submit(draft)` | Loading / LoadFailure / Ready(initial, isSubmitting, failure) / Saved | client validation + **422 field errors under the fields** (F10) |
| Dashboard | `DashboardCubit` | `load(eventId)` | Loading / Loaded(dashboard, refreshFailure) / Failure | figures computed by one MongoDB aggregation (API) |

Bloc or Cubit? A **Bloc** when the transformer matters (search, paging,
concurrent cancellations); a **Cubit** for a single action (F2).

## 5. Layers of one feature (tickets)

```
presentation   MyTicketsPage ──events──► MyTicketsBloc ◄──states── (BlocConsumer)
                                             │ calls
domain         GetMyTickets / CancelTicket ──► TicketsRepository (contract)   Ticket (entity)
                                             ▲ implements          pure Dart: no Flutter, no Dio
data           TicketsRepositoryImpl ── guard() maps DioException → Failure (once)
                    ├─► TicketsRemoteDataSource ──► GET /tickets/me, DELETE /tickets/:id
                    └─► EventsRemoteDataSource  ──► GET /events/:id (event of each ticket)
core           shared Dio (Bearer + queued refresh), Result/Failure, get_it root, go_router
```

## 6. Accessibility and UX principles

- Status is never given by colour alone: every chip has a word (*Confirmed*,
  *Waiting list*, *Full · waiting list*, *Organizer*).
- Icon buttons have a `tooltip` (read by screen readers); progress bars have
  a semantic label and value (dashboard attendance).
- Touch targets: main buttons are 52 px high; Material 3 defaults elsewhere.
- Dates and times use the phone's language and 12/24 h setting
  (`MaterialLocalizations`).
- Destructive actions (cancel a registration, cancel an event) ask for
  confirmation and say what happens next ("your place goes to the first
  person on the waiting list").
- Errors say what happened and offer **Retry**; a failed refresh keeps the
  data on screen (snackbar) instead of replacing it with an error.
- Offline: the last events list stays readable, with the time it was saved.

## 7. Requests to other members

| To | Request | Why | Status |
|----|---------|-----|--------|
| Member 2 | Add an event summary (`title`, `startsAt`, `location`) to the ticket DTO | *My tickets* loads one event per distinct ticket today (max 20 calls per page) | the app already reads `ticket.event` if present |
| Member 2 | Filter `GET /tickets/me?eventId=` | event details could show "already registered" before tapping | registering again is idempotent (200), so it works meanwhile |
| Member 4 | `GET /tickets/:ticketId/qr` | QR code on the ticket screen | waiting |
| Team | Optional event fields: guest artists, dress code, poster image | asked by users; poster = *File and image upload* advanced feature (+2 bonus) | to decide; the description field holds them meanwhile |
