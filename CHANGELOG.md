# bedrock-account ChangeLog

## 9.1.1 - 2025-mm-dd

### Fixed
- Return passed `record` instead of resulting record from mongodb calls to
  enable using newer mongodb driver.
- Use `result.modifiedCount`, etc. to enable newer mongodb driver.
- Remove unused `background` option from mongodb index creation.

## 9.1.0 - 2024-10-15

### Changed
- Update dependencies.

## 9.0.0 - 2023-01-24

### Changed
- **BREAKING**: The database record and layout for this module has changed in
  ways that incompatible with any previous releases. Now the uniqueness
  constraint for account email addresses is enforced via a proxy collection
  and an internal transaction system. This enables the account collection (and
  the proxy collection) to be sharded.

### Removed
- **BREAKING**: The `patch` feature in the update API has been removed. Only
  overwrite w/sequence matching is permitted.

## 8.2.0 - 2022-12-11

### Added
- Add overwrite feature to `update`. Instead of using a
  JSON `patch`, the `account` and / or `meta` fields in
  an account record can be overwritten, provided that the
  sequence matches.

## 8.1.0 - 2022-12-11

### Added
- Add optional `explain` flag to `get()`.

## 8.0.0 - 2022-04-29

### Changed
- **BREAKING**: Update peer deps:
  - `@bedrock/core@6`
  - `@bedrock/mongodb@10`
  - `@bedrock/validation@7`.

## 7.0.0 - 2022-04-06

### Changed
- **BREAKING**: Rename package to `@bedrock/account`.
- **BREAKING**: Convert to module (ESM).
- **BREAKING**: Remove default export.
- **BREAKING**: Require node 14.x.

## 6.3.2 - 2022-03-24

### Fixed
- Fix `bedrock-mongodb` import.

## 6.3.1 - 2022-03-23

### Fixed
- Fix erroneous use of `exports`.

## 6.3.0 - 2022-03-23

### Changed
- Update peer deps:
  - `bedrock@4.5`.

## 6.2.0 - 2022-03-20

### Changed
- Update internals to use esm style and use `esm.js` to
  transpile to CommonJS.

## 6.1.0 - 2022-03-07

### Added
- Add option to pass `email` to `get()`.

## 6.0.0 - 2022-03-07

### Changed
- **BREAKING**: Remove deprecated `fields` option from `getAll`. Use
  `options.projection` instead.
- **BREAKING**: Update peer deps:
  - `bedrock@4.4`
  - `bedrock-validation@5.5`
  - `bedrock-mongodb@8.4`

### Removed
- **BREAKING**: Remove all usage of `bedrock-permission` including
  roles (e.g., `sysResourceRole`), `actor`, etc. All authz should
  be managed via HTTP (or other) APIs and technologies such as
  zcaps, meters, and oauth2.

## 5.0.0 - 2021-01-11

### Changed
- **BREAKING**: An email can have only one account linked to it.

## 4.2.0 - 2020-10-20

### Changed
- Update peer and test deps.
- Regenerate readme.

## 4.1.0 - 2020-07-07

### Changed
- Update peer deps, test deps and CI workflow.

### Fixed
- Fix usage of the MongoDB projection API.

## 4.0.0 - 2020-06-24

### Changed
- **BREAKING**: Remove dependency on bedrock-identity.
- **BREAKING**: Remove legacy callback APIs.

## 3.0.1 - 2020-06-18

### Fixed
- Fix validation of account data in the `update` API.

## 3.0.0 - 2020-06-09

### Changed
- **BREAKING**: Update `bedrock-mongodb` to ^7.0.0.
- Change mongo API calls to mongo driver 3.5.
- Parameter field to method find defaults to undefined.

### Added
- Find can take options.projections instead of fields.
- Find will throw if both options.projectsion & fields are defined.

## 2.2.0 - 2020-04-15

### Changed
- Setup CI and coverage workflow.

## 2.1.3 - 2019-11-13

### Changed
- Update dependencies.

## 2.1.2 - 2019-06-05

### Fixed
- Only disallow patching `id` on account, not other paths.

## 2.1.1 - 2019-02-11

### Changed
- Fixed error handling related to an invalid sequence on updates.
  See [issue #7](https://github.com/digitalbazaar/bedrock-account/issues/7).
- Added eslint-config-digitalbazaar to project with `.eslintrc.js` file.

## 2.1.0 - 2018-11-28

### Changed
- Use bedrock-validation@4.

## 2.0.0 - 2018-09-17

### Changed
- Use bedrock-validation 3.x.

## 1.0.0 - 2018-06-18

## 0.1.0 - 2018-05-08

### Added
- Added core files.

- See git history for changes.
