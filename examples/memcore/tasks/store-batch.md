Read `.bench-memory/records.md` in the current workspace. It contains several `key:` / `memory:` pairs separated by `---` lines.

Store every pair exactly with a separate `memcore_remember` call, using each given key and a semantic kind. This is an explicit memory-write task; do not merely describe the facts in your reply. Do not modify the input file. Reply with exactly `BATCH_STORED` and nothing else.
