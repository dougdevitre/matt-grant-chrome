# CI & branch protection

CI is defined in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). On every push and
pull request it runs one job, **`build-and-test`**, which does `npm ci → typecheck → build →
test` on Node 20. The check shows up as **`CI / build-and-test`**.

Running CI is only half the value — until it's a *required* check, a red build can still be
merged. The steps below make `main` reject merges unless CI passes. This is a repository
**Settings** change (it can't be committed in a file), so an admin must do it once.

## Make CI required on `main`

1. Open the repo on GitHub → **Settings** → **Branches** (under "Code and automation").
2. Under **Branch protection rules**, click **Add branch ruleset** (or **Add rule** in the
   classic UI).
3. **Branch name pattern / target:** `main`.
4. Enable **Require a pull request before merging** (recommended: also require ≥1 approval).
5. Enable **Require status checks to pass before merging**, then:
   - Enable **Require branches to be up to date before merging**.
   - In the search box, add **`build-and-test`** (it appears once CI has run at least once on a
     PR — this repo already has runs, so it will be listed).
6. *(Optional, recommended)* Enable **Require conversation resolution before merging** and **Do
   not allow bypassing the above settings** so the rule applies to admins too.
7. **Create** / **Save changes**.

## Verify it works

- Open a throwaway PR that deliberately breaks a test (e.g. flip an assertion). The **Merge**
  button should be blocked with "Required statuses must pass."
- A PR where `CI / build-and-test` is green should show **All checks have passed** and allow
  merge.

## Notes

- The required check name is the **job** name (`build-and-test`), surfaced as
  `CI / build-and-test`. If you rename the job or workflow in `ci.yml`, update the required
  check in Settings to match, or merges will block on a check that never reports.
- New pushes to an open PR re-run CI automatically; "Require branches to be up to date" means a
  PR must also be rebased on the latest `main` before merging.
