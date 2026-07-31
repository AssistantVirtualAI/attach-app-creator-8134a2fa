# Lemtel Softphone — Clean-up, rename and lighter visual pass

Scope: `apps/ava-softphone-desktop` (the app in the screenshots). Presentation only — no SIP/business logic touched.

## 1. Header clean-up (per the drawing)

- Title bar: rename "AVA Softphone" to "Lemtel Softphone" (also window title in `index.html`).
- Title bar: remove the small logo next to that title.
- In-app header: remove the Lemtel logo + "Lemtel" text block on the left, so the header shows only the extension, the status dot and the user name (centered, now with room to breathe).

## 2. Remove noisy status blocks

- Remove the green "SIP enregistré — Ext 300" banner from the dialer. The live SIP state stays visible via the colored dot next to the extension (with tooltip). Error/connecting states still show a compact banner only when something is wrong.
- Remove the faint "READY TO DIAL · EXT 300" caption under the dialed number (circled in the screenshot); keep the number display itself, but make the number and the placeholder clearly readable.

## 3. Smaller footer

- Collapse the footer to a single compact line: small Lemtel mark + "Lemtel Communications" + version + "Powered by AVA Statistic".
- Drop the second stacked row and the AI badge; reduce padding/height roughly by half so it stops eating vertical space.

## 4. Lighter, more readable UI (all pages)

- The softphone pane currently hardcodes a very dark gradient and dim text colors, which is why text looks washed out. Replace those literals with the shared theme tokens so the app follows the selected theme.
- Raise the default brightness: lighter surface/background gradient, stronger glass surfaces, higher-contrast borders.
- Text contrast pass: promote dim/muted greys to the readable token values (keypad letters ABC/DEF, list secondary text, tab labels, placeholders, empty states, timestamps).
- Apply the same token pass across the other views: Contacts, Chats/SMS, Calls/Recents, Keypad, Speed Dial, Voicemail, Recordings, Settings, Setup wizard.
- Verify contrast on the keypad digits, which are currently near-invisible against the tile background.

## Technical notes

Files touched:
- `src/components/TitleBar.tsx` — rename, remove logo.
- `src/components/SoftphonePane.tsx` — header logo removal, SIP banner removal, "ready to dial" caption removal, footer compaction, token-based colors.
- `src/components/BrandTagline.tsx` — compact single-line variant.
- `src/components/DialerKeypad.tsx`, `src/styles/futuristic.css` — brighter tiles, higher-contrast digit/letter colors.
- `src/lib/theme.tsx` — brighten the dark/midnight token set (text, textMuted, borders, surfaces) so every view benefits.
- `index.html` — window/document title.
- Sweep remaining hardcoded dim colors in list/view components.

No changes to SIP registration, call handling, or backend functions.
