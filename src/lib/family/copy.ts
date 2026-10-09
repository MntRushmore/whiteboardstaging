/**
 * Every word the family features say: the profile switcher and its PIN pad, the Family page, the
 * account page's Family card, and what a kid sees where a grown-up would see billing. In one place
 * because the readers are a 6-year-old (the switcher: few, short, friendly words) and the grown-up
 * who pays (the Family page: plain about what removing a kid deletes). Pure data.
 */
import { MAX_KIDS, NAME_MAX } from "./contracts";
import { FAMILY_MENU } from "./menu";

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

export const FAMILY_COPY = {
  // ------------------------------------------------------------------ the switcher (app bar)
  switcherLabel: (name: string) => `${name}'s profile. Switch profile`,
  pickerTitle: "Who's practising?",
  pickerHint: "Tap your picture.",
  grownUpLocked: "Needs the grown-up's PIN",
  you: "You",
  switching: "Switching…",
  manageFamily: "Manage family",
  switchFailed: "Couldn't switch profiles. Try again.",
  /** the picker opened before the family was read, or the read failed */
  pickerLoading: "Getting everyone's pictures…",
  pickerFailed: "Couldn't load the profiles. Check your connection and try again.",
  pickerRetry: "Try again",

  // ------------------------------------------------------------------ the PIN pad
  pinTitle: (name: string) => `${name}'s PIN`,
  pinHint: "Grown-ups only: enter your 4-digit PIN.",
  pinBack: "Back",
  pinDelete: "Delete last digit",
  pinDigit: (d: string) => `Digit ${d}`,
  pinWrong: (triesLeft: number | null) =>
    triesLeft === null ? "That PIN isn't right." : triesLeft === 0 ? "That PIN isn't right. No tries left for now." : `That PIN isn't right. ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left.`,
  pinLocked: (retryAfterMs: number) => `Too many tries. Try again in ${minutes(retryAfterMs)} minute${minutes(retryAfterMs) === 1 ? "" : "s"}.`,
  pinNoPin: "Your grown-up hasn't set a PIN yet. Ask them to sign in.",
  pinChecking: "Checking…",

  // ------------------------------------------------------------------ the header menu
  switchProfile: FAMILY_MENU.switchProfile,
  family: FAMILY_MENU.family,

  // ------------------------------------------------------------------ the Family page
  pageTitle: "Family",
  pageSubtitle: "One plan for everyone. Each kid gets their own boards, progress and picture.",
  back: "Back to boards",
  loadFailedTitle: "Couldn't load your family",
  loadFailed: "Check your connection and try again.",
  retry: "Try again",
  kidsOnly: "Only a grown-up can manage the family.",
  kidsOnlyHint: "Switch to the grown-up's profile to add or change kids.",

  pinCardTitle: "Your PIN",
  pinCardNew: "Set a 4-digit PIN first. Kids switch profiles by tapping their picture; getting back to yours needs this PIN.",
  pinCardSet: "Getting back to your profile needs this PIN. Kids never need one.",
  pinLabel: "New PIN",
  pinConfirmLabel: "Type it again",
  pinMismatch: "The two PINs don't match.",
  pinInvalid: "A PIN is exactly 4 digits.",
  pinSave: "Set PIN",
  pinChange: "Change PIN",
  pinSaved: "PIN saved.",
  pinSaveFailed: "Couldn't save your PIN. Try again.",

  kidsTitle: "Kids",
  kidsEmpty: "No kids yet",
  kidsEmptyHint: "Add a profile for each kid. They share your plan.",
  kidsNeedPin: "Set your PIN above, then add your kids.",
  addKid: "Add a kid",
  addKidTitle: "Add a kid",
  addKidHint: "They'll switch in by tapping their picture. No email or password needed.",
  nameLabel: "Name",
  namePlaceholder: "First name or nickname",
  nameMissing: "Give them a name.",
  nameTooLong: `A name is at most ${NAME_MAX} characters.`,
  gradeLabel: "Grade",
  gradeNone: "High school / not sure",
  avatarLabel: "Picture",
  addKidSave: "Add kid",
  addKidFailed: "Couldn't add the kid. Try again.",
  addKidAdded: (name: string) => `${name} is ready to practise.`,
  tooMany: `A family can have up to ${MAX_KIDS} kids.`,
  consent: "By adding a kid you agree to the Terms and Privacy Policy for them.",

  streak: (n: number) => (n > 0 ? `${n}-day streak` : "No streak yet"),
  problemsThisWeek: (n: number) => `${n} ${n === 1 ? "problem" : "problems"} this week`,
  mastered: (n: number) => `${n} ${n === 1 ? "skill" : "skills"} mastered`,
  noStats: "Numbers not available right now.",
  switchTo: (name: string) => `Switch to ${name}`,
  seeProgress: "See progress",
  edit: "Edit",
  editTitle: (name: string) => `Edit ${name}`,
  editSave: "Save",
  editFailed: "Couldn't save. Try again.",
  remove: "Remove",
  removeLabel: (name: string) => `Remove ${name}`,
  removeTitle: (name: string) => `Remove ${name}?`,
  removeBody: (name: string) =>
    `This deletes ${name}'s profile for good: their boards, their progress and everything they made. This can't be undone.`,
  removeConfirm: (name: string) => `Remove ${name}`,
  removeFailed: "Couldn't remove the profile. Try again.",
  removed: (name: string) => `${name}'s profile was removed.`,
  cancel: "Cancel",

  // ------------------------------------------------------------------ the account page and billing, for a kid
  accountCardTitle: "Family",
  accountCardBody: "Add your kids so they share your plan, each with their own boards and progress.",
  accountCardBodyKids: (n: number) => `${n} ${n === 1 ? "kid shares" : "kids share"} your plan.`,
  accountCardLink: "Manage family",
  kidBillingTitle: "Your plan",
  kidBilling: "Your grown-up looks after this.",
  kidBillingHint: "Ask them if you have a question about Agathon Unlimited.",
  kidPlanTitle: "Almost there!",
  kidPlanBody: "Ask them to start Agathon Unlimited from their profile, then you can practise.",
  kidPlanSwitch: "Tap your picture at the top to switch to your grown-up.",
  /** the board's ink dialog and the Ask and lecture panels, for a kid whose help needs the grown-up's plan */
  kidHelpPausedTitle: "Ask your grown-up",
  kidHelpPaused: "Help is taking a break right now. Ask your grown-up to check Agathon on their profile.",
  /** the account page, for a kid: no billing in its subtitle; the grown-up changes the cards on /family */
  kidAccountSubtitle: "Your profile and grade.",
  kidProfileDescription: "How you appear in the app.",
  kidNameHint: "Your grown-up can change your name on their Family page.",
  kidGradeDescription: "Your tutor picks problems for this grade.",
  kidGradeHint: "Your grown-up can change your grade on their Family page.",
  kidGradeNone: "Not picked yet",
  deleteAlsoKids: (names: string) => `It also deletes your kids' profiles (${names}), with their boards and progress.`,
  kidDeleteTitle: "Your profile",
  kidDelete: "Only your grown-up can remove this profile, from their Family page.",
} as const;
