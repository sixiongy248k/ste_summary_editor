# SillyTavern Extension Environment Notes

Key SillyTavern extension development patterns — imports, APIs, paths, gotchas.

## SillyTavern Version
- User runs ST 1.17.0 at `E:\AI\STORY_AI\latestsilly_tavern\SillyTavern`

## How Extensions Are Loaded
- ST loads third-party extensions from `/public/scripts/extensions/third-party/{name}/`
- The entry point JS file (from `manifest.json` `"js"` field) is loaded as `<script type="module">`
- The script URL is: `/scripts/extensions/third-party/{name}/{manifest.js}`
- `script.onerror` fires if **any** module in the import chain fails to load (404, syntax error, etc.)
- The error message will be `[object Event]` because ST rejects with the raw Event object

## Importing SillyTavern APIs — DO NOT USE RELATIVE IMPORTS
- **WRONG:** `import { getContext } from '../../../extensions.js'` — relative path is fragile and often resolves to the wrong location
- **RIGHT:** `SillyTavern.getContext()` — global function, always available, used by all other third-party extensions
- `getContext()` returns: `characterId`, `groupId`, `characters`, `onlineStatus`, `activeModel`, `model`, `generateQuietPrompt()`, `getRequestHeaders()`, `mainApi`, `eventSource`, `event_types`, `callPopup`, `renderExtensionTemplateAsync`, `saveChat`, and more
- Other extensions (noass, SillyTavern-Presence) all use `SillyTavern.getContext()` global

## Key APIs Available via getContext()
- `context.generateQuietPrompt({ quietPrompt, skipWIAN, responseLength, quietImage, quietName, jsonSchema, removeReasoning, trimToSentence })` — send to LLM without appearing in chat. **Takes a single object, NOT positional args.** Old positional style is deprecated and maps incorrectly. There is NO system prompt parameter — embed instructions in `quietPrompt`.
- `context.getRequestHeaders()` — get auth headers for fetch calls to ST server
- `context.characters[context.characterId]` — current character info (`.avatar` for attachment key)
- `context.getChatCompletionModel()` — returns the active model name (e.g. "claude-3-7-sonnet-20250219")
- `context.mainApi` — API type string (e.g. "openai", "kobold")
- `context.onlineStatus` — `"no_connection"` when disconnected, other values when connected
- **No `activeModel` or `model` property exists** — use `getChatCompletionModel()` for model name
- `context.tags` — array of Tag objects: `{id, name, folder_type, color, color2, ...}`; `folder_type` is `"NONE"`, `"OPEN"`, or `"CLOSED"`
- `context.tagMap` — `{[avatar]: [tagId, ...]}` mapping character avatars to their assigned tag IDs
- `context.extensionSettings` — ST's `extension_settings` object (writable)
- `context.extensionSettings.character_attachments[avatar]` — array of character databank attachments
- `context.chatMetadata` — current chat metadata (`.attachments` for chat-level attachments)
- `context.saveSettingsDebounced()` — persist extension settings after modification

## Databank / File Attachments
- Server endpoint: `POST /api/files/upload` with JSON body `{ name: "unique_filename.txt", data: "<base64>" }`
- Returns `{ path: "/user/files/..." }` — the `path` is the file URL for the attachment record
- After upload, register attachment in `context.extensionSettings.character_attachments[avatar]`:
  ```js
  const attachment = { url: fileUrl, size: byteSize, name: displayName, created: Date.now() };
  context.extensionSettings.character_attachments[avatar].push(attachment);
  context.saveSettingsDebounced();
  ```
- Attachment sources: `character` (keyed by avatar), `chat` (in `chatMetadata.attachments`), `global` (in `extensionSettings.attachments`)
- The internal `uploadFileAttachmentToServer(file, target)` in `chats.js` is NOT accessible from third-party extensions — must replicate the upload + registration manually

## Magic Wand Menu
- The wand menu is `#extensionsMenu` (a `div.options-content`)
- Contains pre-defined `div.extension_container` children for built-in extensions (data_bank, attach_file, sd, etc.)
- Third-party extensions should append their own `div.extension_container` to `#extensionsMenu`
- Button pattern: `<div class="extension_container interactable"><div class="fa-fw fa-solid fa-icon extensionsMenuExtensionButton"></div>Label</div>`
- Do NOT use `.list-group-item` or `<a>` tags — those are not used in the wand menu

## File Serving
- ST serves the entire `public/` folder via `express.static` (server-main.js)
- All extension files are accessible at `/scripts/extensions/third-party/{name}/...`

## Extension Settings Panel
- Settings HTML loaded via `$.get('/scripts/extensions/third-party/{name}/settings.html')`
- Appended to `#extensions_settings2`

## Events
- `context.eventSource.on(context.event_types.CHAT_CHANGED, callback)` — fires when user switches characters or chats
- Both `eventSource` and `event_types` are available on `SillyTavern.getContext()`
- `CHAT_CHANGED` is the standard event used by extensions (backgrounds, expressions, cfg-scale, etc.)

## Gotchas
- `script.onerror` on module scripts fires for ANY failure in the dependency tree, not just the entry point
- PowerShell deploy scripts: avoid Unicode box-drawing characters (─, ═) and em dashes (—) — causes parse failures unless file has UTF-8 BOM
- jQuery is available globally (ST-native), no need to import it
- `getRequestHeaders()` returns headers needed for auth — must spread into fetch headers along with `Content-Type`
