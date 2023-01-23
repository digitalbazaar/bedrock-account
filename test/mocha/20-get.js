/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as brAccount from '@bedrock/account';
import * as helpers from './helpers.js';
import {mockData} from './mock.data.js';

let accounts;

describe('get', () => {
  before(async () => {
    await helpers.prepareDatabase(mockData);
    accounts = mockData.accounts;
  });

  it('throws error on non-existent account', async () => {
    let err;
    try {
      await brAccount.get({id: 'urn:uuid:nobody'});
    } catch(e) {
      err = e;
    }
    should.exist(err);
    err.name.should.equal('NotFoundError');
  });
  it('returns account when active option is not specified', async () => {
    // should get account even if status is `deleted`
    const {account} = accounts['will-be-deleted@example.com'];
    await brAccount.setStatus({id: account.id, status: 'deleted'});
    const record = await brAccount.get({id: account.id});
    should.exist(record);
    record.should.be.an('object');
    // this ensure only the 2 properties specified in projection
    // are returned not _id
    record.should.have.keys(['account', 'meta']);
    record.account.should.be.an('object');
    record.meta.should.be.an('object');
    record.meta.status.should.equal('deleted');
    await brAccount.setStatus({id: account.id, status: 'active'});
  });
  it('gets existing account by ID', async () => {
    const {account} = accounts['alpha@example.com'];
    const record = await brAccount.get({id: account.id});
    should.exist(record);
    record.should.be.an('object');
    // this ensure only the 2 properties specified in projection
    // are returned not _id
    record.should.have.keys(['account', 'meta']);
    record.account.id.should.equal(account.id);
    record.account.email.should.equal(account.email);
    record.meta.status.should.equal('active');
  });
  it('gets existing account by email', async () => {
    const {account} = accounts['alpha@example.com'];
    const record = await brAccount.get({email: account.email});
    should.exist(record);
    record.should.be.an('object');
    // this ensure only the 2 properties specified in projection
    // are returned not _id
    record.should.have.keys(['account', 'meta']);
    record.account.id.should.equal(account.id);
    record.account.email.should.equal(account.email);
    record.meta.status.should.equal('active');
  });
  it('gets existing account by ID and email', async () => {
    const {account} = accounts['alpha@example.com'];
    const record = await brAccount.get(
      {id: account.id, email: account.email});
    should.exist(record);
    record.should.be.an('object');
    // this ensure only the 2 properties specified in projection
    // are returned not _id
    record.should.have.keys(['account', 'meta']);
    record.account.id.should.equal(account.id);
    record.account.email.should.equal(account.email);
    record.meta.status.should.equal('active');
  });
  it('throws error on non-matching ID and email', async () => {
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
});
