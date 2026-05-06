# Design Specification

## Product

Telemedicine Rural App

## Document Purpose

This document defines the current UX architecture and visual behavior implemented in the web app. It is a practical implementation guide for product, engineering, and QA.

## 1. Experience Principles

1. Clarity over density
- Keep high-priority actions immediately visible.
- Reduce decision overhead for first-time and low-literacy users.

2. Guided progression
- Break complex tasks into small, understandable steps.
- Provide explicit labels and contextual hints.

3. Mobile-first reliability
- Core flows are optimized for narrow screens and inconsistent connectivity.
- Interaction targets are large enough for touch usage.

4. Safety and trust
- Clinical AI output is clearly labeled as draft content.
- Role and consent boundaries are reflected in UI visibility.

## 2. Current Navigation System

## 2.1 Top navigation (authenticated)

- Search-first nav bar only
- Global search input routes users to relevant pages (appointments, AI, profile, labs, medicines, etc.)
- No top profile button menu

## 2.2 Mobile bottom dock

Fixed four-item dock:
- Home
- Visits
- AI Help
- Profile

Behavior:
- Dock remains visible in standard app pages
- Active page state is visually highlighted
- Dock is hidden on call/prescription/full-detail contexts where needed

## 2.3 Profile action center

Because the top profile menu was removed, profile-related controls live in the Profile page:
- My Profile
- Health action button (role-aware target)
- My Medicines (patient)
- Pharmacy Orders
- Lab Tests
- Data Saver toggle
- Language selector panel
- Profile share QR controls (patient)
- Logout

## 3. Core Screen Patterns

## 3.1 Dashboard

Patient dashboard includes:
- Doctor search hero
- Primary appointment actions
- Specialty quick links
- Mobile cards with side-by-side first-row actions

Note:
- The old first-time guide card was removed.

## 3.2 Booking

Guided booking flow follows a step-based interaction:
- Select person (self/family)
- Add symptoms/context
- Select doctor
- Select slot and mode

CTA behavior:
- Primary next action remains clear at each step
- Validation feedback appears inline

## 3.3 Appointments and call

Appointment detail:
- Role-specific action buttons
- Presence and readiness indicators
- Re-book and follow-up paths when applicable

Call page:
- Main consult stage
- Compact controls for mute/camera/audio mode
- Chat fallback for weak connectivity

## 3.4 Prescription and PDF preview

- Prescription pages include printable/download paths
- In-app PDF preview route avoids forced download
- Prescription audio and language-aware narration support where available

## 3.5 AI Help

AI Help is button-first:
- Users first pick a feature button
- Tool form appears only after feature selection
- Draft output includes review-required messaging

## 4. Responsive Behavior

## 4.1 Breakpoints

Primary breakpoints:
- <= 980px for broad mobile/tablet adaptations
- <= 900px for denser dashboard/home card refinements

## 4.2 Mobile-specific decisions

- Top nav condensed to compact search control
- Bottom dock uses a single flush bar pattern
- Connectivity banner and translation dock are hidden on mobile to prevent bottom stacking conflicts

## 5. Visual System

## 5.1 Styling approach

- CSS variable based token system in `apps/frontend/src/styles.css`
- Gradient-supported surfaces and elevated cards
- Rounded corners and medium-soft shadows

## 5.2 Typography

- Primary family: Plus Jakarta Sans / Nunito stack
- Large readable body sizing and spacing for healthcare readability

## 5.3 Color intent

- Teal-based primary actions for trust and continuity
- Warm accent tones for urgency and secondary emphasis
- Neutral surfaces for readability and contrast

## 6. Accessibility and Usability Guidelines

- Interactive controls use clear text labels
- Form controls include associated labels
- Buttons have explicit states (default/hover/disabled)
- Language and network state are presented in plain text
- Important actions avoid icon-only ambiguity

## 7. State and Feedback Patterns

- Loading: explicit helper copy for long operations
- Success: clear, short confirmation messages
- Error: inline error text near related controls
- Empty states: descriptive guidance and recovery actions

## 8. Implementation References

Primary implementation files:
- `apps/frontend/src/App.jsx`
- `apps/frontend/src/styles.css`
- `apps/frontend/src/TranslationService.jsx`

Related backend dependencies for UX features:
- `apps/backend/routes/*.js`
- `apps/backend/controllers/*.js`

## 9. QA Focus Areas

When validating UI changes, prioritize:
- Search-only top nav behavior across roles
- Bottom dock stability on mobile
- Profile action center parity with former top-menu actions
- AI feature launcher flow (button first, form second)
- No regression in appointment booking and call entry
