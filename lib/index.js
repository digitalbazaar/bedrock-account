/*!
 * Copyright (c) 2018-2026 Digital Bazaar, Inc.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';
import {logger} from './logger.js';
import {RecordCollection} from './RecordCollection.js';

// load config defaults
import './config.js';

/**
 * @module bedrock-account
 */

// exported for testing purposes only
// each has a proxy collection named `account-<field>`; note: any future
// additions to this array are insufficient to add a new field as a full
// feature, other API changes below will also be required
export const _UNIQUE_FIELDS = Object.freeze(['email', 'telephone']);

let ACCOUNT_STORAGE;

bedrock.events.on('bedrock-mongodb.ready', async () => {
  ACCOUNT_STORAGE = new RecordCollection({
    collectionName: 'account',
    sequenceInData: false,
    uniqueFields: [..._UNIQUE_FIELDS]
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
  _assertAccount(account);
  if(meta !== undefined) {
    assert.object(meta, 'meta');
  }

  meta = {...meta, status: 'active'};

  // emit `insertEvent` with clone of `account`
  account = structuredClone(account);
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
  _assertAccount(account);
  assert.string(meta.status, 'meta.status');

  logger.info('attempting to insert an account', {account});

  // prepare the account record
  const now = Date.now();
  meta = {...meta, created: now, updated: now, sequence: 0};
  let record = {account, meta};

  // insert the record
  record = await ACCOUNT_STORAGE.insert({record});

  // emit `postInsert` event with updated record data
  eventData.account = structuredClone(record.account);
  eventData.meta = structuredClone(record.meta);
  await bedrock.events.emit('bedrock-account.postInsert', eventData);

  return record;
}

/**
 * Check for the existence of an account. Naming both an email and a telephone
 * number throws; a lookup can only resolve one unique field at a time.
 *
 * @param {object} options - The options to use.
 * @param {string} [options.id] - The ID of the account to check.
 * @param {string} [options.email] - The email address for the account.
 * @param {string} [options.telephone] - The telephone number for the account.
 * @param {string} [options.status=active] - The status to check for
 *   (options: 'active', deleted').
 *
 * @returns {Promise} Resolves to a boolean indicating account existence.
 */
export async function exists({id, email, telephone, status = 'active'} = {}) {
  const params = {id, email, telephone};
  for(const uniqueField of ['id', ..._UNIQUE_FIELDS]) {
    if(params[uniqueField] !== undefined) {
      assert.string(params[uniqueField], uniqueField);
    }
  }
  assert.string(status, 'status');
  if(Object.keys(params).length === 0) {
    throw new Error(
      'Either "id", "email", or "telephone" must be provided.');
  }

  try {
    // can't use `ACCOUNT_STORAGE.exists`; must check `meta.status` field
    const pick = _pickUniqueField({email, telephone});
    const record = await ACCOUNT_STORAGE.get({id, ...pick});
    return record.meta.status === status;
  } catch(e) {
    if(e.name === 'NotFoundError') {
      return false;
    }
    throw e;
  }
}

/**
 * Retrieves an account by ID, email, or telephone number. Naming both an email
 * and a telephone number throws; a lookup only supports using a single unique
 * field at a time.
 *
 * @param {object} options - The options to use.
 * @param {string} [options.id] - The ID of the account to retrieve.
 * @param {string} [options.email] - The email of the account to retrieve.
 * @param {string} [options.telephone] - The telephone number of the account to
 *   retrieve.
 * @param {boolean} [options.explain=false] - An optional explain boolean.
 *
 * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
 *   the account record (`{account, meta}`) or an ExplainObject if
 *   `explain=true`.
 */
export async function get({id, email, telephone, explain = false} = {}) {
  const params = {id, email, telephone};
  for(const uniqueField of ['id', ..._UNIQUE_FIELDS]) {
    if(params[uniqueField] !== undefined) {
      assert.string(params[uniqueField], uniqueField);
    }
  }
  assert.bool(explain, 'explain');
  if(Object.keys(params).length === 0) {
    throw new Error('Either "id", "email", or "telephone" is required.');
  }

  const pick = _pickUniqueField({email, telephone});
  if(explain) {
    if(id !== undefined) {
      return ACCOUNT_STORAGE.helper.get({id, explain});
    }
    const proxyCollection = ACCOUNT_STORAGE.proxyCollections.get(
      pick.uniqueField);
    return proxyCollection.get({...pick, explain});
  }

  return ACCOUNT_STORAGE.get({id, ...pick});
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
  assert.object(query, 'query');
  assert.object(options, 'options');
  assert.bool(_allowPending, '_allowPending');
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
 * @param {object} [options.account] - The new account information to use.
 * @param {string} [options.id=account?.id] - The ID of the account to update.
 * @param {object} [options.meta] - The new meta information to use.
 * @param {number} [options.sequence] - The sequence number that must match the
 *   current record prior to the update if given; can be omitted if `meta` is
 *   given and has, instead, the new `sequence` number (which must be one more
 *   than the existing `sequence` number).
 *
 * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
 *   `true` if the update succeeds or an ExplainObject if `explain=true`.
 */
export async function update({account, id = account?.id, meta, sequence} = {}) {
  assert.string(id, 'id');
  if(account !== undefined) {
    _assertAccount(account);
    if(account.id !== id) {
      throw new TypeError('"id" must equal "account.id".');
    }
  }
  if(meta !== undefined) {
    assert.object(meta, 'meta');
  }
  if(sequence !== undefined) {
    assert.number(sequence, 'sequence');
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

function _assertAccount(account) {
  assert.object(account, 'account');
  assert.string(account.id, 'account.id');
  for(const uniqueField of _UNIQUE_FIELDS) {
    if(account[uniqueField] !== undefined) {
      assert.string(account[uniqueField], `account.${uniqueField}`);
    }
  }
}

function _pickUniqueField(fields) {
  const given = [...Object.entries(fields)]
    .filter(([, uniqueValue]) => uniqueValue !== undefined);
  if(given.length > 1) {
    const quotedKeys = given.map(([k]) => `"${k}"`).join(' or ');
    throw new Error(`Only one of ${quotedKeys} may be given.`);
  }
  if(given.length === 0) {
    return {};
  }
  const [[uniqueField, uniqueValue]] = given;
  return {uniqueField, uniqueValue};
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */
