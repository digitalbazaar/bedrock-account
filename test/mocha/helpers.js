/*!
 * Copyright (c) 2018-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as brAccount from '@bedrock/account';
import * as database from '@bedrock/mongodb';
import {randomUUID} from 'node:crypto';

export function createAccount(email) {
  const newAccount = {
    id: `urn:uuid:${randomUUID()}`,
    email
  };
  return newAccount;
}

export async function createFakeTransaction({
  accountId, type, committed, _pending, ops = [], skipAccountRecord = false
} = {}) {
  const txn = {id: randomUUID(), type, recordId: accountId};
  if(committed) {
    txn.committed = true;
  }

  if(!skipAccountRecord) {
    const query = {'account.id': accountId};
    const update = {$set: {_txn: txn}};
    if(_pending !== undefined) {
      update.$set._pending = _pending;
    }
    const result = await database.collections.account.updateOne(
      query, update, {upsert: true});
    (result.modifiedCount + result.upsertedCount).should.equal(1);
  }

  for(const op of ops) {
    const _txn = {...txn, op: op.type};
    if(op.type === 'insert') {
      const query = {email: op.email};
      const update = {$set: {accountId, email: op.email, _txn}};
      await database.collections['account-email'].updateOne(
        query, update, {upsert: true});
    } else {
      const query = {email: op.email};
      const update = {$set: {_txn}};
      const result = await database.collections['account-email'].updateOne(
        query, update, {upsert: true});
      (result.modifiedCount + result.upsertedCount).should.equal(1);
    }
  }
}

export async function prepareDatabase(mockData) {
  await removeCollections();
  await insertTestData(mockData);
}

export async function removeCollections(collectionNames = [
  'account', 'account-email'
]) {
  await database.openCollections(collectionNames);
  for(const collectionName of collectionNames) {
    await database.collections[collectionName].deleteMany({});
  }
}

export async function removeCollection(collectionName) {
  return removeCollections([collectionName]);
}

async function insertTestData(mockData) {
  const records = Object.values(mockData.accounts);
  for(const record of records) {
    try {
      await brAccount.insert({
        account: record.account, meta: record.meta || {}
      });
    } catch(e) {
      if(e.name === 'DuplicateError') {
        // duplicate error means test data is already loaded
        continue;
      }
      throw e;
    }
  }
}
