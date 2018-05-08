/*
 * Copyright (c) 2018 Digital Bazaar, Inc. All rights reserved.
 */
const config = require('bedrock').config;
require('bedrock-permission');

config.account = {};

// permissions
const permissions = config.permission.permissions;
permissions.ACCOUNT_ACCESS = {
  id: 'ACCOUNT_ACCESS',
  label: 'Access Account',
  comment: 'Required to access an Account.'
};
permissions.ACCOUNT_INSERT = {
  id: 'ACCOUNT_INSERT',
  label: 'Insert Account',
  comment: 'Required to insert an Account.'
};
permissions.ACCOUNT_UPDATE = {
  id: 'ACCOUNT_UPDATE',
  label: 'Edit Account',
  comment: 'Required to update an Account.'
};
permissions.ACCOUNT_REMOVE = {
  id: 'ACCOUNT_REMOVE',
  label: 'Remove Account',
  comment: 'Required to remove an Account.'
};
