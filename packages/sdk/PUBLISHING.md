# Publishing @azrtydxb/kryton-sdk

The SDK is published to public npm on every kryton release tag.

## Automated (CI release)

`scripts/release.js` creates the release commit and tag, then invokes
`publishSdk()` — the git tag is pushed manually afterwards
(`git push origin master --tags`), not before publishing. In CI,
the `publish-sdk` job in `.github/workflows/release.yml` runs after the
`release` job and calls `node scripts/release-sdk.js` directly. The job
injects `NPM_TOKEN` from the repo secrets via the `NODE_AUTH_TOKEN` env var
that `actions/setup-node` reads automatically.

## Manual (local release)

```bash
npm login                                        # one time
npm run build --workspace=packages/sdk
npm publish --access public --workspace=packages/sdk
```

## React Native compatibility

The SDK is consumed by `kryton-mobile`. Before any change to `packages/sdk`, run:

```bash
npm test --workspace=packages/sdk
```

The `rn-compat.test.ts` suite verifies the client constructs without DOM globals. Do not add Node-only or DOM-only dependencies.
