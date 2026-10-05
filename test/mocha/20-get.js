/*!
 * Copyright (c) 2018-2026 Digital Bazaar, Inc. All rights reserved.
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
  it('does not drop an empty unique field from the lookup', async () => {
    // an empty identifier must not resolve the account by `id` alone; a
    // consumer pairing the two is checking ownership
    const {account} = accounts['alpha@example.com'];
    for(const empty of [{email: ''}, {telephone: ''}]) {
      let err;
      try {
        await brAccount.get({id: account.id, ...empty});
      } catch(e) {
        err = e;
      }
      should.exist(err);
      err.name.should.equal('NotFoundError');
    }
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
      // MongoDB 8.3+ answers this lookup with a single EXPRESS_IXSCAN stage
      let stage = executionStats.executionStages;
      while(stage.inputStage) {
        stage = stage.inputStage;
      }
      ['IXSCAN', 'EXPRESS_IXSCAN'].should.include(stage.stage);
    });
  });

  it('returns the account when looked up by telephone number', async () => {
    const telephone = '+15550000201';
    const newAccount = helpers.createAccount(undefined, {telephone});
    await brAccount.insert({account: newAccount});
    const record = await brAccount.get({telephone});
    should.exist(record);
    record.account.id.should.equal(newAccount.id);
    record.account.telephone.should.equal(telephone);
  });
  it('throws error on non-existent telephone number', async () => {
    /* Insert a different telephone number first, so the index is populated and
       a NotFoundError means "not this number" rather than "nothing was
       queried" -- an unused selector raises the same error. */
    await brAccount.insert({
      account: helpers.createAccount(undefined, {telephone: '+15550000298'})
    });
    let err;
    try {
      await brAccount.get({telephone: '+15550000299'});
    } catch(e) {
      err = e;
    }
    should.exist(err);
    err.name.should.equal('NotFoundError');
    err.details.telephone.should.equal('+15550000299');
  });
});
