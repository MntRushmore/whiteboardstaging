/**
 * Pure state machine behind useFeatureLabs (src/lib/featureLabs.ts).
 * Optimistic toggle -> persist; on failure the toggle reverts and the panel
 * shows an inline "Couldn't save this setting" with Retry.
 */

export type FeatureFlags<K extends string> = Record<K, boolean>;

export type SaveFailure<K extends string> = {
  key: K;
  /** The value the user asked for (retry re-sends this). */
  wanted: boolean;
  message: string;
};

export type FeatureLabsState<K extends string> = {
  features: FeatureFlags<K>;
  /** Key whose upsert is in flight, or null. */
  saving: K | null;
  failure: SaveFailure<K> | null;
};

export type FeatureLabsAction<K extends string> =
  | { type: "loaded"; features: Partial<FeatureFlags<K>> }
  | { type: "toggle"; key: K; enabled: boolean }
  | { type: "persisted"; key: K }
  | { type: "persistFailed"; key: K; wanted: boolean; previous: boolean; message: string }
  | { type: "dismissFailure" };

export const FEATURE_SAVE_FAILED_MESSAGE = "Couldn't save this setting";
export const FEATURE_SAVE_FAILED_TOAST =
  "That setting didn't save, so it was switched back. You can retry from the panel.";

export function featureLabsReducer<K extends string>(
  state: FeatureLabsState<K>,
  action: FeatureLabsAction<K>,
): FeatureLabsState<K> {
  switch (action.type) {
    case "loaded":
      return { ...state, features: { ...state.features, ...action.features } };
    case "toggle":
      return {
        features: { ...state.features, [action.key]: action.enabled },
        saving: action.key,
        failure: null,
      };
    case "persisted":
      return state.saving === action.key ? { ...state, saving: null } : state;
    case "persistFailed":
      return {
        features: { ...state.features, [action.key]: action.previous },
        saving: state.saving === action.key ? null : state.saving,
        failure: { key: action.key, wanted: action.wanted, message: action.message },
      };
    case "dismissFailure":
      return state.failure ? { ...state, failure: null } : state;
  }
}

/**
 * user_settings is protected by RLS; a request without a bearer token is a
 * guaranteed 401. Only fetch once the session carries an access token.
 */
export function canFetchSettings(
  session: { access_token?: string | null; user?: { id?: string } | null } | null | undefined,
): boolean {
  return !!session && typeof session.access_token === "string" && session.access_token.length > 0 && !!session.user?.id;
}
