/*
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const accountSchema = require('../schemas/bedrock-account')();
const bedrock = require('bedrock');
const database = require('bedrock-mongodb');
const jsonpatch = require('fast-json-patch');
const {validateInstance} = require('bedrock-validation');
const {BedrockError} = bedrock.util;

// load config defaults
require('./config');

/**
 * @module bedrock-account
 */

const logger = bedrock.loggers.get('app').child('bedrock-account');

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await database.openCollections(['account']);

  await database.createIndexes([{
    collection: 'account',
    fields: {id: 1},
    options: {unique: true, background: false}
  }, {
    // cover common queries
    collection: 'account',
    fields: {id: 1, 'meta.status': 1},
    options: {unique: true, background: false}
  }, {
    // `id` is a prefix to allow for sharding on `id` -- a collection
    // cannot be sharded unless its unique indexes have the shard key
    // as a prefix; a separate non-unique index is used for lookups
    collection: 'account',
    fields: {id: 1, 'account.email': 1, 'meta.status': 1},
    options: {
      partialFilterExpression: {'account.email': {$exists: true}},
      unique: true,
      background: false
    }
  }, {
    collection: 'account',
    fields: {'account.email': 1, 'meta.status': 1},
    options: {
      partialFilterExpression: {'account.email': {$exists: true}},
      unique: true,
      background: false
    }
  }, {
    collection: 'account',
    fields: {'account.email': 1},
    options: {
      partialFilterExpression: {'account.email': {$exists: true}},
      unique: true,
      background: false
    }
  }]);
});

/**
 * Inserts a new account. The account must contain `id`.
 *
 * @param {object} options - The options to use.
 * @param {object} options.account - The account containing at least the
 *   minimum required data.
 * @param {object} [options.meta] - The meta information to include.
 *
 * @returns {Promise} Resolves to the database account record.
 */
exports.insert = async ({account, meta} = {}) => {
  assert.object(account, 'account');
  assert.string(account.id, 'account.id');
  assert.optionalString(account.email, 'account.email');
  assert.optionalString(account.phoneNumber, 'account.phoneNumber');

  meta = {...meta, status: 'active'};

  // emit `insertEvent` with clone of `account`
  account = bedrock.util.clone(account);
  const eventData = {
    account,
    meta,
    // data to pass to `postInsert`, but do not insert into database
    postInsert: {
      /* <module-name>: <module-specific data> */
    }
  };
  await bedrock.events.emit('bedrock-account.insert', eventData);

  // replay assertions post event emission
  assert.object(account, 'account');
  assert.string(account.id, 'account.id');
  assert.string(meta.status, 'meta.status');
  assert.optionalString(account.email, 'account.email');
  assert.optionalString(account.phoneNumber, 'account.phoneNumber');

  logger.info('attempting to insert an account', {account});

  // insert the account and get the updated record
  const now = Date.now();
  meta.created = now;
  meta.updated = now;
  meta.sequence = 0;
  let record = {
    id: database.hash(account.id),
    meta,
    account
  };
  try {
    const result = await database.collections.account.insertOne(
      record, database.writeOptions);
    record = result.ops[0];
  } catch(e) {
    if(!database.isDuplicateError(e)) {
      throw e;
    }
    throw new BedrockError(
      'Duplicate account.',
      'DuplicateError', {
        public: true,
        httpStatusCode: 409
      }, e);
  }

  // emit `postInsert` event with updated record data
  eventData.account = bedrock.util.clone(record.account);
  eventData.meta = bedrock.util.clone(record.meta);
  await bedrock.events.emit('bedrock-account.postInsert', eventData);

  return record;
};

/**
 * Check for the existence of an account.
 *
 * @param {object} options - The options to use.
 * @param {string} [options.id] - The ID of the account to check.
 * @param {string} [options.email] - The email address for the account.
 * @param {string} [options.status=active] - The status to check for
 *   (options: 'active', deleted').
 *
 * @returns {Promise} Resolves to a boolean indicating account existence.
 */
exports.exists = async ({id, email, status = 'active'} = {}) => {
  assert.optionalString(id, 'id');
  assert.optionalString(email, 'email');
  assert.string(status, 'status');
  if(!(id || email)) {
    throw new Error('Either "id" or "email" must be provided.');
  }

  const query = {'meta.status': status};
  const projection = {_id: 0};
  if(id) {
    query.id = database.hash(id);
    projection.id = 1;
  }
  if(email) {
    query['account.email'] = email;
    projection['account.email'] = 1;
  }
  return !!await database.collections.account.findOne(query, {projection});
};

/**
 * Retrieves an account by ID or email.
 *
 * @param {object} options - The options to use.
 * @param {string} [options.id] - The ID of the account to retrieve.
 * @param {string} [options.email] - The email of the account to retrieve.
 *
 * @returns {Promise} Resolves to `{account, meta}`.
 */
exports.get = async ({id, email} = {}) => {
  assert.optionalString(id, 'id');
  assert.optionalString(email, 'email');
  if(!(id || email)) {
    throw new Error('Either "id" or "email" is required.');
  }

  const query = {};
  if(id) {
    query.id = database.hash(id);
  }
  if(email) {
    query['account.email'] = email;
  }

  const record = await database.collections.account.findOne(
    query, {projection: {_id: 0, account: 1, meta: 1}});
  if(!record) {
    throw new BedrockError(
      'Account not found.',
      'NotFoundError',
      {id, httpStatusCode: 404, public: true});
  }

  return record;
};

/**
 * Retrieves all accounts matching the given query.
 *
 * @param {object} options - The options to use.
 * @param {object} [options.query={}] - The query to use.
 * @param {object} [options.options={}] - The options (eg: 'sort', 'limit').
 *
 * @returns {Promise} Resolves to the records that matched the query.
 */
exports.getAll = async ({query = {}, options = {}} = {}) => {
  return database.collections.account.find(query, options).toArray();
};

/**
 * Updates an account.
 *
 * @param {object} options - The options to use.
 * @param {string} options.id - The ID of the account to update.
 * @param {Array} options.patch - A JSON patch for performing the update.
 * @param {number} options.sequence - The sequence number that must match the
 *   current record prior to the patch.
 *
 * @returns {Promise} Resolves once the operation completes.
 */
exports.update = async ({id, patch, sequence} = {}) => {
  assert.string(id, 'id');
  assert.array(patch, 'patch');
  assert.number(sequence, 'sequence');

  if(sequence < 0) {
    throw new TypeError('"sequence" must be a non-negative integer.');
  }

  const record = await exports.get({id});

  if(record.meta.sequence !== sequence) {
    throw new BedrockError(
      'Could not update account. Record sequence does not match.',
      'InvalidStateError', {
        httpStatusCode: 409,
        public: true,
        actual: sequence,
        expected: record.meta.sequence
      });
  }
  const customValidate = (operation, index, tree, existingPath) => {
    jsonpatch.validator(operation, index, tree, existingPath);
    const pathId = /^\/id$/i.test(existingPath);
    if(pathId) {
      throw new jsonpatch.JsonPatchError(
        '"id" cannot be changed',
        'OPERATION_OP_INVALID',
        index, operation, tree);
    }
  };
  const errors = jsonpatch.validate(patch, record.account, customValidate);
  if(errors) {
    throw new BedrockError(
      'The given JSON patch is invalid.',
      'ValidationError', {
        httpStatusCode: 400,
        public: true,
        patch,
        errors
      });
  }

  // apply patch and validate result
  const patched = jsonpatch.applyPatch(record.account, patch).newDocument;
  const validationResult = validateInstance(patched, accountSchema);
  if(!validationResult.valid) {
    throw validationResult.error;
  }

  const result = await database.collections.account.updateOne({
    id: database.hash(id),
    'meta.sequence': sequence
  }, {
    $set: {account: patched},
    $inc: {'meta.sequence': 1}
  }, database.writeOptions);

  if(result.result.n === 0) {
    return new BedrockError(
      'Could not update account. Record sequence does not match.',
      'InvalidStateError', {httpStatusCode: 409, public: true});
  }
};

/**
 * Sets an account's status.
 *
 * @param {object} options - The options to use.
 * @param {string} options.id - The account ID.
 * @param {string} options.status - The status.
 *
 * @returns {Promise} Resolves once the operation completes.
 */
exports.setStatus = async ({id, status} = {}) => {
  assert.string(id, 'id');
  assert.string(status, 'status');

  const result = await database.collections.account.updateOne(
    {id: database.hash(id)}, {
      $set: {'meta.status': status},
      $inc: {'meta.sequence': 1}
    }, database.writeOptions);

  if(result.result.n === 0) {
    throw new BedrockError(
      'Could not set account status. Account not found.',
      'NotFoundError',
      {httpStatusCode: 404, account: id, public: true});
  }
};
