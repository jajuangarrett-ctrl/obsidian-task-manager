# Installation

## Obsidian

Build the monorepo and run the configurable vault installer. Enable **FJG Task Manager** in Community Plugins.

The installed folder contains only portable runtime files:

- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`

## Chrome

Load `apps/browser-clipper/dist` as an unpacked extension. In the extension settings, enter the catalog port and pairing token displayed by the Obsidian plugin, then test the connection.

Task creation works through the Obsidian protocol. Live Add Update search additionally requires Obsidian Desktop and the read-only catalog.

## Quick Capture and OpenAI

In **Settings → Community plugins → FJG Task Manager → Quick Capture AI**:

1. Enter an active OpenAI API key. If the older **Task Capture** plugin
   already has one, FJG Task Manager imports it automatically.
2. Keep `gpt-4.1-mini` as the drafting model unless a tested replacement is preferred.
3. Keep `gpt-4o-mini-transcribe` as the transcription model.
4. Use **Save & Test** to explicitly save and confirm the credential on
   iPhone, iPad, or desktop.
5. Leave **Draft after dictation** enabled to populate task fields immediately after transcription.

The key is stored in `.obsidian/plugins/fjg-task-manager/data.json`. Never add that file or a real key to the source repository.

## iOS Shortcut

The simplest shortcut uses a **URL** action followed by **Open URLs**:

```text
obsidian://advanced-uri?vault=FJG%20Vault&commandid=fjg-task-manager%3Aquick-capture
```

This opens the same touch-friendly capture modal used by the Obsidian command and ribbon action. Dictation can run inside the modal.

For an Apple Shortcuts-native voice handoff:

1. Add **Dictate Text**.
2. Add **URL Encode** for the dictated text.
3. Add a **Text** action containing `obsidian://fjg-task-manager?text=` followed by the encoded result.
4. Add **Open URLs**.

The dictated text appears in the capture field. The user reviews the AI draft before creating the task.
