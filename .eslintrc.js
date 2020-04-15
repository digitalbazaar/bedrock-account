module.exports = {
  root: true,
  env: {
    node: true
  },
  extends: [
    'eslint-config-digitalbazaar',
    'eslint-config-digitalbazaar/jsdoc'
  ],
  ignorePatterns: ['node_modules/']
};
