# Talk to Vault 0.30.17 acceptance

## Corrected behavior

Typed requests use the same Live session and objective tools as voice. The existing outgoing `response.item.create` then `response.create` events are retained. Incoming null/omitted delegation IDs are now normalized locally for app-initiated Responses, which were previously discarded by the tool loop. Response-specific lifecycle tracking keeps Send busy until outstanding tool continuations finish, and cancelled/incomplete responses do not unnecessarily disconnect the conversation. A local channel-send failure preserves the draft and closes an ambiguously queued session instead of automatically resending it.

The generated silent audio context is prepared synchronously within Send before asynchronous saved-key lookup. This preserves the initiating user gesture without opening a microphone. An asynchronous server rejection after local send acceptance still uses session-error behavior; it is not automatically retried.

Selecting an exact resolved objective preserves the original chat DOM, audio element, transcript, draft and session. Desktop uses registered native workspace panes. Mobile reserves a scoped left lane in the existing visible workspace root when actual available width is at least720px (680px exit threshold). The native selected Markdown note stays in-place, not cloned into chat or moved out of its editor. Narrow or unavailable hosts use explicit Chat/Note switching. Another Talk plugin's occupied lane triggers fallback rather than overlapping panels.

Close/cancel, replaced or detached panes, unavailable notes, cross-window hosts and late asynchronous navigation are guarded. Cleanup only removes owned panes/classes/properties/listeners; it retains the native note and never detaches a user-repurposed view. Existing mutation permissions, retrieval scope, key storage, native overflow menus and global touch handling are unchanged.

## Checks passed

- `npm run check`: TypeScript,389 Vitest tests,8 mail-capture tests and all required workspace builds.
- `npm run package:release`: plugin and Chrome ZIPs plus root BRAT files, with manifest/version0.30.17.
- Focused unit regressions include nullable delegation tools, repeated/overlapping responses, cancelled/incomplete calls, both local-send failure boundaries, silent-audio priming, failed navigation, exact audio/draft continuity, foreign-pane protection, close during key lookup/openFile/revealLeaf, mobile lane cleanup and fold/keyboard transitions.
- Real Chrome running the synthetic single-active-native-tab host at386,600 and1024 CSS pixels: actual production lane and controls, two queries/notes without a second session or microphone activation, fold/unfold preserving draft, native mock overflow/menu center-hit checks, Chat/Note switching, and End/Close retaining the active note.
- Typical simulated keyboard heights and extreme185px visible height: Send, Hide typing and End remain reachable. The extreme case originally clipped Send and was corrected before release.
- Independent computer-use check:1024px chat-left/note-right, native mock menu action, compact Chat return, same unchanged draft after unfolding, one session/one start/zero mic, and Close leaving the native mock note open.

## Honest limits

The browser host, session, Markdown fixtures and microphone are synthetic. These checks do not verify physical iPhone/Duo rendering, real Obsidian native menu internals, Apple keyboard/permissions, playback or a real OpenAI session. The reported device incident is not reproduced end-to-end; the typed protocol and lifecycle defects above are confirmed source defects. No live vault, credentials, real API call, physical install or native/global menu patch was used. The standard BRAT release still needs normal device use to confirm real-host behavior.

Protocol references: https://developers.openai.com/api/docs/guides/live-delegation#accept-typed-input and https://developers.openai.com/api/reference/resources/live/primary-websocket#response.event.
