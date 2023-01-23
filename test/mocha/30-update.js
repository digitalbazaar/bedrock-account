/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as brAccount from '@bedrock/account';
import * as database from '@bedrock/mongodb';
import * as helpers from './helpers.js';
import {mockData} from './mock.data.js';

describe('update', () => {
  before(async () => {
    await helpers.prepareDatabase(mockData);
  });

  it('should update a non-email field', async () => {
    const email = 'fccc2710-6785-4131-8b78-b07da4be53f2@example.com';
    const newAccount = helpers.createAccount(email);
    const newRecord = await brAccount.insert({account: newAccount});
    const updatedAccount = {...newRecord.account};
    updatedAccount.foo = 'bar';
    await brAccount.update({
      id: newAccount.id,
      account: updatedAccount,
      sequence: 0
    });
    const updatedRecord = await database.collections.account.findOne(
      {'account.id': newAccount.id});
    should.exist(updatedRecord);
    updatedRecord.should.have.keys('_id', 'account', 'meta');
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
    account.foo.should.equal('bar');
  });
  it('should update with a new email', async () => {
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
      {'account.id': newAccount.id});
    should.exist(updatedRecord);
    updatedRecord.should.have.keys('_id', 'account', 'meta');
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
  it('should update email and non-email fields', async () => {
    const email = '7f14384e-d9f3-4678-a8f0-6746aa9e09ae@example.com';
    const newAccount = helpers.createAccount(email);
    const newRecord = await brAccount.insert({account: newAccount});
    const updatedAccount = {...newRecord.account};
    updatedAccount.email = 'UPDATED.' + email;
    updatedAccount.foo = 'bar';
    await brAccount.update({
      id: newAccount.id,
      account: updatedAccount,
      sequence: 0
    });
    const updatedRecord = await database.collections.account.findOne(
      {'account.id': newAccount.id});
    should.exist(updatedRecord);
    updatedRecord.should.have.keys('_id', 'account', 'meta');
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
    account.foo.should.equal('bar');
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
      {'account.id': newAccount.id});
    should.exist(updatedRecord);
    updatedRecord.should.have.keys('_id', 'account', 'meta');
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
      {'account.id': newAccount.id});
    should.exist(updatedRecord);
    updatedRecord.should.have.keys('_id', 'account', 'meta');
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
      {'account.id': newAccount.id});
    should.exist(updatedRecord);
    updatedRecord.should.have.keys('_id', 'account', 'meta');
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

    // ensure proxy record is present
    const proxyRecord = await database.collections['account-email'].findOne(
      {email: newAccount.email});
    should.exist(proxyRecord);
    proxyRecord.should.have.keys(['_id', 'accountId', 'email']);
    proxyRecord.accountId.should.equal(newAccount.id);
    proxyRecord.email.should.equal(newAccount.email);
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
      {'account.id': newAccount.id});
    should.exist(updatedRecord);
    updatedRecord.should.have.keys('_id', 'account', 'meta');
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

    // ensure old proxy record is gone
    const proxyRecord1 = await database.collections['account-email'].findOne(
      {email: newAccount.email});
    should.not.exist(proxyRecord1);

    // ensure proxy record is present
    const proxyRecord2 = await database.collections['account-email'].findOne(
      {email: updatedAccount.email});
    should.exist(proxyRecord2);
    proxyRecord2.should.have.keys(['_id', 'accountId', 'email']);
    proxyRecord2.accountId.should.equal(newAccount.id);
    proxyRecord2.email.should.equal('UPDATED.' + email);
  });
  it('should not allow "id" operations', async () => {
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

  describe('transactions', () => {
    it('should update email when txn failed before proxy ops', async () => {
      const email = 'c534a3ae-aa06-4609-9473-cd60c1501d3c@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({account: newAccount});

      // simulate failed transaction
      await helpers.createFailedTransaction(
        {accountId: newAccount.id, type: 'update'});

      const updatedAccount = {...newRecord.account};
      updatedAccount.email = 'UPDATED.' + email;
      await brAccount.update({
        account: updatedAccount,
        sequence: 0
      });
      const updatedRecord = await database.collections.account.findOne(
        {'account.id': newAccount.id});
      should.exist(updatedRecord);
      updatedRecord.should.have.keys('_id', 'account', 'meta');
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

      // ensure old proxy record is gone
      const proxyRecord1 = await database.collections['account-email'].findOne(
        {email: newAccount.email});
      should.not.exist(proxyRecord1);

      // ensure proxy record is present
      const proxyRecord2 = await database.collections['account-email'].findOne(
        {email: updatedAccount.email});
      should.exist(proxyRecord2);
      proxyRecord2.should.have.keys(['_id', 'accountId', 'email']);
      proxyRecord2.accountId.should.equal(newAccount.id);
      proxyRecord2.email.should.equal('UPDATED.' + email);
    });
    it('should update email when update txn w/proxy ops failed', async () => {
      // this test simulates a previous update transaction that did not commit
      // and hasn't been rolled back yet
      const email = '9d559852-df9a-4760-8e8e-f539e6b932ef@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({account: newAccount});

      // simulate failed transaction
      await helpers.createFailedTransaction({
        accountId: newAccount.id, type: 'update',
        ops: [
          {type: 'insert', email: 'failedchanged@example.com'},
          {type: 'delete', email}
        ]
      });

      const updatedAccount = {...newRecord.account};
      updatedAccount.email = 'UPDATED.' + email;
      await brAccount.update({
        account: updatedAccount,
        sequence: 0
      });
      const updatedRecord = await database.collections.account.findOne(
        {'account.id': newAccount.id});
      should.exist(updatedRecord);
      updatedRecord.should.have.keys('_id', 'account', 'meta');
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

      // ensure old proxy record is gone
      const proxyRecord1 = await database.collections['account-email'].findOne(
        {email: newAccount.email});
      should.not.exist(proxyRecord1);

      // ensure proxy record is present
      const proxyRecord2 = await database.collections['account-email'].findOne(
        {email: updatedAccount.email});
      should.exist(proxyRecord2);
      proxyRecord2.should.have.keys(['_id', 'accountId', 'email']);
      proxyRecord2.accountId.should.equal(newAccount.id);
      proxyRecord2.email.should.equal('UPDATED.' + email);
    });
    it('should update with rolled back insert txn w/proxy op', async () => {
      // this test simulates a stalled insert transaction that was rolled back
      // by another process but still wrote an insert proxy op; that insert
      // proxy op should be auto-rolled back and the update should succeed
      const email = 'e5e8a18e-250c-4f3a-ace4-fe3f75bc0a86@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({account: newAccount});
      const updatedAccount = {...newRecord.account};
      updatedAccount.email = 'UPDATED.' + email;

      // simulate failed transaction
      const failedInsertId = 'acf8342e-09b8-4d2a-adaf-0c14c2a65086';
      await helpers.createFailedTransaction({
        accountId: failedInsertId,
        type: 'insert',
        ops: [
          // this failed insert "blocks" the update
          {type: 'insert', email: updatedAccount.email}
        ],
        skipAccountRecord: true
      });

      await brAccount.update({
        account: updatedAccount,
        sequence: 0
      });
      const updatedRecord = await database.collections.account.findOne(
        {'account.id': newAccount.id});
      should.exist(updatedRecord);
      updatedRecord.should.have.keys('_id', 'account', 'meta');
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

      // ensure old proxy record is gone
      const proxyRecord1 = await database.collections['account-email'].findOne(
        {email: newAccount.email});
      should.not.exist(proxyRecord1);

      // ensure proxy record is present
      const proxyRecord2 = await database.collections['account-email'].findOne(
        {email: updatedAccount.email});
      should.exist(proxyRecord2);
      proxyRecord2.should.have.keys(['_id', 'accountId', 'email']);
      proxyRecord2.accountId.should.equal(newAccount.id);
      proxyRecord2.email.should.equal('UPDATED.' + email);
    });
    it('should update with rolled back insert txn w/proxy op', async () => {
      // this test simulates a stalled update transaction that was rolled back
      // by another process but still wrote an insert proxy op; that insert
      // proxy op should be auto-rolled back and this update should pass
      const email = '7ba5baf3-1713-4abe-afef-ba5ac095a046@example.com';
      const newAccount = helpers.createAccount(email);
      const newRecord = await brAccount.insert({account: newAccount});
      const updatedAccount = {...newRecord.account};
      updatedAccount.email = 'UPDATED.' + email;

      // simulate failed transaction
      const failedInsertId = '67b6786b-427f-4c83-8f84-66693ca6aaf4';
      await helpers.createFailedTransaction({
        accountId: failedInsertId,
        type: 'insert',
        ops: [
          // this failed insert "blocks" the update
          {type: 'insert', email: updatedAccount.email}
        ],
        skipAccountRecord: true
      });

      await brAccount.update({
        account: updatedAccount,
        sequence: 0
      });
      const updatedRecord = await database.collections.account.findOne(
        {'account.id': newAccount.id});
      should.exist(updatedRecord);
      updatedRecord.should.have.keys('_id', 'account', 'meta');
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

      // ensure old proxy record is gone
      const proxyRecord1 = await database.collections['account-email'].findOne(
        {email: newAccount.email});
      should.not.exist(proxyRecord1);

      // ensure proxy record is present
      const proxyRecord2 = await database.collections['account-email'].findOne(
        {email: updatedAccount.email});
      should.exist(proxyRecord2);
      proxyRecord2.should.have.keys(['_id', 'accountId', 'email']);
      proxyRecord2.accountId.should.equal(newAccount.id);
      proxyRecord2.email.should.equal('UPDATED.' + email);
    });
    it(
      'should throw duplicate error with rolled back update txn w/proxy op',
      async () => {
        // this test simulates a stalled update transaction that was rolled
        // back by another process but still wrote a delete proxy op; that
        // delete proxy op should be rolled back but the update should fail
        // because of a duplicate error
        const email = '8667deee-b068-4fb8-9399-d5f2985db9a4@example.com';
        const newAccount = helpers.createAccount(email);
        const newRecord = await brAccount.insert({account: newAccount});
        const updatedAccount = {...newRecord.account};
        updatedAccount.email = 'UPDATED.' + email;

        // insert record that will fail to be updated that blocks the updated
        // email
        const failedUpdateAccount = helpers.createAccount(updatedAccount.email);
        await brAccount.insert({account: failedUpdateAccount});

        // simulate failed transaction
        await helpers.createFailedTransaction({
          accountId: failedUpdateAccount.id,
          type: 'update',
          ops: [
            // this failed delete "blocks" the update
            {type: 'delete', email: updatedAccount.email}
          ]
        });

        let result;
        let error;
        try {
          result = await brAccount.update({
            account: updatedAccount,
            sequence: 0
          });
        } catch(e) {
          error = e;
        }
        should.not.exist(result);
        should.exist(error);
        error.name.should.equal('DuplicateError');
        should.exist(error.details);
        error.details.should.include.keys([
          'recordId', 'account', 'uniqueField', 'uniqueValue'
        ]);
        error.details.recordId.should.equal(newAccount.id);
        error.details.account.should.equal(newAccount.id);
        error.details.uniqueField.should.equal('email');
        error.details.uniqueValue.should.equal('UPDATED.' + email);

        // ensure failed update account exists with no _txn
        const blockingRecord = await database.collections.account.findOne(
          {'account.id': failedUpdateAccount.id});
        should.exist(blockingRecord);
        blockingRecord.should.have.keys(['_id', 'account', 'meta']);
        blockingRecord.account.id.should.equal(failedUpdateAccount.id);
        blockingRecord.account.email.should.equal('UPDATED.' + email);

        // ensure old proxy record is still present, but has no `_txn` field
        const proxyRecord = await database.collections['account-email']
          .findOne({email: failedUpdateAccount.email});
        should.exist(proxyRecord);
        proxyRecord.should.have.keys(['_id', 'accountId', 'email']);
        proxyRecord.accountId.should.equal(failedUpdateAccount.id);
        proxyRecord.email.should.equal('UPDATED.' + email);
      });
  });
});
