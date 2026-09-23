# Contributing to Wooster

Thanks for helping. This guide covers the repository layout, the development
setup, the checks a change must pass and how releases are published.

## Repository layout

| Path | Contents |
| --- | --- |
| `cli/` | The TypeScript CLI and library published as `twitch-vod-m3u8` |
| `frontend/` | The standalone replay player bundled with `watch` |
| `scripts/` | Packaging smoke test |
| `docs/` | User guides; `docs/internals/` holds design notes and plans |

The persisted chat format lives in `cli/src/protocol.ts` and is shared with the
player through the `@chat-protocol` alias. It must stay dependency-free, and
any change to it is a versioned contract change.

## Before you start

Open an issue before a large change, so the approach can be agreed before the
work is done. Small fixes can go straight to a pull request.

Do not report vulnerabilities in public issues; follow the
[security policy](.github/SECURITY.md) instead.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js --help
```

The package has no runtime dependencies. `npm test` compiles the TypeScript
source and runs the resolver tests with Node's built-in test runner.
`npm run test:package` rebuilds the package, packs it without running lifecycle
scripts, installs the tarball into a temporary directory and checks the CLI, the
bundled player assets and the public API.

The player lives in `frontend/`:

```bash
npm --prefix frontend install
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:browser
```

`npm --prefix frontend run build` writes the standalone player to
`dist/player`, which `npm run build:package` also produces before packing. The
browser regression needs Chromium; install it once with
`npx --prefix frontend playwright install chromium`.

## Pull requests

- Keep each pull request focused on one change, and do not mix mechanical
  rewrites with behavior changes.
- A bug fix needs a regression test that fails before the fix whenever
  reproducing the failure is feasible.
- Preserve existing command output and serialized state unless the change
  explicitly breaks them, and say so in the pull request.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(cli): ...`, `fix(player): ...`, `docs: ...`); mark breaking changes
  with `!`.
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for
  any user-visible change.

## Releasing

Releases are published to npm by the
[release workflow](.github/workflows/release.yml) when a GitHub release is
published. npm authenticates the workflow through trusted publishing, and each
version carries a provenance attestation that links it to the commit it was
built from.

1. Move the `Unreleased` entries in `CHANGELOG.md` under the new version.
2. Bump the version and create the tag:

   ```bash
   npm version prerelease --preid=beta   # or: npm version patch|minor|major
   git push --follow-tags
   ```

3. Create a GitHub release for the new `vX.Y.Z` tag and paste its changelog
   section as the notes. Mark it as a pre-release for beta versions.

The workflow refuses to publish when the tag does not match `package.json`,
and runs the packed-artifact smoke test before publishing.

`publishConfig` publishes to the `beta` tag by default, so
`npx twitch-vod-m3u8@beta` always tracks the newest prerelease. A release that
is not marked as a pre-release is published as `latest` instead. To move
`latest` to a beta by hand, run
`npm dist-tag add twitch-vod-m3u8@<version> latest` with a logged-in npm
account.
