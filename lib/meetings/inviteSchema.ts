import { z } from "zod";
import { clockTime, isoDate } from "../proposals/schema";

// A pasted calendar invite, read into the fields the New meeting form has.
//
// Bounded below the MeetingPatch limits so an over-long value fails inside
// runStructured's repair loop rather than at the write, which is the same
// reason every other schema in this app is bounded.
export const MeetingInvite = z.object({
  /** The invite's subject line, as written. */
  title: z.string().min(1).max(200),
  // Non-null: a meeting needs a date, and unwrapping the shared schema keeps
  // the one regex the write path uses.
  held_at: isoDate.unwrap(),
  /** Null when the invite gives no time, or gives one this cannot read. */
  held_time: clockTime,
  /**
   * The timezone the invite names, copied verbatim — "Pacific Time", "PT",
   * "Europe/London", "GMT+1".
   *
   * The model must not convert. Timezone arithmetic is exactly the kind of
   * thing it will do confidently and occasionally wrong, and a meeting stored
   * an hour out is worse than one with no time at all — which is why
   * held_time is nullable in the first place. The app converts, in code, and
   * says what it did.
   */
  time_zone: z.string().max(60).nullable(),
  attendees: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        email: z.string().max(200).nullable(),
        /** Verbatim from the paste, so the name can be checked against it. */
        quote: z.string().min(1).max(400),
      }),
    )
    .max(50),
});

export type MeetingInvite = z.infer<typeof MeetingInvite>;
