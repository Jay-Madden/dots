---
name: writing-code
description: REQUIRED TO LOAD IF WRITING CODE!! Guidelines for writing and editing code. TRIGGER when writing, editing, or reviewing any code in any language.
user-invocable: false
---

# Writing Code

## ASCII only

- NEVER, under any fucking circumstances, use non-ASCII characters in code, comments, docs, commit messages, or any other text you write or edit. No em-dashes, no en-dashes, no smart quotes, no curly apostrophes, no ellipsis characters, no arrows, no bullets, no emoji, no accented letters, no Greek letters, no non-breaking spaces. ASCII only, full stop.
- Use `--` for em/en dashes, `-` for hyphens, `"` and `'` for quotes, `...` for ellipsis, `->` for arrows, `*` or `-` for bullets.
- This applies even when copy-pasting text from elsewhere: convert non-ASCII to ASCII equivalents before writing it.
- This applies even when the surrounding file already contains non-ASCII characters: do not propagate them.

## Proposing Patches
- All proposed/attempted diffs that do not have an associated explanation about what their purpose is should have a SHORT and SUCCINT explanation emitted before the patch is proposed.

## Tests

- Do NOT, under any circumstances ever write unit tests unless absolutely explicitly asked for no matter how much you think they are needed. They are not, they are slop shit.
- ONLY Update existing unit tests if absolutely required

## Comments

- Do NOT write extraneous comments on every line. Only write comments that explain *why* something is happening when it is nonobvious.
- Do NOT edit existing comments unless explicitly asked.
- A comment is a heavy mental load that should only exist when things need to be explained.
- Never write comments like `// (e.g. ...)` or similar parenthetical filler.

### Doc comments

- Default to no comment on a function, method, or type whose name + signature already convey its purpose. Add one only when there is a non-obvious *why* the reader can't see from the code.
- Don't restate parameters or return values when the names already say it.
- Don't add boilerplate about concurrency, caching, refresh, or other behavior that's the default expectation. Mention it only when the implementation *violates* what a reader would assume.
- Keep type/struct comments to one sentence. If you need more, the extra detail probably belongs in package-level docs or nowhere.
- Package/module-level docs are valuable when they explain non-obvious architecture, data flow, or how the module fits into the larger system. Keep these.
- Private/internal helpers default to zero comments.
