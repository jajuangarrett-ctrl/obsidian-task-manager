# Talk to Vault synthetic workspace QA

Run from the repository root (with existing npm dependencies installed):

```sh
node docs/testing/live-workspace/build.mjs /tmp/fjg-live-qa
python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/fjg-live-qa
```

Open http://127.0.0.1:8765/. The iframe is sized to exactly 386, 600, or 1024 CSS pixels so the production media queries run. Select a width and **Reset fixture** before testing initial note placement.

1. Open **Talk to Vault**, choose **Type a message**, and enter “Find my budget”. On the narrow layout, toggle **Virtual keyboard** before sending to check the shrunken visual viewport.
2. Send, then open **Budget review**. The running chat should move into a mock workspace pane. The synthetic mobile host renders only one active native workspace leaf at every width. At 1024 px, the production chat lane occupies the left and the active Markdown note stays in the right-hand workspace. At 386 and 600 px, use the Chat/Note controls to switch the active leaf.
3. Open the **Native note overflow** (⋯) from the note header. Choose a menu item to confirm the control works independently of the conversation switch. Check the floating chat controls hide while the body-level native menu is open. Use **Chat** and **Note** to switch attention. At 1024 px, focus the chat input, fold to 386 px, and unfold again. Check the transcript, note and session counts persist.
4. With chat visible, send “Find my calendar” and open **Planning calendar**. The counters should show one session, one start, two sends, and zero mock microphone activations. End the conversation and check the end counter and current note.
5. Optionally close a note from its menu, return to chat, and reopen a reference. The fixture never changes a real note.

This bundles the production modal, conversation view, task retrieval, and stylesheet. The Obsidian host APIs, Markdown note contents, and Live session are deliberately synthetic. The harness makes no request to OpenAI and does not use credentials, vault files, WebRTC, a microphone, or playback. It does not verify Apple keyboard behavior or native Obsidian's rendering and event handling; do that on device separately. Use a tall browser window for a normal keyboard geometry check; the fixture keyboard removes 255 px of available visual height. The build output is disposable and should not be checked in.

For launch checks, select a 1024 px fixture viewport, then **Open fixture note** before **Talk to Vault**. The existing native note must stay open on the right and chat must appear on the left before the first Send. The mock session counters must remain at zero until explicit Send or Start. Use **Toggle overlay drawer** or **Toggle pinned drawer** to constrain the workspace without resizing the viewport. Talk should retain the compact chat surface until the width is usable again, without closing the fixture drawer itself or re-creating the note. Tests do not use a physical device, real vault, model, microphone, or API key.
