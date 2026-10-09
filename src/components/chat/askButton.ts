/**
 * The board chat's Ask button, the part of the chat in the board's first load: its words and the
 * marker the panel and the tour find it by. The panel (`BoardChatPanel`, with `useBoardChat` and
 * `chatView`) is a dynamic import, fetched once the board is up (docs/BUNDLE.md).
 */

/** The Ask button's words (`CHAT_COPY` carries them too). */
export const CHAT_BUTTON_COPY = {
  button: "Ask",
  buttonHint: "Ask the tutor for problems, a graph or a figure",
} as const;

/** A marker the board page gives the Ask button: Esc there closes the panel too. */
export const CHAT_TOGGLE_ATTR = "data-chat-toggle";
