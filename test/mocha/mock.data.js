/*
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
/* jshint node: true */

'use strict';

const helpers = require('./helpers');

const data = {};
module.exports = data;

const accounts = data.accounts = {};
let email;

email = 'will-be-deleted@example.com';
accounts[email] = {};
accounts[email].account = helpers.createAccount(email);
accounts[email].meta = {};

email = 'alpha@example.com';
accounts[email] = {};
accounts[email].account = helpers.createAccount(email);
accounts[email].meta = {};
