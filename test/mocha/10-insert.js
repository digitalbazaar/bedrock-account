/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as brAccount from '@bedrock/account';
import * as database from '@bedrock/mongodb';
import * as helpers from './helpers.js';
import {mockData} from './mock.data.js';

describe('insert', () => {
  before(async () => {
    await helpers.prepareDatabase(mockData);
  });

  it('inserts an account', async () => {
    const email = 'de3c2700-0c5d-4b75-bd6b-02dee985e39d@example.com';
    const newAccount = helpers.createAccount(email);
    await brAccount.insert({account: newAccount});
    const record = await database.collections.account.findOne(
      {'account.id': newAccount.id});
    should.exist(record);
    const {account, meta} = record;
    meta.should.be.an('object');
    should.exist(meta.created);
    meta.created.should.be.a('number');
    should.exist(meta.updated);
    meta.updated.should.be.a('number');
    meta.status.should.equal('active');
    should.exist(meta.sequence);
    meta.sequence.should.equal(0);
    account.should.be.an('object');
    account.id.should.equal(newAccount.id);
    account.email.should.equal(email);

    // ensure proxy record is present
    const proxyRecord = await database.collections['account-email'].findOne(
      {email: newAccount.email});
    should.exist(proxyRecord);
    proxyRecord.should.have.keys(['_id', 'accountId', 'email']);
    proxyRecord.accountId.should.equal(newAccount.id);
    proxyRecord.email.should.equal(newAccount.email);
  });
  it('throws error on duplicate account', async () => {
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
  it('throws error on duplicate email', async () => {
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

  describe('transactions', () => {
    it('should insert with pending insert txn', async () => {
      // this test simulates an insert transaction that did not commit; it
      // should be auto-rolled back and the insert should succeed
      const email = '4adad633-a30d-4a0f-aa3b-6d57f8b01768@example.com';
      const failedInsertAccount = helpers.createAccount(email);

      // simulate failed transaction
      await helpers.createFakeTransaction({
        accountId: failedInsertAccount.id,
        type: 'insert',
        _pending: true,
        ops: [
          // this failed insert "blocks" the insert below until it is rolled
          // back (which should happen automatically)
          {type: 'insert', email}
        ]
      });

      const newAccount = helpers.createAccount(email);
      await brAccount.insert({account: newAccount});
      const record = await database.collections.account.findOne(
        {'account.id': newAccount.id});
      should.exist(record);
      const {account, meta} = record;
      meta.should.be.an('object');
      should.exist(meta.created);
      meta.created.should.be.a('number');
      should.exist(meta.updated);
      meta.updated.should.be.a('number');
      meta.status.should.equal('active');
      should.exist(meta.sequence);
      meta.sequence.should.equal(0);
      account.should.be.an('object');
      account.id.should.equal(newAccount.id);
      account.email.should.equal(email);

      // ensure proxy record is present
      const proxyRecord = await database.collections['account-email'].findOne(
        {email: newAccount.email});
      should.exist(proxyRecord);
      proxyRecord.should.have.keys(['_id', 'accountId', 'email']);
      proxyRecord.accountId.should.equal(newAccount.id);
      proxyRecord.email.should.equal(newAccount.email);
    });
    it('should insert with rolled back insert txn w/proxy op', async () => {
      // this test simulates a stalled insert transaction that was rolled back
      // by another process but still wrote an insert proxy op; that insert
      // proxy op should be auto-rolled back and the insert should succeed
      const email = 'ce6f8448-853e-4e6f-b5da-3480f7aa66d3@example.com';
      const newAccount = helpers.createAccount(email);

      // simulate failed transaction
      const failedInsertId = 'f64f9f4a-cbc8-4803-9d55-785091017cc7';
      await helpers.createFakeTransaction({
        accountId: failedInsertId,
        type: 'insert',
        ops: [
          // this failed insert "blocks" the insert below until it is rolled
          // back (which should happen automatically)
          {type: 'insert', email}
        ],
        skipAccountRecord: true
      });

      await brAccount.insert({account: newAccount});
      const record = await database.collections.account.findOne(
        {'account.id': newAccount.id});
      should.exist(record);
      const {account, meta} = record;
      meta.should.be.an('object');
      should.exist(meta.created);
      meta.created.should.be.a('number');
      should.exist(meta.updated);
      meta.updated.should.be.a('number');
      meta.status.should.equal('active');
      should.exist(meta.sequence);
      meta.sequence.should.equal(0);
      account.should.be.an('object');
      account.id.should.equal(newAccount.id);
      account.email.should.equal(email);

      // ensure proxy record is present
      const proxyRecord = await database.collections['account-email'].findOne(
        {email: newAccount.email});
      should.exist(proxyRecord);
      proxyRecord.should.have.keys(['_id', 'accountId', 'email']);
      proxyRecord.accountId.should.equal(newAccount.id);
      proxyRecord.email.should.equal(newAccount.email);
    });
    it('should throw duplicate error with rolled back update txn w/proxy op',
      async () => {
        // this test simulates a stalled update transaction that was rolled
        // back by another process but still wrote an delete proxy op; that
        // delete proxy op should be rolled back but the insert should fail
        // because of a duplicate error
        const email = 'b666d152-0c1a-420d-884d-93cb8b326e60@example.com';

        // insert record that will fail to be updated that blocks the updated
        // email
        const failedUpdateAccount = helpers.createAccount(email);
        await brAccount.insert({account: failedUpdateAccount});

        // simulate failed transaction
        await helpers.createFakeTransaction({
          accountId: failedUpdateAccount.id,
          type: 'update',
          ops: [
            // this failed delete "blocks" the insert
            {type: 'delete', email}
          ]
        });

        // now try to insert account w/same email
        const newAccount = helpers.createAccount(email);
        let error;
        try {
          await brAccount.insert({account: newAccount});
        } catch(e) {
          error = e;
        }
        should.exist(error);
        error.name.should.equal('DuplicateError');
        should.exist(error.details);
        error.details.should.include.keys([
          'recordId', 'account', 'uniqueField', 'uniqueValue'
        ]);
        error.details.recordId.should.equal(newAccount.id);
        error.details.account.should.equal(newAccount.id);
        error.details.uniqueField.should.equal('email');
        error.details.uniqueValue.should.equal(email);

        // ensure failed update account exists with no _txn
        const blockingRecord = await database.collections.account.findOne(
          {'account.id': failedUpdateAccount.id});
        should.exist(blockingRecord);
        blockingRecord.should.have.keys(['_id', 'account', 'meta']);
        blockingRecord.account.id.should.equal(failedUpdateAccount.id);
        blockingRecord.account.email.should.equal(email);

        // ensure old proxy record is still present, but has no `_txn` field
        const proxyRecord = await database.collections['account-email']
          .findOne({email: failedUpdateAccount.email});
        should.exist(proxyRecord);
        proxyRecord.should.have.keys(['_id', 'accountId', 'email']);
        proxyRecord.accountId.should.equal(failedUpdateAccount.id);
        proxyRecord.email.should.equal(email);
      });
    it('should throw duplicate error with committed but incomplete txn',
      async () => {
        // this test simulates a committed, but incomplete transaction that
        // should be completed and then result in a duplicate error being
        // thrown
        const email = '065c5551-5468-4fe4-b6d3-baa87ee29a98@example.com';
        // insert record that will be marked with a committed, but incomplete
        // transaction
        const committedAccount = helpers.createAccount(email);
        await brAccount.insert({account: committedAccount});

        // simulate committed but incomplete transaction
        await helpers.createFakeTransaction({
          accountId: committedAccount.id,
          type: 'insert',
          committed: true,
          ops: [
            {type: 'insert', email}
          ]
        });

        // now try to insert account w/same email
        const newAccount = helpers.createAccount(email);
        let error;
        try {
          await brAccount.insert({account: newAccount});
        } catch(e) {
          error = e;
        }
        should.exist(error);
        error.name.should.equal('DuplicateError');
        should.exist(error.details);
        error.details.should.include.keys([
          'recordId', 'account', 'uniqueField', 'uniqueValue'
        ]);
        error.details.recordId.should.equal(newAccount.id);
        error.details.account.should.equal(newAccount.id);
        error.details.uniqueField.should.equal('email');
        error.details.uniqueValue.should.equal(email);

        // ensure failed update account exists with no _txn
        const blockingRecord = await database.collections.account.findOne(
          {'account.id': committedAccount.id});
        should.exist(blockingRecord);
        blockingRecord.should.have.keys(['_id', 'account', 'meta']);
        blockingRecord.account.id.should.equal(committedAccount.id);
        blockingRecord.account.email.should.equal(email);

        // ensure old proxy record is still present, but has no `_txn` field
        const proxyRecord = await database.collections['account-email']
          .findOne({email: committedAccount.email});
        should.exist(proxyRecord);
        proxyRecord.should.have.keys(['_id', 'accountId', 'email']);
        proxyRecord.accountId.should.equal(committedAccount.id);
        proxyRecord.email.should.equal(email);
      });
  });
});
