# Semester OS — Build Brief for Claude

**Status:** Plan-first build specification  
**Prepared:** 25 August 2026  
**Primary user:** UCD engineering student  
**Target:** Autumn 2026 semester  
**Primary devices:** Windows laptop + Android/Samsung phone + Samsung tablet

---

## 0. Your role

You are the lead product engineer for this project.

Do **not** begin by building a huge student productivity suite.

First:
1. Read this full brief.
2. Inspect the repository.
3. Propose a compact implementation plan.
4. Identify assumptions / risks.
5. Then build the smallest coherent V1 that is genuinely usable.

The product goal is not "a nicer to-do app".

The product is a **semester control system** that:
- captures commitments with almost zero friction,
- knows what is due and how heavily it matters,
- knows the user's calendar and available time,
- shows which modules are falling behind,
- keeps extracurricular work visible,
- and always answers: **"What should I do next?"**

---

# 1. Product concept

There are two interfaces to the same system.

## A. Laptop = Command Centre

The laptop app is the full dashboard.

It combines:
- university modules,
- assignments,
- weekly module work,
- Google Calendar,
- Google Drive resources,
- Samsung Notes exports,
- GaelForce commitments,
- Accio / Campus Lead commitments,
- workload estimates,
- academic backlog/debt,
- upcoming assessment pressure,
- and recommended next actions.

The dashboard should answer:

1. What do I need to do?
2. What is due next?
3. What is worth the most?
4. Am I falling behind in a module?
5. How much work is left this week?
6. How much realistic free capacity do I have?
7. What should I do right now?

## B. Phone = Glance + Capture

The phone experience should be intentionally tiny.

It should support:
- Android/PWA quick view,
- a home-screen widget if practical,
- fast task capture,
- checking tasks complete,
- viewing the next deadline,
- viewing semester/module health,
- viewing weekly capacity,
- and one-tap "What should I do?"

Example:

```text
WEEK 4 · 84% ON TRACK

🔴 Solid State      3 debt
🟡 Maths            1 debt
🟢 Digital          on track

NEXT
Digital Lab 02 · ~45m
Due tomorrow

CAPACITY
24h / 31h committed

[ + QUICK TASK ]   [ START NEXT ]
```

The phone must never become a miniature version of the full desktop app.

---

# 2. Core product loop

```text
New commitment appears
        ↓
Capture in <5 seconds
        ↓
Classify: module / GaelForce / Accio / personal
        ↓
Give due date + rough duration when known
        ↓
System compares against calendar + existing workload
        ↓
Dashboard updates health / debt / capacity
        ↓
System recommends next action
        ↓
User completes work
        ↓
If assessed work: remains open until SUBMITTED
```

The key rule is:

> **Complete != Submitted**

---

# 3. Core entities

Keep the schema small.

## Area

Examples:
- University
- GaelForce
- Accio
- Personal

## Module

Fields:
- `id`
- `code`
- `name`
- `credits`
- `trimester`
- `coordinator`
- `ucd_url`
- `syllabus_summary`
- `student_effort_hours`
- `health_score`
- `academic_debt`
- `last_synced_at`

## Task

Fields:
- `id`
- `title`
- `area_id`
- `module_id?`
- `assignment_id?`
- `status`
- `due_at?`
- `week_number?`
- `estimated_minutes?`
- `actual_minutes?`
- `priority_override?`
- `source`
- `created_at`
- `completed_at?`

Status:
- `todo`
- `in_progress`
- `done`
- `submitted`

## Assignment / Assessment

Fields:
- `id`
- `module_id`
- `title`
- `assessment_type`
- `weight_percent`
- `due_week?`
- `due_at?`
- `is_exam`
- `is_submitted`
- `submitted_at?`
- `source_url`
- `source_last_checked_at`
- `user_confirmed`

## Weekly Template

Fields:
- `module_id`
- `task_title`
- `default_estimated_minutes`
- `default_day?`
- `required`

Used to generate recurring weekly work once the real semester pattern becomes known.

## Resource

Fields:
- `module_id`
- `title`
- `type`
- `google_drive_file_id`
- `week_number?`
- `source`
- `url`

Types:
- slide
- notes
- lab
- assignment
- formula_sheet
- reading
- other

## Calendar Event

Mirror only the minimum fields needed from Google Calendar.

---

# 4. The most important desktop screen

Build the app around **Today**, not around navigation.

Example:

```text
AUTUMN 2026                         WEEK 5 / 12

SEMESTER HEALTH  86%

Digital          94%  🟢
Circuits         86%  🟢
Computer Eng     92%  🟢
Solid State      67%  🔴
Maths            79%  🟡
Leadership       100% 🟢

ACADEMIC DEBT: 5
THIS WEEK: 27h / 32h capacity

TODAY
□ Digital Lab 03                45m
□ Maths Problem Sheet           70m
□ Solid State Review            50m
□ GaelForce CAD                 90m
□ Accio follow-up               30m

NEXT EVENT
14:00 GaelForce mechanical meeting

WHAT SHOULD I DO?
Solid State Tutorial 4
~50m · overdue 3 days · module falling behind

[ START ]
```

---

# 5. Instant capture

This is critical.

Desktop:
- keyboard shortcut, ideally `Q`
- text input appears
- type task
- Enter saves

Phone:
- persistent `+`
- add task in one field
- save immediately
- optional details later

Do not force category/date/priority forms before saving.

Later, add lightweight parsing such as:

```text
digital lab friday 1h
```

Could infer:
- module: EEEN20050
- due: Friday
- estimate: 60m

But parsing is a convenience, not a dependency.

---

# 6. Academic debt

"Academic debt" = expected university work from previous/current weeks that should already be complete but is not.

Do not use streaks as the main motivational metric.

Example:

```text
ACADEMIC DEBT: 4

EEEN20070
- Week 3 lecture review
- Week 3 tutorial

MATH20290
- Week 4 problem sheet

EEEN20020
- Lab 1 write-up
```

Goal: **Debt = 0**

A missed weekly task must not silently disappear.

It carries forward until done, intentionally dismissed, or rescheduled.

---

# 7. Weekly capacity

This is one of the differentiating features.

The app should estimate:

```text
Realistic free capacity this week: 31h

University required        18h
GaelForce                    6h
Accio                        4h
Personal                     2h
Unallocated                  1h
```

If the user adds a 5-hour task:

> "This puts Week 5 at ~113% of realistic capacity."

Do not hard-block extracurricular work.

Warn and show the trade-off.

---

# 8. "What should I do?" engine

V1 does **not** need an LLM.

Use deterministic scoring.

Potential factors:
- overdue
- due soon
- assessment weight
- module health
- academic debt
- estimated duration
- available time before next calendar event
- whether it is mandatory weekly work
- neglected module
- user priority override

Example rough model:

```text
score =
  overdue_days * 12
  + deadline_urgency * 8
  + assessment_weight_factor * 5
  + module_risk * 6
  + weekly_requirement * 4
  + neglected_module * 3
  + user_priority_override
```

Duration should affect *fit* rather than simply importance.

If there are 40 minutes before the next event, prefer a 30-minute high-value task over a 2-hour task.

Show the reason:

> "Recommended because it is due tomorrow, worth 10%, and Solid State is currently behind."

Never make the recommendation feel mysterious.

---

# 9. Focus mode

Press START on a task.

The UI collapses to:

```text
SOLID STATE DEVICES

Tutorial 4

42:18 elapsed

[ Open slides ]
[ Open notes ]
[ Open assignment ]

[ FINISH ]
```

No dashboard noise while working.

Track actual time.

Over time:
- compare estimated vs actual duration,
- calculate a personal estimation multiplier,
- improve future workload forecasts.

---

# 10. Assignments / assessment radar

Assessed work must be impossible to forget.

Each item should support:

```text
✓ Read brief
✓ Started
✓ Main work complete
□ Checked
□ Submitted
□ Submission verified
```

The assignment is **not closed** until `submitted = true`.

Build an assessment radar:

```text
NEXT 14 DAYS

Sep 28   Digital Lab Report
Oct 02   Maths Midterm Prep
Oct 07   Computer Engineering Quiz
Oct 15   Solid State Lab Report
```

Eventually compute:
- recommended start date,
- estimated work remaining,
- whether current progress is behind schedule.

---

# 11. UCD "Eye on the Ball" feature

This should exist from V1.

Every university module page should have an **Assessment / Eye on the Ball** panel.

It combines:
- official UCD assessment structure,
- known assessment weeks,
- weight,
- exam type,
- completion/submission status,
- upcoming work,
- and current risk.

Example:

```text
EEEN20070 — SOLID STATE DEVICES

ASSESSMENT
60%  Closed-book final            End of trimester
20%  Closed-book midterm          Weeks 7–9
10%  Lab Assignment 1 Report      Week 9
10%  Lab Assignment 2 Report      Week 11

CURRENT RISK
🔴 Midterm represents 20% and is 18 days away.
You have 3 unfinished Solid State weekly tasks.

[ View official UCD page ]
```

---

# 12. Public UCD data ingestion

UCD currently exposes useful module metadata publicly through UCD Hub module pages.

Example pattern:

```text
https://hub.ucd.ie/usis/!W_HU_MENU.P_PUBLISH?ACYR=2026&MODULE=EEEN20070&TERMCODE=202600&p_tag=MODULE
```

The public pages expose:
- module code/name,
- credits,
- coordinator,
- trimester,
- description,
- learning outcomes,
- indicative content,
- student effort hours,
- assessment strategy,
- assessment timing,
- weights,
- exam type/duration,
- and timetable guidance.

### V1 import strategy

Do not make live scraping a hard dependency for the whole app.

Implement:

1. `ucd_modules` seed data stored locally/database.
2. A server-side importer/parsing service that can refresh a module from its public UCD URL.
3. A "Refresh from UCD" button.
4. Show `Last checked`.
5. Diff new data against existing data.
6. Never silently overwrite user-edited deadlines.
7. If official UCD data changes, show:
   - old value,
   - new value,
   - confirm update.

Important:
- UCD itself states curricular/timetabling information may change.
- Treat imported information as a source feed, not perfect truth.
- When semester begins, Brightspace/lecturer announcements may supersede the generic module descriptor.

Do not make the browser scrape UCD directly if CORS/security becomes awkward.
Prefer a server-side fetch/parser.

---

# 13. Seed the Autumn 2026 modules now

These were verified against the UCD public module pages on 25 Aug 2026.

## EEEN20020 — Electrical and Electronic Circuits

- 5 credits
- Autumn
- Coordinator: Professor Peter Kennedy
- Total stated effort: 120h

Content themes:
- current, voltage, power
- Kirchhoff laws
- resistive circuits
- node voltage analysis
- controlled sources
- op-amps
- capacitors / inductors
- transient response
- phasors / sinusoidal steady state
- frequency response
- filters
- diodes / rectifiers / transistors

Assessment:
- Homework 1 — Week 5 — 5%
- Homework 2 — Week 7 — 5%
- Homework 3 — Week 9 — 5%
- Homework 4 — Week 11 — 5%
- Laboratory 1 — Weeks 3–5 — 5%
- Laboratory 2 — Weeks 6–8 — 5%
- Laboratory 3 — Weeks 9–11 — 5%
- Open-book final exam — end of trimester — 65% — 2 hours

Source:
https://hub.ucd.ie/usis/!W_HU_MENU.P_PUBLISH?ACYR=2026&MODULE=EEEN20020&TERMCODE=202600&p_tag=MODULE

## EEEN20050 — Digital Electronics: from gate to system

- 5 credits
- Autumn
- Coordinator: Dr Ruijia Liu
- Total stated effort: 120h

Content themes:
- binary systems
- logic gates
- Boolean algebra
- Karnaugh maps
- combinational circuits
- arithmetic/control circuits
- multiplexers / decoders
- flip-flops
- registers
- counters
- state machines
- memory
- configurable logic / FPGA
- CMOS and logic-family implementation
- timing

Assessment:
- Home assignments + small projects — Weeks 8 & 12 — 30%
- Mid-term exam — Week 6 — 10%
- Final exam — end of trimester — 30% — 2 hours
- Lab reports — Weeks 4, 6, 8, 10 — 30%

Source:
https://hub.ucd.ie/usis/!W_HU_MENU.P_PUBLISH?ACYR=2026&MODULE=EEEN20050&TERMCODE=202600&p_tag=MODULE

## EEEN20010 — Computer Engineering

- 5 credits
- Autumn
- Coordinator: Professor Mark Flanagan
- Total stated effort: 120h

Content themes:
- C programming
- types / operators / expressions
- I/O
- control flow
- functions
- preprocessor
- arrays / pointers / strings
- structs / user-defined types
- files
- multi-file program organisation
- linked lists
- stacks
- sorting
- algorithm analysis

Assessment:
- Lab Programming Assignments — Weeks 2–11 — 40%
- In-class Brightspace Quiz — Week 8 — 30%
- In-class Brightspace Quiz — Week 12 — 30%
- No end-of-trimester exam listed in current descriptor

Source:
https://hub.ucd.ie/usis/!W_HU_MENU.P_PUBLISH?ACYR=2026&MODULE=EEEN20010&TERMCODE=202600&p_tag=MODULE

