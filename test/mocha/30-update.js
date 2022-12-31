/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as brAccount from '@bedrock/account';
import * as database from '@bedrock/mongodb';
import * as helpers from './helpers.js';
import jsonpatch from 'fast-json-patch';
import {mockData} from './mock.data.js';

describe('update', () => {
  before(async () => {
    await helpers.prepareDatabase(mockData);
  });

  describe('patch', () => {
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
    it('should throw record sequence does not match', async () => {
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
  describe('overwrite', () => {
    it('should update an account', async () => {
      const email = '3b763b42-890b-4189-9075-b2d81b193d92@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({account: newAccount});
      const updatedAccount = {...newRecord.account};
      updatedAccount.email = 'UPDATED.' + email;
      await brAccount.update({
        id: newAccount.id,
        account: updatedAccount,
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
    it('should throw record sequence does not match', async () => {
      const email = 'dfad8d2f-3320-4609-916a-db7c68dc9b8c@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({
        account: newAccount,
        meta: {}
      });
      const updatedAccount = {...newRecord.account};
      updatedAccount.email = 'UPDATED.' + email;
      try {
        await brAccount.update({
          id: updatedAccount.id,
          account: updatedAccount,
          sequence: 99
        });
      } catch(e) {
        should.exist(e);
        e.name.should.contain('InvalidStateError');
        e.message.should.contain('sequence does not match');
      }
    });
    it('should throw account does not exist', async () => {
      const email = 'a51ef89c-cd5c-4e77-a56a-e35773a87d8c@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({
        account: newAccount,
        meta: {}
      });
      const updatedAccount = {...newRecord.account};
      updatedAccount.id = 'doesnotexist';
      try {
        await brAccount.update({
          id: 'doesnotexist',
          account: updatedAccount,
          sequence: 0
        });
      } catch(e) {
        should.exist(e);
        e.name.should.contain('NotFoundError');
      }
    });
    it('should update an account without passing id', async () => {
      const email = 'b6bde968-29ab-4b7d-8731-e4c663396ad6@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({account: newAccount});
      const updatedAccount = {...newRecord.account};
      updatedAccount.email = 'UPDATED.' + email;
      await brAccount.update({
        account: updatedAccount,
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
    it('should update account meta', async () => {
      const email = '3ee92b78-a6ab-452f-9e46-9d4e7450fa2c@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({account: newAccount});
      const specialMeta = {
        custom: {
          array: [1, 2, 3]
        }
      };
      await brAccount.update({
        id: newAccount.id,
        meta: {
          ...newRecord.meta,
          sequence: newRecord.meta.sequence + 1,
          'special-meta': specialMeta
        },
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
      account.email.should.equal(email);
      should.exist(meta['special-meta']);
      meta['special-meta'].should.deep.equal(specialMeta);
    });
    it('should update account meta without passing sequence', async () => {
      const email = '655b086d-0fe7-42b7-8ffb-54acc9b480d8@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({account: newAccount});
      const specialMeta = {
        custom: {
          array: [1, 2, 3]
        }
      };
      await brAccount.update({
        id: newAccount.id,
        meta: {
          ...newRecord.meta,
          sequence: newRecord.meta.sequence + 1,
          'special-meta': specialMeta
        }
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
      account.email.should.equal(email);
      should.exist(meta['special-meta']);
      meta['special-meta'].should.deep.equal(specialMeta);
    });
    it('should update account and meta', async () => {
      const email = 'f1224b54-2348-45dc-8fb4-32575ae1aac3@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({account: newAccount});
      const updatedAccount = {...newRecord.account};
      updatedAccount.email = 'UPDATED.' + email;
      const specialMeta = {
        custom: {
          array: [1, 2, 3]
        }
      };
      await brAccount.update({
        account: updatedAccount,
        meta: {
          ...newRecord.meta,
          sequence: newRecord.meta.sequence + 1,
          'special-meta': specialMeta
        }
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
      should.exist(meta['special-meta']);
      meta['special-meta'].should.deep.equal(specialMeta);
    });
    it('should not allow id operations', async () => {
      const email = 'af12fba9-02e9-4178-aadb-169e4c501cbd@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({
        account: newAccount,
        meta: {}
      });
      const updatedAccount = {...newRecord.account};
      updatedAccount.id = 'UPDATED.' + updatedAccount.id;
      let result;
      let error;
      try {
        result = await brAccount.update({
          id: newRecord.account.id,
          account: updatedAccount,
          sequence: 0
        });
      } catch(e) {
        error = e;
      }
      should.not.exist(result);
      should.exist(error);
      error.name.should.equal('TypeError');
      error.message.should.include('"id" must equal "account.id".');
    });
    describe('indexes', () => {
      let accountId;
      // NOTE: the accounts collection is getting erased before each test
      // this allows for the creation of tokens using the same account info
      beforeEach(async () => {
        await helpers.prepareDatabase(mockData);
        accountId = mockData.accounts['alpha@example.com'].account.id;
      });
      it(`is properly indexed for 'id'`, async () => {
        const {
          executionStats
        } = await brAccount.update({
          id: accountId, meta: {sequence: 11}, sequence: 10, explain: true
        });
        executionStats.nReturned.should.equal(0);
        executionStats.totalKeysExamined.should.equal(1);
        executionStats.totalDocsExamined.should.equal(1);
        executionStats.executionStages.inputStage.inputStage.stage
          .should.equal('IXSCAN');
      });
    });
  });
});
