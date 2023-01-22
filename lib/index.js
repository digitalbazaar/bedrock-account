/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import * as emails from './emails.js';
import {schema as accountSchema} from '../schemas/bedrock-account.js';
import assert from 'assert-plus';
import jsonpatch from 'fast-json-patch';
import {klona} from 'klona';
import {logger} from './logger.js';
import {RecordCollection} from './RecordCollection.js';
import {validateInstance} from '@bedrock/validation';

const {util: {BedrockError}} = bedrock;

// load config defaults
import './config.js';

/**
 * @module bedrock-account
 */

let ACCOUNT_STORAGE;

bedrock.events.on('bedrock-mongodb.ready', async () => {
  ACCOUNT_STORAGE = new RecordCollection({
    collectionName: 'account',
    // FIXME: revisit this decision
    sequenceInData: false,
    uniqueFields: ['email']
  });
  await ACCOUNT_STORAGE.initialize();

  // FIXME: determine if these indexes are necessary
  // add custom indexes to cover common queries; each index must include
  // the shard key of `id`
  // await database.createIndexes([{
  //   collection: 'account',
  //   fields: {'account.id': 1, 'meta.status': 1},
  //   options: {unique: false}
  // }, {
  //   collection: 'account',
  //   fields: {'account.id': 1, 'account.email': 1, 'meta.status': 1},
  //   options: {
  //     partialFilterExpression: {'account.email': {$exists: true}},
  //     unique: false
  //   }
  // }, {
  //   collection: 'account',
  //   fields: {'account.email': 1, 'meta.status': 1},
  //   options: {
  //     partialFilterExpression: {'account.email': {$exists: true}},
  //     unique: false,
  //     background: false
  //   }
  // }]);
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
export async function insert({account, meta} = {}) {
  assert.object(account, 'account');
  assert.string(account.id, 'account.id');
  assert.optionalString(account.email, 'account.email');
  assert.optionalString(account.phoneNumber, 'account.phoneNumber');

  meta = {...meta, status: 'active'};

  // emit `insertEvent` with clone of `account`
  account = klona(account);
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

  // prepare the account record
  const now = Date.now();
  meta = {...meta, created: now, updated: now, sequence: 0};
  let record = {account, meta};

  // insert the record
  record = await ACCOUNT_STORAGE.insert({record});

  // emit `postInsert` event with updated record data
  eventData.account = klona(record.account);
  eventData.meta = klona(record.meta);
  await bedrock.events.emit('bedrock-account.postInsert', eventData);

  return record;
}

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
export async function exists({id, email, status = 'active'} = {}) {
  assert.optionalString(id, 'id');
  assert.optionalString(email, 'email');
  assert.string(status, 'status');
  if(!(id || email)) {
    throw new Error('Either "id" or "email" must be provided.');
  }

  // FIXME: change to use ACCOUNT_STORAGE
  const query = {
    'meta.status': status,
    'meta.state': {$ne: 'pending'}
  };
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
}

/**
 * Retrieves an account by ID or email.
 *
 * @param {object} options - The options to use.
 * @param {string} [options.id] - The ID of the account to retrieve.
 * @param {string} [options.email] - The email of the account to retrieve.
 * @param {boolean} [options._allowPending=false] - For internal use only;
 *   allows finding records that are in the process of being created.
 * @param {boolean} [options.explain=false] - An optional explain boolean.
 *
 * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
 *   the account record (`{account, meta}`) or an ExplainObject if
 *   `explain=true`.
 */
export async function get({
  id, email, _allowPending = false, explain = false
} = {}) {
  assert.optionalString(id, 'id');
  assert.optionalString(email, 'email');
  if(!(id || email)) {
    throw new Error('Either "id" or "email" is required.');
  }

  // FIXME: change to use ACCOUNT_STORAGE
  const query = {};
  if(id) {
    query.id = database.hash(id);
  }
  if(email) {
    query['account.email'] = email;
  }
  if(!_allowPending) {
    query['meta.state'] = {$ne: 'pending'};
  }

  const projection = {_id: 0, account: 1, meta: 1};
  const collection = database.collections.account;

  if(explain) {
    // 'find().limit(1)' is used here because 'findOne()' doesn't return a
    // cursor which allows the use of the explain function.
    const cursor = await collection.find(query, {projection}).limit(1);
    return cursor.explain('executionStats');
  }

  const record = await collection.findOne(query, {projection});
  if(!record) {
    throw new BedrockError(
      'Account not found.',
      'NotFoundError',
      {id, httpStatusCode: 404, public: true});
  }

  return record;
}

/**
 * Retrieves all accounts matching the given query.
 *
 * @param {object} options - The options to use.
 * @param {object} [options.query={}] - The query to use.
 * @param {object} [options.options={}] - The options (eg: 'sort', 'limit').
 * @param {boolean} [options._allowPending=false] - For internal use only;
 *   allows finding records that are in the process of being created.
 *
 * @returns {Promise} Resolves to the records that matched the query.
 */
export async function getAll({
  query = {}, options = {}, _allowPending = false
} = {}) {
  if(!_allowPending) {
    query = {...query, 'meta.state': {$ne: 'pending'}};
  }
  return database.collections.account.find(query, options).toArray();
}

/**
 * Updates an account by overwriting it with new `account` and / or `meta`
 * information or by providing a `patch`. In all cases, the expected
 * `sequence` must match the existing account, but if `meta` is being
 * overwritten, `sequence` can be omitted and will be auto-computed from
 * `meta.sequence`.
 *
 * @param {object} options - The options to use.
 * @param {string} options.id - The ID of the account to update.
 * @param {object} [options.account] - The new account information to use.
 * @param {object} [options.meta] - The new meta information to use.
 * @param {number} [options.sequence] - The sequence number that must match the
 *   current record prior to the update if given; can be omitted if no `patch`
 *   is given and `meta` is given.
 * @param {Array} [options.patch] - A JSON patch for performing the update.
 * @param {boolean} [options.explain=false] - An optional explain boolean that
 *   may only be used if `patch` is not provided.
 *
 * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
 *   `true` if the update succeeds or an ExplainObject if `explain=true`.
 */
export async function update({
  id, account, meta, sequence, explain, patch
} = {}) {
  if(patch) {
    if(explain) {
      throw new TypeError('"explain" not supported when using "patch".');
    }
    // FIXME: remove json-patch update API
    return _patchUpdate({id, patch, sequence});
  }
  // FIXME: change to use ACCOUNT_STORAGE
  return _update({id, account, meta, sequence, explain});
}

/**
 * Sets an account's status.
 *
 * @param {object} options - The options to use.
 * @param {string} options.id - The account ID.
 * @param {string} options.status - The status.
 *
 * @returns {Promise} Resolves once the operation completes.
 */
export async function setStatus({id, status} = {}) {
  assert.string(id, 'id');
  assert.string(status, 'status');

  // FIXME: change to use ACCOUNT_STORAGE
  const result = await database.collections.account.updateOne({
    id: database.hash(id),
    'meta.state': {$ne: 'pending'}
  }, {
    $set: {'meta.status': status},
    $inc: {'meta.sequence': 1}
  });

  if(result.result.n === 0) {
    throw new BedrockError('Could not set account status. Account not found.', {
      name: 'NotFoundError',
      details: {httpStatusCode: 404, account: id, public: true}
    });
  }
}

export async function _update({id, account, meta, sequence, explain} = {}) {
  // validate params
  if(!(account || meta)) {
    throw new TypeError('Either "account" or "meta" is required.');
  }
  assert.optionalObject(account, 'account');
  assert.optionalObject(meta, 'meta');
  if(id === undefined) {
    id = account?.id;
  }
  assert.string(id, 'id');
  if(account && account.id !== id) {
    throw new TypeError('"id" must equal "account.id".');
  }
  if(sequence === undefined) {
    // use sequence from `meta`
    sequence = meta?.sequence - 1;
  }
  assert.number(sequence, 'sequence');
  if(meta && meta.sequence !== (sequence + 1)) {
    throw new TypeError('"sequence" must equal "meta.sequence - 1".');
  }
  if(sequence < 0) {
    throw new TypeError('"sequence" must be a non-negative integer.');
  }

  // FIXME: use `RecordCollection` with a `ProxyCollection` for the `email`
  // unique field instead

  // build update
  const now = Date.now();
  const update = {$set: {}};
  if(account) {
    update.$set.account = account;
  }
  if(meta) {
    update.$set.meta = {...meta, updated: now};
  } else {
    update.$set['meta.updated'] = now;
    update.$set['meta.sequence'] = sequence + 1;
  }

  const collection = database.collections.account;
  const query = {
    id: database.hash(id),
    'meta.state': {$ne: 'pending'},
    'meta.sequence': sequence
  };

  if(explain) {
    // 'find().limit(1)' is used here because 'updateOne()' doesn't return a
    // cursor which allows the use of the explain function.
    const cursor = await collection.find(query).limit(1);
    return cursor.explain('executionStats');
  }

  const result = await collection.updateOne(query, update);
  if(result.result.n > 0) {
    // record updated
    return true;
  }

  // determine if sequence did not match; will throw if account does not exist
  const record = await get({id});
  if(record.meta.sequence !== sequence) {
    // do not pass `actual: record.meta.sequence` because it could have changed
    // concurrently and now match -- creating confusion
    _throwInvalidSequence({expected: sequence});
  }

  return false;
}

// FIXME: remove
async function _patchUpdate({id, patch, sequence} = {}) {
  assert.string(id, 'id');
  assert.array(patch, 'patch');
  assert.number(sequence, 'sequence');
  if(sequence < 0) {
    throw new TypeError('"sequence" must be a non-negative integer.');
  }

  const record = await get({id});
  if(record.meta.sequence !== sequence) {
    _throwInvalidSequence({actual: record.meta.sequence, expected: sequence});
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
    const pathEmail = /^\/id$/i.test(existingPath);
    if(pathEmail) {
      throw new jsonpatch.JsonPatchError(
        '"email" cannot be changed',
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
  const validationResult = validateInstance(
    {instance: patched, schema: accountSchema});
  if(!validationResult.valid) {
    throw validationResult.error;
  }

  const result = await database.collections.account.updateOne({
    // FIXME: remove this -- or just remove `patch` entirely
    id: database.hash(id),
    // FIXME: remove `pending`
    'meta.state': {$ne: 'pending'},
    'meta.sequence': sequence
    // FIXME: require `_txn` to be unset
  }, {
    $set: {account: patched},
    $inc: {'meta.sequence': 1}
  });

  if(result.result.n === 0) {
    _throwInvalidSequence({expected: sequence});
  }
}

// FIXME: remove, replace with `RecordCollection` implementation
async function _ensureUnique({record} = {}) {
  /* Note: Now we must handle records with `email` set. Since `email` cannot be
  uniquely indexed in the account collection (as it would prevent sharding), we
  must insert any record that contains an email in an unusable state and then
  switch its state to usable only once we have confirmed that it is unique in
  the separate `email` collection. */
  const {account} = record;
  const {id: accountId, email} = account;
  const collection = database.collections.account;
  while(true) {
    // try to insert an email mapping; this will trigger a duplicate
    // error if the mapping exists for a different account ID
    try {
      await emails.insert({email, accountId});
    } catch(e) {
      if(e.name === 'DuplicateError') {
        // if the mapping is a duplicate, ensure that an account record exists
        // that matches it; first get existing mapping record
        let mappingRecord;
        try {
          mappingRecord = await emails.get({email});
        } catch(e) {
          if(e.name !== 'NotFoundError') {
            throw e;
          }
          // mapping record now not found, loop to try again
          continue;
        }

        try {
          // find the account record, allow it to be pending
          const {account: {id: existingAccountId}, meta} = await get(
            {id: mappingRecord.accountId, _allowPending: true});
          // if existing account record found in pending status, remove it...
          // a race is on to determine which account record wins
          if(meta.state === 'pending') {
            if(await collection.deleteOne({
              id: database.hash(existingAccountId),
              'meta.state': 'pending'
            })) {
              // old pending account record removed; remove existing mapping
              await emails.remove(mappingRecord);
            }
            // loop to try again since old account record was pending
            continue;
          }
        } catch(e) {
          if(e.name !== 'NotFoundError') {
            throw e;
          }
          // existing account record not found, so remove email mapping record
          // and try again
          await emails.remove(mappingRecord);
          continue;
        }
      }

      // remove the pending record and re-throw the duplicate error
      await collection.deleteOne({id: database.hash(accountId)});
      throw e;
    }

    // no duplicate error, so removing pending state from account record,
    // noting that another process could remove the pending state first, which
    // is not an error
    delete record.meta.state;
    if(!await collection.updateOne(
      {id: database.hash(accountId), 'meta.state': 'pending'},
      {$unset: {'meta.state': ''}})) {
      // if the record wasn't updated, then it was removed by another process
      // that claimed the email + account ID, loop and try again
      continue;
    }
    // successfully claimed email + account ID
    return record;
  }
}

function _throwInvalidSequence({actual, expected} = {}) {
  const details = {httpStatusCode: 409, public: true};
  if(actual !== undefined) {
    details.actual = actual;
  }
  if(expected !== undefined) {
    details.expected = expected;
  }
  throw new BedrockError(
    'Could not update account. Record sequence does not match.', {
      name: 'InvalidStateError',
      details
    });
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */
