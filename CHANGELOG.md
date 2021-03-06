# bedrock-account ChangeLog

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
