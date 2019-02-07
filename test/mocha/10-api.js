/*
 * Copyright (c) 2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const brAccount = require('bedrock-account');
const brIdentity = require('bedrock-identity');
const database = require('bedrock-mongodb');
const helpers = require('./helpers');
const jsonpatch = require('fast-json-patch');
const mockData = require('./mock.data');
let actors;
let accounts;

describe('bedrock-account', () => {
  before(async () => {
    await helpers.prepareDatabase(mockData);
    actors = await helpers.getActors(mockData);
    accounts = mockData.accounts;
  });

  describe('setStatus API', () => {
    describe('null actor', async () => {
      it('should mark an account deleted, then active', async () => {
        const account = accounts['will-be-deleted@example.com'].account;
        await brAccount.setStatus({
          actor: null,
          id: account.id,
          status: 'deleted'
        });

        // check status is deleted
        let record = await database.collections.account.findOne({
          id: database.hash(account.id)
        });
        should.exist(record.account);
        should.exist(record.meta);
        record.meta.status.should.equal('deleted');

        // reactivate account
        await brAccount.setStatus({
          actor: null,
          id: account.id,
          status: 'active'
        });

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
          await brAccount.setStatus({
            actor: null,
            id,
            status: 'deleted'
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('NotFoundError');
        err.details.account.should.equal(id);
      });
    }); // end null actor
    describe('regular account', () => {
      it('permission denied on attempt to change own status', async () => {
        const actor = actors['alpha@example.com'];
        const account = accounts['alpha@example.com'].account;
        let err;
        try {
          await brAccount.setStatus({
            actor,
            id: account.id,
            status: 'deleted'
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('PermissionDenied');
      });
      it('permission denied on attempt to change another account\'s status',
        async () => {
          const actor = actors['alpha@example.com'];
          const account = accounts['admin@example.com'].account;
          let err;
          try {
            await brAccount.setStatus({
              actor,
              id: account.id,
              status: 'deleted'
            });
          } catch(e) {
            err = e;
          }
          should.exist(err);
          err.name.should.equal('PermissionDenied');
        });
    });
    describe('admin user', function() {
      it('should mark an account deleted, then active', async () => {
        const actor = actors['admin@example.com'];
        const account = accounts['will-be-deleted@example.com'].account;
        await brAccount.setStatus({
          actor,
          id: account.id,
          status: 'deleted'
        });

        // check status is deleted
        let record = await database.collections.account.findOne({
          id: database.hash(account.id)
        });
        should.exist(record.account);
        should.exist(record.meta);
        record.meta.status.should.equal('deleted');

        // reactivate account
        await brAccount.setStatus({
          actor: null,
          id: account.id,
          status: 'active'
        });

        // check status is active
        record = await database.collections.account.findOne({
          id: database.hash(account.id)
        });
        should.exist(record.account);
        should.exist(record.meta);
        record.meta.status.should.equal('active');
      });
    });
  });

  describe('get API', () => {
    describe('null actor', () => {
      it('should return error on non-existent account', async () => {
        let err;
        try {
          await brAccount.get({
            actor: null,
            id: 'urn:uuid:nobody'
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('NotFoundError');
      });
      it('return account when active option is not specified', async () => {
        const account = actors['will-be-deleted@example.com'];

        await brAccount.setStatus({
          actor: null,
          id: account.id,
          status: 'deleted'
        });

        const record = await brAccount.get({
          actor: null,
          id: account.id
        });
        should.exist(record);
        record.account.should.be.an('object');
        record.meta.should.be.an('object');
        record.meta.status.should.equal('deleted');

        await brAccount.setStatus({
          actor: null,
          id: account.id,
          status: 'active'
        });
      });
    }); // end null actor
    describe('regular user', () => {
      it('should be able to access itself', async () => {
        const actor = actors['alpha@example.com'];
        const account = accounts['alpha@example.com'].account;
        const record = await brAccount.get({
          actor,
          id: account.id
        });
        should.exist(record);
        record.account.id.should.equal(account.id);
        record.account.email.should.equal(account.email);
        record.meta.status.should.equal('active');
      });
      it('should not be able to access another account', async () => {
        const actor = actors['alpha@example.com'];
        const account = accounts['admin@example.com'].account;
        let err;
        let record;
        try {
          record = await brAccount.get({
            actor,
            id: account.id
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        should.not.exist(record);
        err.name.should.equal('PermissionDenied');
      });
    }); // end regular user
    describe('admin user', () => {
      it('should be able to access itself', async () => {
        const actor = actors['admin@example.com'];
        const account = accounts['admin@example.com'].account;
        const record = await brAccount.get({
          actor,
          id: account.id
        });
        should.exist(record);
        record.account.id.should.equal(account.id);
        record.account.email.should.equal(account.email);
        record.meta.status.should.equal('active');
      });
      it('should be able to access another account', async () => {
        const actor = actors['admin@example.com'];
        const account = accounts['alpha@example.com'].account;
        const record = await brAccount.get({
          actor,
          id: account.id
        });
        should.exist(record);
        record.account.id.should.equal(account.id);
        record.account.email.should.equal(account.email);
      });
    }); // end admin user
  }); // end get API

  describe('insert API', () => {
    describe('null actor', () => {
      it('should insert an account', async () => {
        const email = 'de3c2700-0c5d-4b75-bd6b-02dee985e39d@example.com';
        const newAccount = helpers.createAccount(email);
        await brAccount.insert({
          actor: null,
          account: newAccount
        });
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
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(0);
        account.should.be.an('object');
        account.id.should.equal(newAccount.id);
        account.email.should.equal(email);
      });
      it('should return error on duplicate account', async () => {
        const email = '99748241-3599-41a0-8445-d092de558b9f@example.com';
        const newAccount = helpers.createAccount(email);
        await brAccount.insert({
          actor: null,
          account: newAccount
        });
        // attempt to insert the same account again
        let err;
        try {
          await brAccount.insert({
            actor: null,
            account: newAccount
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('DuplicateError');
      });
      it('should properly generate a resource ID for one role', async () => {
        const email = '15065125-6e65-4f2e-9736-bb49aee468a4@example.com';
        const newAccount = helpers.createAccount(email);
        const newMeta = {
          sysResourceRole: [{
            sysRole: 'bedrock-account.regular',
            generateResource: 'id'
          }]
        };
        await brAccount.insert({
          actor: null,
          account: newAccount,
          meta: newMeta
        });
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
        // test sysResourceRole
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(1);
        testRole(
          meta.sysResourceRole[0], 'bedrock-account.regular', [newAccount.id]);
        account.should.be.an('object');
        account.id.should.equal(newAccount.id);
        account.email.should.equal(email);
      });
      it('returns error if generateResouce !== `id`', async () => {
        const email = 'e29ea95f-fb91-4a03-8bdf-26d254caa953@example.com';
        const newAccount = helpers.createAccount(email);
        const newMeta = {
          sysResourceRole: [{
            sysRole: 'bedrock-account.regular',
            generateResource: 'notId'
          }]
        };
        let err;
        try {
          await brAccount.insert({
            actor: null,
            account: newAccount,
            meta: newMeta
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('NotSupportedError');
        err.message.should.equal(
          'Could not create Account; unknown ResourceRole rule.');
        err.details.should.be.an('object');
        err.details.sysResourceRole.should.be.an('object');
        err.details.sysResourceRole.sysRole
          .should.equal('bedrock-account.regular');
        err.details.sysResourceRole.generateResource
          .should.equal('notId');
      });
      it('generates a resource ID for one role with other resources',
        async () => {
          const email = '9d8a65ad-ab7c-407a-b818-e3a090680673@example.com';
          const altEmail = 'b7f24a46-9128-4aec-ab3d-1e9d7770f7da@example.com';
          const altAccount = helpers.createAccount(altEmail);
          const newAccount = helpers.createAccount(email);
          const newMeta = {
            sysResourceRole: [{
              sysRole: 'bedrock-account.regular',
              generateResource: 'id',
              resource: [altAccount.id]
            }]
          };
          await brAccount.insert({
            actor: null,
            account: newAccount,
            meta: newMeta
          });
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
          // test sysResourceRole
          meta.sysResourceRole.should.be.an('array');
          meta.sysResourceRole.should.have.length(1);
          testRole(
            meta.sysResourceRole[0], 'bedrock-account.regular',
            [newAccount.id, altAccount.id]);
          account.should.be.an('object');
          account.id.should.equal(newAccount.id);
          account.email.should.equal(email);
        });
      it('should properly generate a resource ID for three roles', async () => {
        const email = '6ed0734c-8a29-499f-8a21-eb3bd7923620@example.com';
        const newAccount = helpers.createAccount(email);
        const newMeta = {
          sysResourceRole: [{
            sysRole: 'bedrock-account.alpha',
            generateResource: 'id'
          }, {
            sysRole: 'bedrock-account.beta',
            generateResource: 'id'
          }, {
            sysRole: 'bedrock-account.gamma',
            generateResource: 'id'
          }]
        };
        await brAccount.insert({
          actor: null,
          account: newAccount,
          meta: newMeta
        });
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
        // test sysResourceRole
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(3);
        testRole(
          meta.sysResourceRole[0], 'bedrock-account.alpha',
          [newAccount.id]);
        testRole(
          meta.sysResourceRole[1], 'bedrock-account.beta',
          [newAccount.id]
        );
        testRole(
          meta.sysResourceRole[2], 'bedrock-account.gamma',
          [newAccount.id]
        );
        account.should.be.an('object');
        account.id.should.equal(newAccount.id);
        account.email.should.equal(email);
      });
    });
  }); // end insert API

  describe('update API', () => {
    describe('null actor', () => {
      it('should update an account', async () => {
        const email = '388f3331-1015-4b2b-9ed2-f931fe53d074@example.com';
        const newAccount = helpers.createAccount(email);
        const newRecord = await brAccount.insert({
          actor: null,
          account: newAccount
        });
        const updatedAccount = newRecord.account;
        const observer = jsonpatch.observe(updatedAccount);
        updatedAccount.email = 'UPDATED.' + email;
        const patch = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedAccount, observer);
        console.log('updated id', updatedAccount.id);
        await brAccount.update({
          actor: null,
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
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(0);
        account.should.be.an('object');
        account.id.should.equal(newAccount.id);
        account.email.should.equal('UPDATED.' + email);
      });
    });
    describe('regular actor', () => {
      it('should update an account', async () => {
        const email = '6e1e026d-a679-4714-aecd-9f948a3d19e7@example.com';
        const newAccount = helpers.createAccount(email);
        const newRecord = await brAccount.insert({
          actor: null,
          account: newAccount,
          meta: {
            sysResourceRole: [{
              sysRole: 'bedrock-account.regular',
              generateResource: 'id'
            }]
          }
        });
        const actor = await brAccount.getCapabilities({id: newAccount.id});
        const updatedAccount = newRecord.account;
        const observer = jsonpatch.observe(updatedAccount);
        updatedAccount.email = 'UPDATED.' + email;
        const patch = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedAccount, observer);
        await brAccount.update({
          actor,
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
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(1);
        account.should.be.an('object');
        account.id.should.equal(newAccount.id);
        account.email.should.equal('UPDATED.' + email);
      });
      it('should throw Permission Denied', async () => {
        const email = '5060f106-6e81-11e8-b7d6-c312ad2e6655@example.com';
        const newAccount = helpers.createAccount(email);
        const newRecord = await brAccount.insert({
          actor: null,
          account: newAccount,
          meta: {
            sysResourceRole: [{
              sysRole: 'bedrock-account.regular',
              generateResource: 'id'
            }]
          }
        });
        const updatedAccount = newRecord.account;
        const observer = jsonpatch.observe(updatedAccount);
        updatedAccount.email = 'UPDATED.' + email;
        const patch = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedAccount, observer);
        let err;
        try {
          await brAccount.update({
            actor: actors['alpha@example.com'],
            id: updatedAccount.id,
            patch,
            sequence: 0
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('PermissionDenied');
      });
      it('should throw Record sequence does not match.', async () => {
        const email = '6e1e026d-a679-4714-aecd-9f948a3d19e7@example.com';
        const newAccount = helpers.createAccount(email);
        const newRecord = await brAccount.insert({
          actor: null,
          account: newAccount,
          meta: {
            sysResourceRole: [{
              sysRole: 'bedrock-account.regular',
              generateResource: 'id'
            }]
          }
        });
        const actor = await brAccount.getCapabilities({id: newAccount.id});
        const updatedAccount = newRecord.account;
        const observer = jsonpatch.observe(updatedAccount);
        updatedAccount.email = 'UPDATED.' + email;
        const patch = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedAccount, observer);
        try {
          await brAccount.update({
            actor,
            id: updatedAccount.id,
            patch,
            sequence: 99
          });
          should.exist(undefined, 'update did not throw an error');
        } catch(e) {
          should.exist(e);
          e.name.should.contain('InvalidStateError');
          e.message.should.contain('sequence');
        }
      });
      it('should throw invalid path', async () => {
        const email = '6e1e026d-a679-4714-aecd-9f948a3d19e7@example.com';
        const newAccount = helpers.createAccount(email);
        const newRecord = await brAccount.insert({
          actor: null,
          account: newAccount,
          meta: {
            sysResourceRole: [{
              sysRole: 'bedrock-account.regular',
              generateResource: 'id'
            }]
          }
        });
        const actor = await brAccount.getCapabilities({id: newAccount.id});
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
            actor,
            id: updatedAccount.id,
            patch,
            sequence: 0
          });
          should.exist(undefined, 'update did not throw an error');
        } catch(e) {
          should.exist(e);
          e.name.should.contain('ValidationError');
          e.message.should.match(/patch\s+is\s+invalid/);
        }
      });
      it('should not allow id operations', async () => {
        const email = '6e1e026d-a679-4714-aecd-9f948a3d19e7@example.com';
        const newAccount = helpers.createAccount(email);
        const newRecord = await brAccount.insert({
          actor: null,
          account: newAccount,
          meta: {
            sysResourceRole: [{
              sysRole: 'bedrock-account.regular',
              generateResource: 'id'
            }]
          }
        });
        const actor = await brAccount.getCapabilities({id: newAccount.id});
        const updatedAccount = newRecord.account;
        const observer = jsonpatch.observe(updatedAccount);
        updatedAccount.email = 'UPDATED.' + email;
        const updates = jsonpatch.generate(observer);
        jsonpatch.unobserve(updatedAccount, observer);
        const patch = updates.map(p => {
          p.path = '/id';
          return p;
        });
        try {
          await brAccount.update({
            actor,
            id: updatedAccount.id,
            patch,
            sequence: 0
          });
          should.exist(undefined, 'update did not throw an error');
        } catch(e) {
          console.log(e, e.name, e.message);
          should.exist(e);
          e.name.should.contain('ValidationError');
          e.message.should.match(/patch\s+is\s+invalid/i);
          e.details.errors.message.should.match(/can\s+not\s+change\s+id/i);
        }
      });

    });
  });

  describe('updateRoles API', () => {
    describe('null actor', () => {
      it('should allow updates to capabilities', async () => {
        const regular = '9930e2f4-6b59-11e8-9457-9f540c45ea21@example.com';
        const regularAccount = helpers.createAccount(regular);

        await brAccount.insert({
          actor: null,
          account: regularAccount,
          meta: {
            // capability to do things with any account
            sysResourceRole: {
              sysRole: 'bedrock-account.regular',
              generateResource: 'id'
            }
          }
        });

        // now grant capabilities to user
        const someResource = 'urn:uuid:53e0b5ac-6e84-11e8-97f1-af61454ac8d2';
        await brAccount.updateRoles({
          actor: null,
          id: regularAccount.id,
          add: [{
            sysRole: 'bedrock-account.regular',
            resource: [someResource]
          }],
          sequence: 0
        });

        const record = await database.collections.account.findOne(
          {id: database.hash(regularAccount.id)});
        should.exist(record);
        const {meta} = record;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(1);
        meta.sysResourceRole.should.include.deep.members([{
          sysRole: 'bedrock-account.regular',
          resource: [regularAccount.id, someResource]
        }]);
      });
    });
    describe('admin actor', () => {
      it('should allow updates to capabilities', async () => {
        const regular = '9930e2f4-6b59-11e8-9457-9f540c45ea21@example.com';
        const admin = '995e0450-6b59-11e8-be3c-23b7c5cd73f9@example.com';
        const regularAccount = helpers.createAccount(regular);
        const adminAccount = helpers.createAccount(admin);

        await brAccount.insert({
          actor: null,
          account: adminAccount,
          meta: {
            // capability to do things with self
            sysResourceRole: {
              sysRole: 'bedrock-account.admin'
            }
          }
        });
        await brAccount.insert({
          actor: null,
          account: regularAccount,
          meta: {
            // capability to do things with any account
            sysResourceRole: {
              sysRole: 'bedrock-account.regular',
              generateResource: 'id'
            }
          }
        });

        // now admin grants capabilities to user
        const actor = await brAccount.getCapabilities({id: adminAccount.id});
        await brAccount.updateRoles({
          actor,
          id: regularAccount.id,
          add: [{
            sysRole: 'bedrock-account.regular',
            resource: [adminAccount.id]
          }],
          sequence: 0
        });

        const record = await database.collections.account.findOne(
          {id: database.hash(regularAccount.id)});
        should.exist(record);
        const {meta} = record;
        meta.should.be.an('object');
        should.exist(meta.created);
        meta.created.should.be.a('number');
        should.exist(meta.updated);
        meta.updated.should.be.a('number');
        meta.status.should.equal('active');
        meta.sysResourceRole.should.be.an('array');
        meta.sysResourceRole.should.have.length(1);
        meta.sysResourceRole.should.include.deep.members([{
          sysRole: 'bedrock-account.regular',
          resource: [regularAccount.id, adminAccount.id]
        }]);
      });
    });
    describe('regular actor', () => {
      it('should not allow updates to capabilities', async () => {
        const regular = '636d7438-6e84-11e8-a446-f32f1a6da338@example.com';
        const regular2 = '6909f290-6e84-11e8-a30f-536de690aa9e@example.com';
        const regularAccount = helpers.createAccount(regular);
        const regular2Account = helpers.createAccount(regular2);

        await brAccount.insert({
          actor: null,
          account: regularAccount,
          meta: {
            // capability to do things with self
            sysResourceRole: {
              sysRole: 'bedrock-account.regular',
              generateResource: 'id'
            }
          }
        });
        await brAccount.insert({
          actor: null,
          account: regular2Account,
          meta: {
            // capability to do things with any account
            sysResourceRole: {
              sysRole: 'bedrock-account.regular',
              generateResource: 'id'
            }
          }
        });

        // now admin grants capabilities to user
        const actor = await brAccount.getCapabilities({id: regularAccount.id});
        let err;
        try {
          await brAccount.updateRoles({
            actor,
            id: regular2Account.id,
            add: [{
              sysRole: 'bedrock-account.regular',
              resource: [regularAccount.id]
            }],
            sequence: 0
          });
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.name.should.equal('PermissionDenied');
      });
    });
  });

  describe('exists API', () => {
    describe('null actor', () => {
      it('returns false if account does not exist', async () => {
        const actor = null;
        const id = 'urn:uuid:e4cbbbfe-c964-4c7f-89cc-375698f0b776';
        const exists = await brAccount.exists({actor, id});
        exists.should.be.false;
      });
      it('returns true if account exists', async () => {
        const actor = null;
        const email = '9d8a34bb-6b3a-4b1a-b69c-322fbbd9536e@example.com';
        const newAccount = helpers.createAccount(email);
        await brAccount.insert({actor, account: newAccount});
        const exists = await brAccount.exists({actor, id: newAccount.id});
        exists.should.be.true;
      });
      it('returns false for deleted account by default', async () => {
        const actor = null;
        const email = '8a354515-17cb-453d-b45a-5d3964706f9f@example.com';
        const newAccount = helpers.createAccount(email);
        await brAccount.insert({actor, account: newAccount});
        await brAccount.setStatus(
          {actor, id: newAccount.id, status: 'deleted'});
        const exists = await brAccount.exists({actor, id: newAccount.id});
        exists.should.be.false;
      });
      it('returns true for deleted account with deleted option', async () => {
        const actor = null;
        const email = '76fbb25e-514d-4566-b270-b08ff8989543@example.com';
        const newAccount = helpers.createAccount(email);
        await brAccount.insert({actor, account: newAccount});
        await brAccount.setStatus(
          {actor, id: newAccount.id, status: 'deleted'});
        const exists = await brAccount.exists(
          {actor, id: newAccount.id, status: 'deleted'});
        exists.should.be.true;
      });
    }); // end null actor
    describe('regular user', () => {
      it('returns PermissionDenied when another user ID is specified',
        async () => {
          const actor = actors['alpha@example.com'];
          const id = 'urn:uuid:nobody';
          let err;
          try {
            await brAccount.exists({actor, id});
          } catch(e) {
            err = e;
          }
          should.exist(err);
          err.name.should.equal('PermissionDenied');
          err.details.sysPermission.should.equal('ACCOUNT_ACCESS');
        });
      it('returns true if own account exists', async () => {
        const actor = actors['alpha@example.com'];
        const account = accounts['alpha@example.com'].account;
        const exists = await brAccount.exists({actor, id: account.id});
        exists.should.be.true;
      });
    }); // end regular user
    describe('admin user', () => {
      it('returns false if account does not exist', async () => {
        const actor = actors['admin@example.com'];
        const id = 'urn:uuid:nobody';
        const exists = await brAccount.exists({actor, id});
        exists.should.be.false;
      });
      it('returns true if account exists', async () => {
        const actor = actors['admin@example.com'];
        const email = '474af20b-fdf8-472b-a22a-b510bebf452f@example.com';
        const newAccount = helpers.createAccount(email);
        await brAccount.insert({actor: null, account: newAccount});
        const exists = await brAccount.exists({actor, id: newAccount.id});
        exists.should.be.true;
      });
    }); // end admin user
  }); // end exists API

  describe('manageIdentity API', () => {
    it('should make an account manage an identity', async () => {
      const userName = '8f46904d-3c18-468e-8843-0238e25b74dc';
      const newIdentity = helpers.createIdentity(userName);
      await brIdentity.insert({
        actor: null,
        identity: newIdentity,
        meta: {
          sysResourceRole: [{
            sysRole: 'bedrock-identity.regular',
            generateResource: 'id'
          }]
        }
      });
      const email = '344cef84-5d1e-4972-9c4e-861c487a8498@example.com';
      const newAccount = helpers.createAccount(email);
      await brAccount.insert({
        actor: null,
        account: newAccount,
        meta: {
          sysResourceRole: [{
            sysRole: 'bedrock-account.regular',
            generateResource: 'id'
          }]
        }
      });

      // combine capabilities (i.e. user authenticates as both account
      // and identity)
      const accountActor = await brAccount.getCapabilities(
        {id: newAccount.id});
      const identityActor = await brIdentity.getCapabilities(
        {id: newIdentity.id});
      const actor = {
        sysResourceRole: accountActor.sysResourceRole.concat(
          identityActor.sysResourceRole)
      };

      await brAccount.manageIdentity(
        {actor, accountId: newAccount.id, identityId: newIdentity.id});

      const record = await database.collections.identity.findOne(
        {id: database.hash(newIdentity.id)});
      should.exist(record);
      should.exist(record.meta);
      should.exist(record.identity);
      const {meta} = record;
      should.exist(meta['bedrock-account']);
      meta['bedrock-account'].should.be.an('object');
      should.exist(meta['bedrock-account'].account);
      meta['bedrock-account'].account.should.equal(newAccount.id);
    });
    it('should make an account manage an owned identity', async () => {
      const ownerName = '26cb91c6-6e80-11e8-a2c3-77a0d64b81fc';
      const newOwner = helpers.createIdentity(ownerName);
      await brIdentity.insert({
        actor: null,
        identity: newOwner,
        meta: {
          sysResourceRole: [{
            sysRole: 'bedrock-identity.regular',
            generateResource: 'id'
          }]
        }
      });
      const userName = '11e5e112-6e80-11e8-9ec1-9b50a73753b8';
      const newIdentity = helpers.createIdentity(userName);
      newIdentity.owner = newOwner.id;
      await brIdentity.insert({
        actor: null,
        identity: newIdentity,
        meta: {
          sysResourceRole: [{
            sysRole: 'bedrock-identity.regular',
            generateResource: 'id'
          }]
        }
      });
      const email = '127a8ef2-6e80-11e8-a236-433b5e4db841@example.com';
      const newAccount = helpers.createAccount(email);
      await brAccount.insert({
        actor: null,
        account: newAccount,
        meta: {
          sysResourceRole: [{
            sysRole: 'bedrock-account.regular',
            generateResource: 'id'
          }]
        }
      });

      // combine capabilities (i.e. user authenticates as both account
      // and owner identity)
      const accountActor = await brAccount.getCapabilities(
        {id: newAccount.id});
      const ownerActor = await brIdentity.getCapabilities(
        {id: newOwner.id});
      const actor = {
        sysResourceRole: accountActor.sysResourceRole.concat(
          ownerActor.sysResourceRole)
      };

      // now manage `newIdentity` (owner of identity should be capable of
      // doing this)
      await brAccount.manageIdentity(
        {actor, accountId: newAccount.id, identityId: newIdentity.id});

      const record = await database.collections.identity.findOne(
        {id: database.hash(newIdentity.id)});
      should.exist(record);
      should.exist(record.meta);
      should.exist(record.identity);
      const {meta} = record;
      should.exist(meta['bedrock-account']);
      meta['bedrock-account'].should.be.an('object');
      should.exist(meta['bedrock-account'].account);
      meta['bedrock-account'].account.should.equal(newAccount.id);
    });
    it('should allow a managing account update an identity', async () => {
      const userName = '4780541e-6ff3-11e8-932a-27b40b9d348e';
      const newIdentity = helpers.createIdentity(userName);
      await brIdentity.insert({
        actor: null,
        identity: newIdentity,
        meta: {
          sysResourceRole: [{
            sysRole: 'bedrock-identity.regular',
            generateResource: 'id'
          }]
        }
      });
      const email = '4cd22b04-6ff3-11e8-b287-33a8c2630a6d@example.com';
      const newAccount = helpers.createAccount(email);
      await brAccount.insert({
        actor: null,
        account: newAccount,
        meta: {
          sysResourceRole: [{
            sysRole: 'bedrock-account.regular',
            generateResource: 'id'
          }]
        }
      });

      // combine capabilities (i.e. user authenticates as both account
      // and identity)
      const accountActor = await brAccount.getCapabilities({id: newAccount.id});
      const identityActor = await brIdentity.getCapabilities(
        {id: newIdentity.id});
      const actor = {
        sysResourceRole: accountActor.sysResourceRole.concat(
          identityActor.sysResourceRole)
      };

      await brAccount.manageIdentity(
        {actor, accountId: newAccount.id, identityId: newIdentity.id});

      // now get capabilities again for account and update the identity
      const newActor = await brAccount.getCapabilities({id: newAccount.id});
      const updatedIdentity = newIdentity;
      const observer = jsonpatch.observe(updatedIdentity);
      updatedIdentity.url = 'https://new.example.com';
      updatedIdentity.label = userName + 'UPDATED';
      const patch = jsonpatch.generate(observer);
      jsonpatch.unobserve(updatedIdentity, observer);
      await brIdentity.update({
        actor: newActor,
        id: updatedIdentity.id,
        patch,
        sequence: 0
      });
      const updatedRecord = await database.collections.identity.findOne(
        {id: database.hash(newIdentity.id)});
      should.exist(updatedRecord);
      const {identity, meta} = updatedRecord;
      meta.should.be.an('object');
      should.exist(meta.created);
      meta.created.should.be.a('number');
      should.exist(meta.updated);
      meta.updated.should.be.a('number');
      meta.status.should.equal('active');
      meta.sysResourceRole.should.be.an('array');
      meta.sysResourceRole.should.have.length(1);
      identity.should.be.an('object');
      identity.id.should.equal(newIdentity.id);
      identity.label.should.equal(userName + 'UPDATED');
      identity.email.should.equal(userName + '@bedrock.dev');
      identity.url.should.equal('https://new.example.com');
      identity.description.should.equal(userName);
    });
  }); // end manageIdentity API
}); // end bedrock-account

function testRole(role, roleId, resource) {
  role.should.be.an('object');
  should.not.exist(role.generateResource);
  should.exist(role.sysRole);
  role.sysRole.should.equal(roleId);
  should.exist(role.resource);
  role.resource.should.be.an('array');
  role.resource.should.have.same.members(resource);
}
