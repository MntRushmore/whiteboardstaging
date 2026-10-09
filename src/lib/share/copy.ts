/**
 * The share feature's words (2026-10-09, Phase 2 "parents recommend it"): the button, the sheet and
 * what the progress card says. Kept apart from the card's layout so the button — the only part a
 * page loads up front — carries a few strings and nothing else.
 *
 * Voice: the card talks ABOUT the student to whoever sees it ("Maya's week"), never "you"; the sheet
 * talks to the grown-up holding the phone.
 */

export const SHARE_COPY = {
  button: "Share progress",
  title: "Share this week",
  description: "A picture of this week to send to family and friends.",
  nameLabel: "Name on the picture",
  showName: "Show name",
  hideName: "Hide name",
  share: "Share",
  save: "Save image",
  copyLink: "Copy link",
  copied: "Link copied",
  rendering: "Drawing the picture…",
  renderFailed: "The picture didn't draw. Try again in a moment.",
  retry: "Try again",
  shareFailed: "Couldn't open sharing here. Save the image instead.",
  saveFailed: "Couldn't save the image. Try again in a moment.",
  copyFailed: (link: string) => `Couldn't copy the link. It's ${link}`,
  privacy: "Only a first name is ever shown. No email, school or last name.",
  previewAlt: (sentence: string) => `The progress card: ${sentence}`,
  /** the file's name: no student name in it, so a saved file never says who */
  fileName: (day: string) => `agathon-week-${day}.png`,
} as const;

/** "Save video" on the student's replay, and what the video says. */
export const REPLAY_VIDEO_COPY = {
  save: "Save video",
  making: "Making your video…",
  drawing: "Drawing each moment",
  recording: "Recording",
  cancel: "Cancel",
  ready: "Your video is ready!",
  share: "Share",
  download: "Save video",
  done: "Done",
  failed: "The video didn't save. Try again in a moment.",
  shareFailed: "Couldn't open sharing here. Save the video instead.",
  unsupported: "This browser can't make videos. Try Chrome or Safari.",
  empty: "There's nothing on this board to make a video of yet.",
  /** the page was hidden mid-recording and this browser could not pause it */
  keepOpen: "Keep this tab open while the video is made, then try again.",
  shareTitle: "My board on Agathon",
  brand: "Agathon",
  site: "agathon.app",
  /** the login page's own line */
  tagline: "The whiteboard that writes back.",
} as const;

/** What the card itself says. */
export const CARD_COPY = {
  title: (name: string | null) => (name ? `${name}’s week` : "This week"),
  problems: (n: number) => (n === 1 ? "problem this week" : "problems this week"),
  /** set over two lines where it is big (the line break is the copy's) */
  fresh: "Ready for\na new week",
  independent: "solved without help",
  streak: "days in a row",
  mastered: "Skills mastered",
  brand: "Agathon",
  site: "agathon.app",
} as const;
