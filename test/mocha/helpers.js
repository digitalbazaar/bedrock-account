/*
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
/* jshint node: true */

'use strict';

const brAccount = require('bedrock-account');
const database = require('bedrock-mongodb');
const {util: {uuid}} = require('bedrock');

const api = {};
module.exports = api;

api.createAccount = email => {
  const newAccount = {
    id: 'urn:uuid:' + uuid(),
    email
  };
  return newAccount;
};

api.prepareDatabase = async mockData => {
  await api.removeCollections();
  await insertTestData(mockData);
};

api.removeCollections = async (collectionNames = ['account']) => {
  await database.openCollections(collectionNames);
  for(const collectionName of collectionNames) {
    await database.collections[collectionName].deleteMany({});
  }
};

api.removeCollection =
  async collectionName => api.removeCollections([collectionName]);

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
