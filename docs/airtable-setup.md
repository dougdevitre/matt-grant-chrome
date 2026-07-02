# Airtable storage setup

The service defaults to an in-memory store. To persist to Airtable, set
`STORE_DRIVER=airtable` and provide `AIRTABLE_PAT` (a personal access token, stored as an
SSM SecureString — never committed) and optionally `AIRTABLE_BASE_ID` (defaults to
`appiuSYCexFUmGIOr`). In production the service refuses to boot if `STORE_DRIVER=airtable`
but `AIRTABLE_PAT` is missing (see `assertSecureStartup` in `service/src/config.ts`).

The adapter (`service/src/lib/storeAirtable.ts`) stores the full typed object as a JSON blob
in a `Data` field and mirrors a few values into single-line-text columns so reads can use
Airtable's `filterByFormula` instead of scanning the whole table. **Create these tables and
columns in the base before switching the driver on**, or point reads/upserts will silently
create duplicate rows.

## Tables and columns

Every table needs a long-text **`Data`** field. Add the extra columns below (all single-line
text). Columns marked **(read)** are queried by `filterByFormula` and must exist; the others
are for human-readable filtering in the Airtable UI.

| Table          | Required columns (besides `Data`)                          |
| -------------- | ---------------------------------------------------------- |
| `Tasks`        | `RecordId` **(read)**, `Status`, `Zip`                     |
| `Events`       | `RecordId` **(read)**, `County`                            |
| `Shifts`       | `RecordId` **(read)**, `EventId`                           |
| `Templates`    | `RecordId` **(read)**, `Category`                          |
| `Contacts`     | `RecordId` **(read)**, `ContactKey` **(read)**, `Zip`, `RegStatus` |
| `ContactLogs`  | `ContactId`                                                |
| `OptOut`       | `ContactKey` **(read)**                                    |
| `Outbox`       | `IdempotencyKey` **(read)**, `Status`                      |
| `Audit`        | `Action`, `Seq` (number) **(read)**, `Hash`                |
| `FollowUps`    | `RecordId` **(read)**, `ContactId`, `Status`               |
| `TeamMembers`  | `RecordId` **(read)**, `ClerkId` **(read)**, `CaptainClerkId` |

Notes:
- `RecordId` holds our own UUID (not Airtable's `rec…` id); the adapter upserts by matching it.
- `ContactKey` is the opaque, non-reversible recipient key (no raw PII is stored).
- `IdempotencyKey` makes the outbox replay check a point read, preserving send idempotency.
- `FollowUps` backs the GOTV reminder feature (`/followups`, `POST /contacts/:id/followups`, and the
  Turnout tab's reminders list). Without this table, those endpoints 500 under `STORE_DRIVER=airtable`.
- `TeamMembers` is the volunteer roster that powers the **Team** tab for `team_captain` users:
  `ClerkId` (the volunteer's Clerk id — blank until they first sign in), `CaptainClerkId` (their
  captain), plus display name/email/phone in the `Data` blob. Captains **invite by email** from the
  panel (the row is "pending" with a blank `ClerkId`); the `ClerkId` is filled automatically the first
  time that person signs in with the invited email. Admins can also seed rows directly. Only needed if
  you use team captains.

## Verifying

Switch the driver on in a non-production env (`STORE_DRIVER=airtable`, `AIRTABLE_PAT=…`) and
hit `GET /tasks` (with a valid clerk token). The adapter's contract — auth header, `Data`
blob + the columns above, upsert-by-`RecordId`, pagination, and the keyed point reads — is
covered by `service/src/__tests__/storeAirtable.test.ts` against a fake Airtable REST server,
so logic regressions are caught in CI without needing live credentials.
