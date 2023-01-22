/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as brAccount from '@bedrock/account';
import * as helpers from './helpers.js';
import {mockData} from './mock.data.js';

describe.only('exists', () => {
  before(async () => {
    await helpers.prepareDatabase(mockData);
  });

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
});
