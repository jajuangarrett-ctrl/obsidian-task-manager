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
