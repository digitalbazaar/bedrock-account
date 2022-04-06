/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as brAccount from '@bedrock/account';
import * as database from '@bedrock/mongodb';

const {util: {uuid}} = bedrock;

export function createAccount(email) {
  const newAccount = {
    id: 'urn:uuid:' + uuid(),
    email
  };
  return newAccount;
}

export async function prepareDatabase(mockData) {
  await removeCollections();
  await insertTestData(mockData);
}

export async function removeCollections(collectionNames = ['account']) {
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
