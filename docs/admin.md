# The admin panel

Kora's own staff use `/admin`. It is not part of a business's app: it sees across all businesses, so access is narrow and every change is logged.

## Who gets in

1. The e-mail address of the signed in account is in `KORA_ADMIN_EMAILS` (comma separated). Empty means the panel is off.
2. The account has an authenticator app turned on (Security page) and this sign-in used its code. A password or e-mail code alone is not enough.

Anyone else, signed in or not, gets the ordinary 404 page and the API answers 404, so the address tells a visitor nothing. Both checks run on every request (`adminRoute` in `apps/web/lib/server.ts`, and `app/admin/layout.tsx`).

## What it shows and does

| Tab | Shows | Can change |
|---|---|---|
| Overview | businesses, people, issued this month, monthly recurring revenue, plan counts; things needing attention: failed plan payments, failed and waiting jobs, open and overdue privacy requests, breaches not fully notified, gateway payments not applied | nothing |
| Businesses | search by name or GSTIN; people, plan, subscription, payments, usage | the plan, status and paid-to date by hand (a reason is required) |
| Users | search by name, e-mail or number; authenticator on or off, devices, businesses | sign the person out everywhere and clear a lock |
| Privacy requests | DPDP requests by due date, overdue marked | answer, mark being looked at, done or cannot do (an answer is required to close) |
| Breaches | the register | record a breach; mark contained; record when the Board and the people were told |
| Jobs | queue counts, oldest waiting, failed jobs with the last error | put all failed jobs back in line |
| Admin log | every change above, with who and when | nothing (append only) |

The panel never shows invoice contents, customer details or documents. The database functions behind it (`0193_admin.sql`) return only the fields in the tables above.

## Limits of this design

- The database cannot know who an admin is. The application role can call the `admin_*` functions, so the allowlist and authenticator check are the control. A bug that lets a request reach those functions as a normal user would expose the overview, business and user lists. Keep the admin list short and review the log.
- The log records changes, not reads.
- There is no "suspend a business" switch yet. To stop a business, set its plan to Starter and revoke its owner's sessions.
- Impersonating a user ("log in as") is deliberately not built.
