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
      return "Please sign in again.";
    default:
      return code;
  }
}