## EEEN20070 — Solid State Devices

- 5 credits
- Autumn
- Coordinator: Dr Xu Wang
- Total stated effort: 108h

Content themes:
- introductory quantum mechanics
- band theory
- metals / insulators / semiconductors
- charge transport
- doping
- continuity / Poisson equations
- semiconductor processing
- PN junction
- MOS capacitor / MOSFET
- BJT

Assessment:
- Closed-book final — end of trimester — 60% — 2 hours
- Closed-book midterm — Weeks 7–9 — 20%
- Lab Assignment 1 Report — Week 9 — 10%
- Lab Assignment 2 Report — Week 11 — 10%

Source:
https://hub.ucd.ie/usis/!W_HU_MENU.P_PUBLISH?ACYR=2026&MODULE=EEEN20070&TERMCODE=202600&p_tag=MODULE

## MATH20290 — Multivariable Calculus for Engineers

- 5 credits
- Autumn
- Coordinator: Assoc Professor Thomas Unger
- Total stated effort: 100h

Content themes:
- functions of several variables
- partial derivatives
- multivariable chain rule
- linear approximation
- gradient / directional derivative
- Hessian
- Jacobian
- critical points
- constrained optimisation
- Lagrange multipliers
- higher-order linear ODEs
- Laplace transform if time permits

Assessment:
- Online midterm — Week 7 — 15%
- Final exam — end of trimester — 85% — 2 hours

Source:
https://hub.ucd.ie/usis/!W_HU_MENU.P_PUBLISH?ACYR=2026&MODULE=MATH20290&TERMCODE=202600&p_tag=MODULE

## SCI20020 — Introduction to Leadership

- Autumn/Spring offerings
- Autumn relevant here
- Total stated effort: 110h

Themes:
- practical leadership
- project management
- time management
- negotiation
- cognitive bias
- decision-making
- communication
- Gantt charts
- career planning
- working with difficult people

Important:
- Lecture attendance is stated as mandatory.

Assessment:
- Portfolio — Week 12 — 100%
- portfolio consists of reflective writing, group-discussion commentary and case-study commentary

Source:
https://hub.ucd.ie/usis/!W_HU_MENU.P_PUBLISH?ACYR=2026&MODULE=SCI20020&TERMCODE=202600&p_tag=MODULE

---

# 14. Seed assessment pressure into the dashboard

The app should understand *weight*, not just deadlines.

Initial risk heuristics:

### High assessment concentration
- MATH20290: 85% final
- EEEN20020: 65% final
- EEEN20070: 60% final

These modules should build revision debt / preparedness indicators well before finals.

### Continuous assessment heavy
- EEEN20010: programming work + two quizzes, no current final listed
- EEEN20050: projects/labs = 60% before final
- SCI20020: 100% portfolio

The dashboard should therefore avoid treating every module identically.

Examples:
- Maths health should depend heavily on tutorial/problem-sheet completion + exam readiness.
- Computer Engineering health should depend on staying current with programming labs.
- Leadership health should depend on attendance + weekly reflective material + portfolio progress.
- Solid State should start midterm preparation early because the midterm is 20% and the final is 60%.

---

# 15. Google Calendar integration

Google Calendar is the source of truth for **WHEN**.

Start with read-only permissions.

Use it for:
- lectures
- labs
- tutorials
- meetings
- GaelForce
- Accio
- personal fixed commitments

The app uses events to estimate available time.

Later:
- allow "Schedule task" to create calendar focus blocks.

Do not require the user to maintain a duplicate calendar.

---

# 16. Google Drive integration

Google Drive is the source of truth for **FILES**.

Do not upload duplicate files into this app unless there is a clear reason.

Recommended folder mapping:

```text
UCD 2026-27/
  Autumn/
    EEEN20020/
      Slides/
      Labs/
      Assignments/
      Notes/
    EEEN20050/
    EEEN20010/
    EEEN20070/
    MATH20290/
    SCI20020/
```

The app should:
- map each module to one Drive folder,
- list files,
- group by type/week,
- preview PDFs,
- offer "Open in Drive",
- attach resources to tasks.

Example:
"Review Digital Week 3" should directly expose:
- Week 3 slides
- Week 3 notes
- relevant lab sheet

---

# 17. Samsung Notes

Do not attempt to rebuild Samsung Notes.

Assume handwritten notes stay in Samsung Notes on the tablet.

V1 workflow:

```text
Samsung Notes
   ↓ export/share PDF
Google Drive module /Notes folder
   ↓
Semester OS indexes it
```

