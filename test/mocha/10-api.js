/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as brAccount from '@bedrock/account';
import * as database from '@bedrock/mongodb';
import * as helpers from './helpers.js';
import jsonpatch from 'fast-json-patch';
import {mockData} from './mock.data.js';

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
        } = await brAccount.get({id: accountId, explain: true});
        executionStats.nReturned.should.equal(1);
        executionStats.totalKeysExamined.should.equal(1);
        executionStats.totalDocsExamined.should.equal(1);
        executionStats.executionStages.inputStage.inputStage.inputStage.stage
          .should.equal('IXSCAN');
      });
      it(`is properly indexed for 'account.email'`, async () => {
        const {
          executionStats
        } = await brAccount.get({email: 'alpha@example.com', explain: true});
        executionStats.nReturned.should.equal(1);
        executionStats.totalKeysExamined.should.equal(1);
        executionStats.totalDocsExamined.should.equal(1);
        executionStats.executionStages.inputStage.inputStage.inputStage.stage
          .should.equal('IXSCAN');
      });
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
