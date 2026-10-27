// One shape for an event, whichever calendar it came from. Everything after
// the provider (matching, time off, the review page) reads only this.
export type CalPerson = { email: string; name: string | null };

export type CalEvent = {
  /** Stable per occurrence: the provider's id plus this occurrence's start. */
  key: string;
  title: string;
  /** The app's calendar day and clock time (DECISIONS #12); time is null all day. */
  day: string;
  time: string | null;
  endDay: string;
  allDay: boolean;
  organizer: CalPerson | null;
  attendees: CalPerson[];
  /** What the calendar says about availability, when it says. */
  busy: "busy" | "free" | "tentative" | "oof" | null;
  cancelled: boolean;
  /** A provider that marks out-of-office as its own kind of event (Google). */
  outOfOffice?: boolean;
  /** The time zone was not one we know, and the app's own was assumed. */
  zoneGuessed?: boolean;
};

export type SyncWindow = { from: string; to: string };
