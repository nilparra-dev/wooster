## Summary

<!-- What changes for users, and why. Link the issue it resolves. -->

## Verification

<!-- The checks you ran and their result. Say what could not be verified. -->

- [ ] `npm run typecheck` and `npm test`
- [ ] `npm run test:package` (packaging, CLI entry points or bundled player)
- [ ] `frontend/`: `npm run lint`, `npm run typecheck`, `npm test` (player changes)
- [ ] `frontend/`: `npm run test:browser` (player layout or playback changes)

## Compatibility

- [ ] No change to command output, the public API or the chat archive format
- [ ] Or: the breaking change is described above and marked with `!` in the commit
- [ ] `CHANGELOG.md` has an `Unreleased` entry for user-visible changes
