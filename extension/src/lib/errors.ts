// Map a server error code (the `error` field the API surfaces as an Error
// message) to a clerk-friendly sentence. Unknown codes pass through unchanged.

export function messageForError(code: string): string {
  switch (code) {
    case "version_conflict":
      return "This changed since you loaded it — refreshed; please retry.";
    case "quiet_hours":
      return "Outside texting hours (8am–9pm local). Try again later.";
    case "no_consent":
      return "No SMS consent on file for this contact.";
    case "sms_admin_only":
      return "Texting is restricted to admins.";
    case "step_up_required":
      return "Re-authorize to send a text.";
    case "rate_limited":
      return "Too many sends just now — wait a moment.";
    case "sms_disabled":
      return "Texting is currently disabled.";
    case "sms_cap_reached":
      return "The daily text cap has been reached.";
    case "not_signed_in":
    case "missing_token":
    case "invalid_token":
      return "Your session expired — please sign in again.";
    case "forbidden":
      return "That action isn't available for your role.";
    // Generic operation failures surfaced by the panels — keep them human.
    case "load_failed":
      return "Couldn't load this. Check your connection and try again.";
    case "resolve_failed":
      return "Couldn't look that up. Check your entries and try again.";
    case "sign_in_failed":
      return "Sign-in didn't go through. Please try again.";
    case "draft_failed":
    case "action_failed":
    case "batch_failed":
    case "preview_failed":
    case "commit_failed":
    case "save_failed":
    case "polling_failed":
    case "schedule_failed":
      return "That didn't go through. Please try again.";
    default:
      // Never surface a raw snake_case code to a clerk.
      return /^[a-z0-9]+(_[a-z0-9]+)+$/.test(code)
        ? "Something went wrong. Please try again."
        : code;
  }
}
