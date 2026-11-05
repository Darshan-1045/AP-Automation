# Project Instructions — Accounts Payable Automation

## Project Overview
This is an existing Accounts Payable Automation application.

## Technology Stack
- Frontend: React, Vite, Tailwind CSS, Axios, Recharts
- Backend: Python, Django, Django REST Framework
- Database: PostgreSQL
- OCR: Tesseract and Poppler
- AI: Groq API

## Development Rules
1. Always inspect existing files before modifying them.
2. Never recreate the existing application.
3. Preserve working functionality.
4. Never reset or delete the existing PostgreSQL database.
5. Avoid duplicate models, API endpoints and components.
6. Reuse existing serializers, views, services and frontend API functions.
7. Implement real API integrations, not static mock data.
8. Use proper error handling and validation.
9. Use DecimalField for monetary calculations.
10. Create safe database migrations.
11. Run Django checks after backend changes.
12. Run frontend lint and build after frontend changes.

## UI Guidelines
Preserve the existing design:
- Navy backgrounds
- Teal accents
- Slate surfaces
- Existing typography
- Responsive layouts

Do not redesign existing pages unnecessarily.

## Business Rules
- Invalid invoices must not be approved.
- Duplicate invoices must not be approved.
- Unverified vendors require manual review.
- Invoices with unresolved PO/GRN matching exceptions must not be approved.
- Unapproved invoices must not be paid.
- Protect sensitive vendor bank information.
- Preserve invoice approval history.

## Implementation Approach
Work in small phases:
1. Inspect.
2. Implement backend.
3. Create migrations.
4. Implement frontend.
5. Integrate APIs.
6. Test.
7. Fix errors.

Prioritize completing a functional application over unnecessary refactoring.

Never claim a feature is implemented unless it actually works.