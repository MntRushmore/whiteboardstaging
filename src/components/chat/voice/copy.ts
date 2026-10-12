/**
 * Ask's mic and voice, in words a 7-year-old reads (docs/ASK-V2.md: kid-simple, US English, second
 * person, calm). A line for the grown-up goes under the kid's when only a grown-up can fix it.
 */
export const ASK_VOICE_COPY = {
  /** the mic button's accessible name and tooltip */
  mic: "Talk to Ask",
  micTip: "Hold to talk, or tap to start and stop",
  micStop: "Stop and send",
  /** while it listens */
  listeningHold: "Listening… Let go when you're done.",
  listeningTap: "Listening… Tap when you're done.",
  /** the last seconds of the minute a recording may take */
  secondsLeft: (s: number) => `${s} second${s === 1 ? "" : "s"} left`,
  sending: "Getting your words…",
  nothing: "I didn't hear anything. Try again?",
  again: "Please say that one more time.",
  error: "Oops, that didn't work. Try again?",
  limited: "Let's wait a moment, then try again.",
  denied: "I can't hear you yet.",
  deniedHint: "Grown-up: allow the microphone for this site in the browser's settings.",
  noMic: "I can't find a microphone.",
  noMicHint: "Grown-up: plug in or turn on a microphone.",
  busy: "The microphone is busy.",
  busyHint: "Grown-up: close other apps that are using the microphone.",
  unsupported: "Talking doesn't work here. You can type instead.",
  /** the panel's speaker toggle */
  speakerOn: "Read answers out loud",
  speakerOff: "Stop reading answers out loud",
  /** said once, right after the panel's speaker is switched on */
  turnedOn: "Okay. I'll read my answers out loud.",
} as const;
