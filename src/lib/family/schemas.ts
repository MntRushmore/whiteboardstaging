/**
 * The /api/family request bodies, as the routes validate them (zod). One place, so the family page's
 * forms and the server agree on what a name, a grade, a picture and a PIN may be
 * (src/lib/family/contracts.ts has the rules: NAME_MAX, GRADES, AVATARS, PIN_PATTERN).
 */
import { z } from "zod";
import { AVATARS, NAME_MAX, PIN_PATTERN, type AvatarId } from "./contracts";

const AVATAR_IDS = Object.keys(AVATARS) as [AvatarId, ...AvatarId[]];

/** A profile's name: trimmed, 1–NAME_MAX characters, no control characters. */
export const nameSchema = z
  .string()
  .trim()
  .min(1, "Give them a name.")
  .max(NAME_MAX, `A name is at most ${NAME_MAX} characters.`)
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "A name can't have control characters.");

/** 0 (Kindergarten) to 8, or null for a high-school course. */
export const gradeSchema = z.number().int().min(0).max(8).nullable();

export const avatarSchema = z.enum(AVATAR_IDS);

export const pinSchema = z.string().regex(PIN_PATTERN, "A PIN is exactly 4 digits.");

/** POST /api/family/pin: set or change the grown-up's PIN. */
export const SetPinSchema = z.object({ pin: pinSchema }).strict();

/** POST /api/family/kids (AddKidInput). */
export const AddKidSchema = z.object({ displayName: nameSchema, grade: gradeSchema, avatar: avatarSchema }).strict();

/** PATCH /api/family/kids/<id>: any of the three. */
export const EditKidSchema = z
  .object({ displayName: nameSchema.optional(), grade: gradeSchema.optional(), avatar: avatarSchema.optional() })
  .strict()
  .refine((v) => v.displayName !== undefined || v.grade !== undefined || v.avatar !== undefined, "Nothing to change.");

/** POST /api/family/switch (SwitchInput). */
export const SwitchSchema = z.object({ to: z.string().uuid(), pin: pinSchema.optional() }).strict();

export type EditKidInput = z.infer<typeof EditKidSchema>;
