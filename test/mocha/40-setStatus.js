/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as brAccount from '@bedrock/account';
import * as database from '@bedrock/mongodb';
import * as helpers from './helpers.js';
import {mockData} from './mock.data.js';

let accounts;

describe.only('setStatus', () => {
  before(async () => {
    await helpers.prepareDatabase(mockData);
    accounts = mockData.accounts;
  });

  it('marks an account deleted, then active', async () => {
    const {account} = accounts['will-be-deleted@example.com'];
    await brAccount.setStatus({id: account.id, status: 'deleted'});

    // check status is deleted
    let record = await database.collections.account.findOne({
      'account.id': account.id
    });
    should.exist(record.account);
    should.exist(record.meta);
    record.meta.status.should.equal('deleted');

    // reactivate account
    await brAccount.setStatus({id: account.id, status: 'active'});

    // check status is active
    record = await database.collections.account.findOne({
      'account.id': account.id
    });
    should.exist(record.account);
    should.exist(record.meta);
    record.meta.status.should.equal('active');
  });
  it('throws error on a non-existent account', async () => {
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
