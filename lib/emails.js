/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';

const {util: {BedrockError}} = bedrock;

const COLLECTION_NAME = 'account-email';

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await database.openCollections([COLLECTION_NAME]);

  await database.createIndexes([{
    // ensure email + account IDs are unique
    collection: COLLECTION_NAME,
    fields: {email: 1},
    options: {
      unique: true,
      background: false
    }
  }]);
});

/**
 * Inserts a unique email + account ID mapping.
 *
 * @param {object} options - The options to use.
 * @param {string} options.email - The email.
 * @param {string} options.accountId - The account ID.
 *
 * @returns {Promise<object>} Resolves to the database record.
 */
export async function insert({email, accountId} = {}) {
  assert.string(email, 'email');
  assert.string(accountId, 'accountId');

  // insert the mapping
  const record = {email, accountId};

  try {
    const collection = database.collections[COLLECTION_NAME];
    const result = await collection.insertOne(record);
    return result.ops[0];
  } catch(e) {
    if(!database.isDuplicateError(e)) {
      throw e;
    }
    // intentionally surface as a duplicate account error
    // (not just a duplicate mapping error)
    throw new BedrockError('Duplicate account.', {
      name: 'DuplicateError',
      details: {accountId, email, public: true, httpStatusCode: 409},
      cause: e
    });
  }
}

/**
 * Gets an email + account ID mapping.
 *
 * @param {object} options - The options to use.
 * @param {string} options.email - The email.
 * @param {boolean} [options.explain=false] - An optional explain boolean.
 *
 * @returns {Promise<object | ExplainObject>} Resolves with the record that
 *   matches the query or an ExplainObject if `explain=true`.
 */
export async function get({email, explain = false} = {}) {
  assert.string(email, 'email');

  const collection = database.collections[COLLECTION_NAME];
  const query = {email};
  const projection = {_id: 0, email: 1, accountId: 1};

  if(explain) {
    // 'find().limit(1)' is used here because 'findOne()' doesn't return a
    // cursor which allows the use of the explain function
    const cursor = await collection.find(query, {projection}).limit(1);
    return cursor.explain('executionStats');
  }

  const record = await collection.findOne(query, {projection});
  if(!record) {
    throw new BedrockError('Email not found.', {
      name: 'NotFoundError',
      details: {email, httpStatusCode: 404, public: true}
    });
  }

  return record;
}

/**
 * Removes an existing mapping.
 *
 * @param {object} options - The options to use.
 * @param {string} options.email - The email.
 * @param {string} options.accountId - The account ID to remove.
 * @param {boolean} [options.explain=false] - An optional explain boolean.
 *
 * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on remove
 *   success or an ExplainObject if `explain=true`.
 */
export async function remove({email, accountId, explain = false} = {}) {
  assert.string(email, 'email');
  assert.string(accountId, 'accountId');

  const collection = database.collections[COLLECTION_NAME];
  const query = {email, accountId};

  if(explain) {
    // 'find().limit(1)' is used here because 'deleteOne()' doesn't return a
    // cursor which allows the use of the explain function
    const cursor = await collection.find(query).limit(1);
    return cursor.explain('executionStats');
  }

  const result = await collection.deleteOne(query);
  return result.result.n > 0;
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */
