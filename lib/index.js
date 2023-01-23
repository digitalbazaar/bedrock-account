/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';
import {klona} from 'klona';
import {logger} from './logger.js';
import {RecordCollection} from './RecordCollection.js';

// load config defaults
import './config.js';

/**
 * @module bedrock-account
 */

let ACCOUNT_STORAGE;

bedrock.events.on('bedrock-mongodb.ready', async () => {
  ACCOUNT_STORAGE = new RecordCollection({
    collectionName: 'account',
    sequenceInData: false,
    uniqueFields: ['email']
  });
  await ACCOUNT_STORAGE.initialize();
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

  const options = {id};
  if(email !== undefined) {
    options.uniqueField = 'email';
    options.uniqueValue = email;
  }
  try {
    // can't use `ACCOUNT_STORAGE.exists`; must check `meta.status` field
    const record = await ACCOUNT_STORAGE.get(options);
    return record.meta.status === status;
  } catch(e) {
    if(e.name === 'NotFoundError') {
      return false;
    }
    throw e;
  }
}

/**
 * Retrieves an account by ID or email.
 *
 * @param {object} options - The options to use.
 * @param {string} [options.id] - The ID of the account to retrieve.
 * @param {string} [options.email] - The email of the account to retrieve.
 * @param {boolean} [options.explain=false] - An optional explain boolean.
 *
 * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
 *   the account record (`{account, meta}`) or an ExplainObject if
 *   `explain=true`.
 */
export async function get({id, email, explain = false} = {}) {
  assert.optionalString(id, 'id');
  assert.optionalString(email, 'email');
  if(!(id || email)) {
    throw new Error('Either "id" or "email" is required.');
  }

  if(explain) {
    if(email !== undefined) {
      const proxyCollection = ACCOUNT_STORAGE.proxyCollections.get('email');
      return proxyCollection.get({uniqueValue: email, explain});
    }
    return ACCOUNT_STORAGE.helper.get({id, explain});
  }

  const options = {id};
  if(email !== undefined) {
    options.uniqueField = 'email';
    options.uniqueValue = email;
  }
  return ACCOUNT_STORAGE.get(options);
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
 * information. In both cases, the expected `sequence` must match the existing
 * account, but if `meta` is being overwritten, `sequence` can be omitted and
 * the value from `meta.sequence` will be used.
 *
 * @param {object} options - The options to use.
 * @param {string} options.id - The ID of the account to update.
 * @param {object} [options.account] - The new account information to use.
 * @param {object} [options.meta] - The new meta information to use.
 * @param {number} [options.sequence] - The sequence number that must match the
 *   current record prior to the update if given; can be omitted if `meta` is
 *   given and has, instead, the new `sequence` number (which must be one more
 *   than the existing `sequence` number).
 *
 * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
 *   `true` if the update succeeds or an ExplainObject if `explain=true`.
 */
export async function update({id, account, meta, sequence} = {}) {
  if(id === undefined) {
    id = account?.id;
  }
  assert.string(id, 'id');
  if(account && account.id !== id) {
    throw new TypeError('"id" must equal "account.id".');
  }
  return ACCOUNT_STORAGE.update(
    {id, data: account, meta, expectedSequence: sequence});
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

  const {meta} = await ACCOUNT_STORAGE.get({id});
  meta.status = status;
  meta.sequence++;
  await ACCOUNT_STORAGE.update({id, meta});
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */
