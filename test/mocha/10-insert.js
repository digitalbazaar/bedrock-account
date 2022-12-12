/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as brAccount from '@bedrock/account';
import * as database from '@bedrock/mongodb';
import * as helpers from './helpers.js';
import {mockData} from './mock.data.js';

describe('insert', () => {
  before(async () => {
    await helpers.prepareDatabase(mockData);
  });

  it('should insert an account', async () => {
    const email = 'de3c2700-0c5d-4b75-bd6b-02dee985e39d@example.com';
    const newAccount = helpers.createAccount(email);
    await brAccount.insert({account: newAccount});
    const record = await database.collections.account.findOne(
      {id: database.hash(newAccount.id)});
    should.exist(record);
    const {account, meta} = record;
    meta.should.be.an('object');
    should.exist(meta.created);
    meta.created.should.be.a('number');
    should.exist(meta.updated);
    meta.updated.should.be.a('number');
    meta.status.should.equal('active');
    account.should.be.an('object');
    account.id.should.equal(newAccount.id);
    account.email.should.equal(email);
  });
  it('should return error on duplicate account', async () => {
    const email = '99748241-3599-41a0-8445-d092de558b9f@example.com';
    const newAccount = helpers.createAccount(email);
    await brAccount.insert({account: newAccount});
    // attempt to insert the same account again
    let err;
    try {
      await brAccount.insert({account: newAccount});
    } catch(e) {
      err = e;
    }
    should.exist(err);
    err.name.should.equal('DuplicateError');
  });
  it('should return error on duplicate email', async () => {
    const email = '4c38d01c-d8fb-11ea-87d0-0242ac130003@example.com';
    const newAccount = helpers.createAccount(email);
    await brAccount.insert({account: newAccount});
    // attempt to make another account with the same email
    const newAccount2 = helpers.createAccount(email);
    let err;
    try {
      await brAccount.insert({account: newAccount2});
    } catch(e) {
      err = e;
    }
    should.exist(err);
    err.name.should.equal('DuplicateError');
  });
});
