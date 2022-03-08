/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const brAccount = require('bedrock-account');
const database = require('bedrock-mongodb');
const helpers = require('./helpers');
const jsonpatch = require('fast-json-patch');
const mockData = require('./mock.data');
let accounts;

describe('bedrock-account', () => {
  before(async () => {
    await helpers.prepareDatabase(mockData);
    accounts = mockData.accounts;
  });

  describe('setStatus API', () => {
    it('should mark an account deleted, then active', async () => {
      const {account} = accounts['will-be-deleted@example.com'];
      await brAccount.setStatus({id: account.id, status: 'deleted'});

      // check status is deleted
      let record = await database.collections.account.findOne({
        id: database.hash(account.id)
      });
      should.exist(record.account);
      should.exist(record.meta);
      record.meta.status.should.equal('deleted');

      // reactivate account
      await brAccount.setStatus({id: account.id, status: 'active'});

      // check status is active
      record = await database.collections.account.findOne({
        id: database.hash(account.id)
      });
      should.exist(record.account);
      should.exist(record.meta);
      record.meta.status.should.equal('active');
    });
    it('returns error on a non-existent account', async () => {
      const id = 'urn:uuid:nobody';
      let err;
      try {
        await brAccount.setStatus({id, status: 'deleted'});
      } catch(e) {
        err = e;
      }
      should.exist(err);
      err.name.should.equal('NotFoundError');
      err.details.account.should.equal(id);
    });
  });

  describe('get API', () => {
    it('should return error on non-existent account', async () => {
      let err;
      try {
        await brAccount.get({id: 'urn:uuid:nobody'});
      } catch(e) {
        err = e;
      }
      should.exist(err);
      err.name.should.equal('NotFoundError');
    });
    it('return account when active option is not specified', async () => {
      const {account} = accounts['will-be-deleted@example.com'];

      await brAccount.setStatus({id: account.id, status: 'deleted'});

      const record = await brAccount.get({id: account.id});
      should.exist(record);
      record.should.be.an('object');
      // this ensure only the 2 properties specified in projection
      // are returned not _id
      Object.keys(record).should.deep.equal(['meta', 'account']);
      record.account.should.be.an('object');
      record.meta.should.be.an('object');
      record.meta.status.should.equal('deleted');
      await brAccount.setStatus({id: account.id, status: 'active'});
    });
    it('should get existing account by ID', async () => {
      const {account} = accounts['alpha@example.com'];
      const record = await brAccount.get({id: account.id});
      should.exist(record);
      record.should.be.an('object');
      // this ensure only the 2 properties specified in projection
      // are returned not _id
      Object.keys(record).should.deep.equal(['meta', 'account']);
      record.account.id.should.equal(account.id);
      record.account.email.should.equal(account.email);
      record.meta.status.should.equal('active');
    });
    it('should get existing account by email', async () => {
      const {account} = accounts['alpha@example.com'];
      const record = await brAccount.get({email: account.email});
      should.exist(record);
      record.should.be.an('object');
      // this ensure only the 2 properties specified in projection
      // are returned not _id
      Object.keys(record).should.deep.equal(['meta', 'account']);
      record.account.id.should.equal(account.id);
      record.account.email.should.equal(account.email);
      record.meta.status.should.equal('active');
    });
    it('should get existing account by ID and email', async () => {
      const {account} = accounts['alpha@example.com'];
      const record = await brAccount.get(
        {id: account.id, email: account.email});
      should.exist(record);
      record.should.be.an('object');
      // this ensure only the 2 properties specified in projection
      // are returned not _id
      Object.keys(record).should.deep.equal(['meta', 'account']);
      record.account.id.should.equal(account.id);
      record.account.email.should.equal(account.email);
      record.meta.status.should.equal('active');
    });
    it('should return error on non-matching ID and email', async () => {
      const {account} = accounts['alpha@example.com'];
      let err;
      try {
        await brAccount.get({id: account.id, email: 'nonmatch@test.example'});
      } catch(e) {
        err = e;
      }
      should.exist(err);
      err.name.should.equal('NotFoundError');
    });
  }); // end get API

  describe('insert API', () => {
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
  }); // end insert API

  describe('update API', () => {
    it('should update an account', async () => {
      const email = '388f3331-1015-4b2b-9ed2-f931fe53d074@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({account: newAccount});
      const updatedAccount = newRecord.account;
      const observer = jsonpatch.observe(updatedAccount);
      updatedAccount.email = 'UPDATED.' + email;
      const patch = jsonpatch.generate(observer);
      jsonpatch.unobserve(updatedAccount, observer);
      await brAccount.update({
        id: updatedAccount.id,
        patch,
        sequence: 0
      });
      const updatedRecord = await database.collections.account.findOne(
        {id: database.hash(newAccount.id)});
      should.exist(updatedRecord);
      const {account, meta} = updatedRecord;
      meta.should.be.an('object');
      should.exist(meta.created);
      meta.created.should.be.a('number');
      should.exist(meta.updated);
      meta.updated.should.be.a('number');
      meta.status.should.equal('active');
      account.should.be.an('object');
      account.id.should.equal(newAccount.id);
      account.email.should.equal('UPDATED.' + email);
    });
    it('should throw record sequence does not match.', async () => {
      const email = '6e1e026d-a679-4714-aecd-9f948a3d19e7@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({
        account: newAccount,
        meta: {}
      });
      const updatedAccount = newRecord.account;
      const observer = jsonpatch.observe(updatedAccount);
      updatedAccount.email = 'UPDATED.' + email;
      const patch = jsonpatch.generate(observer);
      jsonpatch.unobserve(updatedAccount, observer);
      try {
        await brAccount.update({
          id: updatedAccount.id,
          patch,
          sequence: 99
        });
      } catch(e) {
        should.exist(e);
        e.name.should.contain('InvalidStateError');
        e.message.should.contain('sequence');
      }
    });
    it('should throw invalid path', async () => {
      const email = 'b4952586-d8f9-11ea-87d0-0242ac130003@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({
        account: newAccount,
        meta: {}
      });
      const updatedAccount = newRecord.account;
      const observer = jsonpatch.observe(updatedAccount);
      updatedAccount.email = 'UPDATED.' + email;
      const updates = jsonpatch.generate(observer);
      jsonpatch.unobserve(updatedAccount, observer);
      const patch = updates.map(p => {
        p.path = '/invalid/path/object';
        return p;
      });
      try {
        await brAccount.update({
          id: updatedAccount.id,
          patch,
          sequence: 0
        });
      } catch(e) {
        should.exist(e);
        e.name.should.contain('ValidationError');
        e.message.should.match(/patch\s+is\s+invalid/);
      }
    });
    it('should not allow id operations', async () => {
      const email = 'd3ae77a6-d8f9-11ea-87d0-0242ac130003@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({
        account: newAccount,
        meta: {}
      });
      const updatedAccount = newRecord.account;
      const observer = jsonpatch.observe(updatedAccount);
      updatedAccount.email = 'UPDATED.' + email;
      const updates = jsonpatch.generate(observer);
      jsonpatch.unobserve(updatedAccount, observer);
      const patch = updates.map(p => {
        p.path = '/id';
        return p;
      });
      let result;
      let error;
      try {
        result = await brAccount.update({
          id: updatedAccount.id,
          patch,
          sequence: 0
        });
      } catch(e) {
        error = e;
      }
      should.not.exist(result);
      should.exist(error);
      error.name.should.contain('ValidationError');
      error.message.should.match(/patch\s+is\s+invalid/i);
      error.details.errors.message.should.contain('"id" cannot be changed');
    });
  });

  describe('exists API', () => {
    it('returns false if account does not exist', async () => {
      const id = 'urn:uuid:e4cbbbfe-c964-4c7f-89cc-375698f0b776';
      const exists = await brAccount.exists({id});
      exists.should.be.false;
    });
    it('returns true if account exists', async () => {
      const email = '9d8a34bb-6b3a-4b1a-b69c-322fbbd9536e@example.com';
      const newAccount = helpers.createAccount(email);
      await brAccount.insert({account: newAccount});
      const exists = await brAccount.exists({id: newAccount.id});
      exists.should.be.true;
    });
    it('returns false for deleted account by default', async () => {
      const email = '8a354515-17cb-453d-b45a-5d3964706f9f@example.com';
      const newAccount = helpers.createAccount(email);
      await brAccount.insert({account: newAccount});
      await brAccount.setStatus({id: newAccount.id, status: 'deleted'});
      const exists = await brAccount.exists({id: newAccount.id});
      exists.should.be.false;
    });
    it('returns true for deleted account with deleted option', async () => {
      const email = '76fbb25e-514d-4566-b270-b08ff8989543@example.com';
      const newAccount = helpers.createAccount(email);
      await brAccount.insert({account: newAccount});
      await brAccount.setStatus({id: newAccount.id, status: 'deleted'});
      const exists = await brAccount.exists(
        {id: newAccount.id, status: 'deleted'});
      exists.should.be.true;
    });
  }); // end exists API
}); // end bedrock-account
