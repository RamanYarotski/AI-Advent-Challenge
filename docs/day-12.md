# Day 12. Personalization

## Task

Add personalization on top of the memory model: create a user profile, describe style, format, and constraints, and connect that profile to every assistant request.

## Product Direction

Day 12 continues the unified assistant rather than adding a separate demo. The assistant still chooses topic branches automatically, keeps short-term dialog state in JSON, and stores working and long-term memory in editable Markdown files.

Personalization is not the assistant role. The assistant role describes what the assistant is. The user profile describes who the assistant is helping and how responses should adapt.

## User Profiles

Profiles are stored as a file-backed long-term personalization layer in the memory folder:

```text
user-profiles.json
```

Each profile includes:

- Name.
- Role / context.
- Style.
- Format.
- Constraints.

The app seeds two profiles:

- Senior engineer.
- Beginner product owner.

Users can create, rename, delete, select, and edit profiles. If the last profile is deleted, the app creates a new empty default profile and activates it. The active profile is injected into every request together with the selected branch summary, recent branch messages, working memory, and long-term memory.

The assistant can also suggest profile updates from explicit user preferences in the current message. A separate language-agnostic profile extractor runs before the main assistant call, so Russian, English, and other input languages go through the same schema-first flow. Suggested profile values are stored in canonical English, while `sourceText` keeps the user's original wording. Suggestions are stored as pending updates and must be applied or dismissed before they change `user-profiles.json`.

When the extractor finds profile suggestions for the current user message, the main assistant call is told not to duplicate those unconfirmed preferences into working or long-term memory. This keeps personalization preferences in the profile confirmation flow and leaves long-term memory for reusable facts and durable global rules.

Prompt assembly is profile-scoped. New chat messages are tagged with the active `profileId`, and the LLM receives only the active profile's recent branch messages and branch summary. The active profile is authoritative for questions about style, format, role/context, and constraints. Legacy profile-like notes in working or long-term memory are filtered before prompt assembly so they cannot override the selected profile.

## Settings Window

The main assistant screen stays focused on chat. A settings button opens a dedicated window with left-side navigation:

- Profile: create, rename, delete, select, and edit user profiles.
- Suggested profile updates: review explicit preference suggestions, then apply or dismiss them.
- Memory location: move known memory files to another server-visible folder and review fixed file paths.
- Saved memory: inspect working and long-term memory.
- Metrics: review global totals for the active memory store, including deleted dialogs.
- Metrics: inspect global memory-store totals.

Memory file names are fixed to keep the storage layout predictable:

- `short-term-dialogs.json`
- `working-memory.md`
- `long-term-memory.md`
- `user-profiles.json`

## Trace

The memory routing trace shows which profile was applied, which layers were injected, and how many recent selected-branch messages were included.

## Test Scenarios

- Open the assistant and confirm the main screen is still a single chat workflow.
- Open settings from the gear button.
- Confirm every settings section scrolls.
- Create, rename, select, edit, and delete a profile.
- Delete the last profile and confirm a new empty default profile appears.
- Switch between Senior engineer and Beginner product owner profiles.
- Send the same prompt with different active profiles and compare answer style and structure.
- Edit profile style, format, or constraints and confirm the next answer reflects the change.
- Send "I prefer concise answers with bullet points" and confirm a suggested profile update appears.
- Send "предпочитаю лаконичный стиль общения и ответы списками" and confirm a suggested profile update appears with an English value and Russian source text.
- Apply the suggested update and confirm the active profile changes.
- Dismiss a suggested update and confirm the profile remains unchanged.
- Move the memory folder and confirm known memory files are moved, not copied.
- Open Saved memory and confirm only working and long-term memory are shown there.
- Open Metrics and confirm global totals are shown for each tracked metric.
- Open Metrics and confirm global memory-store totals are visible.
- Run `npm run lint` and `npm run build`.