This is good enough.

Later investigate automation, but do not block V1 on a Samsung Notes API.

---

# 18. Weekly reset

Create a "Plan Week" flow.

Every week:
1. Generate known recurring module template tasks.
2. Pull fixed events from Calendar.
3. Carry unfinished academic debt forward.
4. List upcoming assessments.
5. Ask the user to add new lecturer-announced tasks.
6. Estimate remaining weekly workload.
7. Show remaining capacity.
8. Identify overloaded weeks.
9. Generate a proposed priority order.

Example:

```text
PLAN WEEK 4

University           18h
GaelForce              6h
Accio                  3h
Personal               2h

Available              32h
Remaining buffer        3h
```

---

# 19. Phone widget strategy

A true Android widget may require a native Android shell.

Do not overcomplicate V1.

Recommended sequence:

### V1
- responsive PWA
- installable to Android home screen
- fast launch
- notification support if practical
- compact "Glance" route

### V1.5 / V2
If the PWA cannot provide a satisfactory widget:
- build a thin native Android wrapper in Kotlin/Jetpack Compose
- or use Capacitor + native widget bridge
- widget reads from the same backend/API

Widget content should be tiny:
- current week health
- debt count
- next task
- next assessment
- weekly capacity
- quick add / open app

---

# 20. Suggested implementation stack

Preferred:

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui

Supabase
- Postgres
- Auth
- Row Level Security
- realtime only where useful

Google OAuth
Google Calendar API
Google Drive API
```

Alternative stacks are acceptable if the repository already has a strong foundation.

Do not migrate technologies merely for fashion.

---

# 21. UX principles

1. Capture must be faster than opening Todoist/Notion and organising something.
2. The app should reduce decisions, not create them.
3. Avoid dashboards full of decorative graphs.
4. Use traffic-light warnings sparingly.
5. Always explain why something is at risk.
6. Never hide overdue work.
7. Never silently mark assessed work complete before submission.
8. External commitments count toward real capacity.
9. University remains the default protected floor.
10. The system can warn, but should not patronise or hard-block the user.

---

# 22. Things NOT to build in V1

Do not build:
- full note editor
- handwriting
- flashcards
- AI chat
- social features
- habits
- XP / coins
- complicated gamification
- GPA simulator
- LMS scraping
- automatic Samsung Notes sync
- automatic email parsing
- elaborate Kanban board
- huge analytics system

These may be reconsidered after real usage.

---

# 23. V1 acceptance criteria

The first genuinely usable build is complete when the user can:

1. See all six UCD modules preloaded.
2. See each module's official current assessment structure.
3. Add a task in <5 seconds.
4. Attach task to module/GaelForce/Accio.
5. Add due date and rough duration.
6. See Today.
7. See overdue / academic debt.
8. See upcoming assessments ordered by date and weight.
9. See weekly estimated workload.
10. See remaining weekly capacity.
11. Mark ordinary tasks done.
12. Mark assessed work separately as completed and submitted.
13. View a deterministic "What should I do next?" recommendation.
14. Connect/read Google Calendar.
15. Map/open Google Drive module folders.
16. Use the app comfortably on laptop and phone.
17. Install the phone experience as a PWA.

Everything else can follow.

---

# 24. Build order

## Phase 0 — Inspect + plan
- inspect repo
- document architecture
- confirm auth/data strategy
- do not code yet

## Phase 1 — Core local product
- schema
- seed modules + assessments
- Today
- quick capture
- module pages
- assignments
- debt
- weekly capacity
- next-action engine

## Phase 2 — Google
- OAuth
- Calendar read
- Drive folder mapping
- resources / PDF viewing

## Phase 3 — Mobile
- PWA
- Glance view
- notifications
- quick capture improvements

## Phase 4 — Intelligence
- actual-vs-estimated time
- improved task ranking
- recommended start dates
- assessment readiness
- overload forecasting

## Phase 5 — Optional automation
- UCD module refresh parser
- Brightspace capture / extension research
- Android native widget if required

---

# 25. First task for Claude

Before editing code, respond with:

1. Repository assessment.
2. Proposed architecture.
3. Database schema.
4. Pages/routes.
5. Component map.
6. Integration plan.
7. UCD import strategy.
8. V1 implementation sequence.
9. Risks / unknowns.
10. What can be built immediately without credentials.

Then proceed incrementally.

Do not turn this into a generic productivity app.

The product thesis is:

> **Capture everything, understand the real workload, spot academic risk early, and always know the next useful action.**
