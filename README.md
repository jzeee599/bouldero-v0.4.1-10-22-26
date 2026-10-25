# Bouldero 0.4.1-beta.1-local

Device-only field-test release — October 22, 2026.

## Deploy

1. Create a new GitHub repository, e.g. `bouldero-0.4.1-local-10-22-26`.
2. Upload the CONTENTS of this folder. `package.json` should be at the repository root.
3. Import that repository into a NEW Vercel project. Use Next.js, Node 22, and root directory `./`.
4. No Supabase integration or environment variables are needed. This build explicitly disables cloud access even if older environment variables exist.
5. Deploy, then open the new URL on your phone.

Old repositories and deployments can remain unchanged. This folder contains source code and bundled gym-map assets, not your personal session data.

## Bring your history

Export a backup from the old app in the phone/browser where your data lives. Save that JSON file. In this version open Session → Backup & transfer → Import backup. Review New / Replace counts, then confirm. Matching record IDs are replaced; unrelated records remain. You can export current data before confirming. Different domains have separate browser storage.

## What changed

- Import preview and explicit confirmation; duplicate-ID backups rejected.
- Last export date and end-session backup reminder.
- Unsaved-edit warnings, including photo-less lines and Quick log.
- Route switches preserve the original map/list return destination.
- Warm-up Sends return to browsing; same-wall switch suggestions first.
- Compact return-to-browsing action after logging a climb.

Browser close warnings are browser-dependent; drafts are not automatically recovered after force-closing a phone app. A download timestamp is not proof that the file was retained.

## Local development

`pnpm install`, then `pnpm dev`. Production: `pnpm build`.
