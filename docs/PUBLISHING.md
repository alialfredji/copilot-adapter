# Publishing `@alialf/copilot-adapter` to npm

The package is configured as a public scoped package. The first release is
published manually; later releases use npm trusted publishing from GitHub
Actions with short-lived OIDC credentials and automatic provenance.

## Prerequisites

- Own or have publishing access to the npm scope `@alialf`.
- Enable two-factor authentication for npm publishing.
- Use Node.js 22.12 or newer locally.
- Push from `https://github.com/alialfredji/copilot-adapter`.

This machine was not authenticated with npm when the repository was prepared.
Log in before the first release:

```bash
npm login
npm whoami
```

`npm whoami` must print an account that can publish under `@alialf`.

If npm reports root-owned files in its default cache, avoid publishing with
`sudo`. Use a temporary user-owned cache instead:

```bash
mkdir -p /tmp/copilot-adapter-npm-cache
npm --cache /tmp/copilot-adapter-npm-cache login
npm --cache /tmp/copilot-adapter-npm-cache whoami
```

## 1. Review the release

From a clean `main` branch:

```bash
git status --short
npm ci
npm run check
npm pack --dry-run
```

Confirm the tarball preview contains only the intended runtime files, README,
license, and documentation. Never publish credentials, `.env` files, test
fixtures containing secrets, or personal configuration.

## 2. Publish version 0.1.0 manually

The first publish creates the npm package so its trusted publisher can then be
configured:

```bash
npm --cache /tmp/copilot-adapter-npm-cache publish --access public
```

If the default npm cache works normally, plain `npm login` and `npm publish
--access public` are equivalent.

npm requires either publishing 2FA or a granular token allowed to bypass 2FA.
Enter the one-time password if prompted.

Verify the release:

```bash
npm view @alialf/copilot-adapter name version dist-tags repository
npm install --global @alialf/copilot-adapter
copilot-adapter --version
copilot-adapter doctor
```

Package page: `https://www.npmjs.com/package/@alialf/copilot-adapter`.

## 3. Enable trusted publishing

After the first package exists:

1. Open the package on npmjs.com.
2. Open **Settings** → **Trusted Publisher**.
3. Choose **GitHub Actions**.
4. Organization or user: `alialfredji`.
5. Repository: `copilot-adapter`.
6. Workflow filename: `publish.yml`.
7. Leave Environment blank unless a protected GitHub environment is added.
8. Allow the `npm publish` action.
9. Save the configuration.

The workflow at `.github/workflows/publish.yml` uses GitHub-hosted runners,
Node.js 24, `id-token: write`, and no npm token. Trusted publishing generates
provenance automatically for this public repository and package.

## 4. Publish future versions

Choose the appropriate semantic-version increment:

```bash
npm version patch   # 0.1.0 -> 0.1.1
# npm version minor # 0.1.0 -> 0.2.0
# npm version major # 0.1.0 -> 1.0.0
```

Push the version commit and tag:

```bash
git push origin main --follow-tags
```

Create the matching GitHub release:

```bash
VERSION="$(node -p "require('./package.json').version")"
gh release create "v${VERSION}" --generate-notes --verify-tag
```

Publishing the GitHub release triggers `publish.yml`. Monitor and verify it:

```bash
gh run watch
npm view @alialf/copilot-adapter version
```

## Important release rules

- Never reuse an npm version. Published name/version combinations are permanent.
- Do not create a GitHub release until the package version is correct and its
  tag is pushed.
- Do not add an `NPM_TOKEN` secret after trusted publishing is configured.
- If a release is faulty, publish a fixed patch version. Use `npm deprecate`
  when users must be warned away from an older release.

Official references:

- [Publishing scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [Trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
