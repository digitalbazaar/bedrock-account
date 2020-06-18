/*
 * Copyright (c) 2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const _ = require('lodash');
const assert = require('assert-plus');
const accountSchema = require('../schemas/bedrock-account')();
const bedrock = require('bedrock');
const {promisify} = require('util');
const brPermission = require('bedrock-permission');
const brPermissionCheck = promisify(brPermission.checkPermission);
const database = require('bedrock-mongodb');
const jsonpatch = require('fast-json-patch');
const {validateInstance} = require('bedrock-validation');
const {BedrockError} = bedrock.util;

// load config defaults
require('./config');

/**
 * @module bedrock-account
 */

// module permissions
const PERMISSIONS = bedrock.config.permission.permissions;

const logger = bedrock.loggers.get('app').child('bedrock-account');

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await promisify(database.openCollections)(['account']);

  await promisify(database.createIndexes)([{
    collection: 'account',
    fields: {id: 1},
    options: {unique: true, background: false}
  }, {
    // cover common queries
    collection: 'account',
    fields: {id: 1, 'meta.status': 1},
    options: {unique: true, background: false}
  }, {
    // `id` is a prefix to allow for sharding on `id` -- a collection
    // cannot be sharded unless its unique indexes have the shard key
    // as a prefix; a separate non-unique index is used for lookups
    collection: 'account',
    fields: {id: 1, 'account.email': 1, 'meta.status': 1},
    options: {
      partialFilterExpression: {'account.email': {$exists: true}},
      unique: true,
      background: false
    }
  }, {
    collection: 'account',
    fields: {'account.email': 1, 'meta.status': 1},
    options: {
      partialFilterExpression: {'account.email': {$exists: true}},
      unique: false,
      background: false
    }
  }]);
});

/**
 * Inserts a new Account. The Account must contain `id`.
 *
 * @param {object} options - The options to use.
 * @param {Actor} options.actor - The actor or capabilities for performing
 *   the action.
 * @param {object} options.account - The account containing at least the minimum
 *   required data.
 * @param {object} [options.meta] - The meta information to include.
 *
 * @returns {Promise} Resolves to the database account record.
 */
exports.insert = async ({actor, account, meta} = {}) => {
  assert.object(account, 'account');
  assert.string(account.id, 'account.id');
  assert.optionalString(account.email, 'account.email');
  assert.optionalString(account.phoneNumber, 'account.phoneNumber');

  meta = Object.assign({}, meta, {status: 'active'});
  // ensure resource roles are an array
  if(meta.sysResourceRole && !Array.isArray(meta.sysResourceRole)) {
    meta.sysResourceRole = [meta.sysResourceRole];
  }

  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_INSERT,
    resource: [account]
  });

  // emit `insertEvent` with clone of `account`
  account = bedrock.util.clone(account);
  const eventData = {
    actor,
    account,
    meta,
    // data to pass to `postInsert`, but do not insert into database
    postInsert: {
      /* <module-name>: <module-specific data> */
    }
  };
  await bedrock.events.emit('bedrock-account.insert', eventData);

  // replay assertions post event emission
  assert.object(account, 'account');
  assert.string(account.id, 'account.id');
  assert.string(meta.status, 'meta.status');
  assert.optionalString(account.email, 'account.email');
  assert.optionalString(account.phoneNumber, 'account.phoneNumber');

  // generate resource role resources
  const roles = meta.sysResourceRole = meta.sysResourceRole || [];
  for(let i = 0; i < roles.length; ++i) {
    const role = roles[i];
    if(role.generateResource === 'id') {
      roles[i] = exports.generateResource({role, id: account.id});
    } else if(role.generateResource) {
      // unknown generation directive
      throw new BedrockError(
        'Could not create Account; unknown ResourceRole rule.',
        'NotSupportedError', {sysResourceRole: role});
    }
  }

  logger.info('attempting to insert an account', {account});

  // insert the account and get the updated record
  const now = Date.now();
  meta.created = now;
  meta.updated = now;
  meta.sequence = 0;
  let record = {
    id: database.hash(account.id),
    meta,
    account
  };
  try {
    const result = await database.collections.account.insertOne(
      record, database.writeOptions);
    record = result.ops[0];
  } catch(e) {
    if(!database.isDuplicateError(e)) {
      throw e;
    }
    throw new BedrockError(
      'Duplicate account.',
      'DuplicateError', {
        public: true,
        httpStatusCode: 409
      }, e);
  }

  // emit `postInsert` event with updated record data
  eventData.account = bedrock.util.clone(record.account);
  eventData.meta = bedrock.util.clone(record.meta);
  await bedrock.events.emit('bedrock-account.postInsert', eventData);

  return record;
};

/**
 * Check for the existence of an account.
 *
 * @param {object} options - The options to use.
 * @param {Actor} options.actor - The actor or capabilities for performing
 *   the action.
 * @param {string} [options.id] - The ID of the account to check.
 * @param {string} [options.email] - The email address for the account.
 * @param {string} [options.status=active] - The status to check for
 *   (options: 'active', deleted').
 *
 * @returns {Promise} Resolves to a boolean indicating account existence.
 */
exports.exists = async ({
  actor, id, email, status = 'active'
} = {}) => {
  assert.optionalString(id, 'id');
  assert.optionalString(email, 'email');
  assert.string(status, 'status');
  if(!(id || email)) {
    throw new Error('Either "id" or "email" must be provided.');
  }

  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_ACCESS,
    resource: [id]
  });
  const query = {'meta.status': status};
  const projection = {_id: 0};
  if(id) {
    query.id = database.hash(id);
    projection.id = 1;
  }
  if(email) {
    query['account.email'] = email;
    projection['account.email'] = 1;
  }
  return !!await database.collections.account.findOne(query, projection);
};

/**
 * Retrieves an Account.
 *
 * @param {object} options - The options to use.
 * @param {Actor} options.actor - The actor or capabilities for performing
 *   the action.
 * @param {string} options.id - The ID of the Account to retrieve.
 *
 * @returns {Promise} Resolves to `{account, meta}`.
 */
exports.get = async ({actor, id} = {}) => {
  assert.string(id, 'account.id');

  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_ACCESS,
    resource: [id]
  });

  const record = await database.collections.account.findOne(
    {id: database.hash(id)}, {_id: 0, account: 1, meta: 1});
  if(!record) {
    throw new BedrockError(
      'Account not found.',
      'NotFoundError',
      {id, httpStatusCode: 404, public: true});
  }

  brPermission.expandRoles(record.meta.sysResourceRole);

  return record;
};

/**
 * Retrieves all Accounts matching the given query.
 *
 * @param {object} options - The options to use.
 * @param {Actor} options.actor - The actor or capabilities for performing
 *   the action.
 * @param {object} [options.query={}] - The query to use.
 * @param {object} [options.fields=undefined] - The fields to include or
 *   exclude.
 * @param {object} [options.options={}] - The options (eg: 'sort', 'limit').
 *
 * @returns {Promise} Resolves to the records that matched the query.
 */
exports.getAll = async ({
  actor, query = {}, fields, options = {}
} = {}) => {
  // TODO: move permission check to after query to allow users with
  // more granular permissions to use this function
  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_ACCESS
  });
  if(fields && options.projection) {
    throw new TypeError(
      '"fields" or "options.projection" must be given, not both.');
  }
  // FIXME remove options.fields from all libraries that call on bedrock-account
  // instead use options.projection
  options.projection = options.projection || fields;
  const records = await database.collections.account.find(
    query, options).toArray();

  for(const record of records) {
    if(record.meta) {
      brPermission.expandRoles(record.meta.sysResourceRole);
    }
  }

  return records;
};

/**
 * Updates an Account.
 *
 * @param {object} options - The options to use.
 * @param {Actor} options.actor - The actor or capabilities to perform the
 *   action.
 * @param {string} options.id - The ID of the account to update.
 * @param {Array} options.patch - A JSON patch for performing the update.
 * @param {number} options.sequence - The sequence number that must match the
 *   current record prior to the patch.
 *
 * @returns {Promise} Resolves once the operation completes.
 */
exports.update = async ({actor, id, patch, sequence} = {}) => {
  assert.string(id, 'id');
  assert.array(patch, 'patch');
  assert.number(sequence, 'sequence');

  if(sequence < 0) {
    throw new TypeError('"sequence" must be a non-negative integer.');
  }

  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_UPDATE,
    resource: [id]
  });

  const record = await exports.get({actor, id});

  if(record.meta.sequence !== sequence) {
    throw new BedrockError(
      'Could not update Account. Record sequence does not match.',
      'InvalidStateError', {
        httpStatusCode: 409,
        public: true,
        actual: sequence,
        expected: record.meta.sequence
      });
  }
  const customValidate = (operation, index, tree, existingPath) => {
    jsonpatch.validator(operation, index, tree, existingPath);
    const pathId = /^\/id$/i.test(existingPath);
    if(pathId) {
      throw new jsonpatch.JsonPatchError(
        '"id" cannot be changed',
        'OPERATION_OP_INVALID',
        index, operation, tree);
    }
  };
  const errors = jsonpatch.validate(patch, record.account, customValidate);
  if(errors) {
    throw new BedrockError(
      'The given JSON patch is invalid.',
      'ValidationError', {
        httpStatusCode: 400,
        public: true,
        patch,
        errors
      });
  }

  // apply patch and validate result
  const patched = jsonpatch.applyPatch(record.account, patch).newDocument;
  const validationResult = validateInstance(patched, accountSchema);
  if(!validationResult.valid) {
    throw validationResult.error;
  }

  const result = await database.collections.account.updateOne({
    id: database.hash(id),
    'meta.sequence': sequence
  }, {
    $set: {account: patched},
    $inc: {'meta.sequence': 1}
  }, database.writeOptions);

  if(result.result.n === 0) {
    return new BedrockError(
      'Could not update Account. Record sequence does not match.',
      'InvalidStateError', {httpStatusCode: 409, public: true});
  }
};

/**
 * Sets an Account's status.
 *
 * @param {object} options - The options to use.
 * @param {Actor} options.actor - The actor or capabilities to perform
 *   the action.
 * @param {string} options.id - The Account ID.
 * @param {string} options.status - The status.
 *
 * @returns {Promise} Resolves once the operation completes.
 */
exports.setStatus = async ({actor, id, status} = {}) => {
  assert.string(id, 'id');
  assert.string(status, 'status');

  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_META_UPDATE,
    resource: [id]
  });

  const result = await database.collections.account.updateOne(
    {id: database.hash(id)}, {
      $set: {'meta.status': status},
      $inc: {'meta.sequence': 1}
    }, database.writeOptions);

  if(result.result.n === 0) {
    throw new BedrockError(
      'Could not set Account status. Account not found.',
      'NotFoundError',
      {httpStatusCode: 404, account: id, public: true});
  }
};

/**
 * Sets the Account's ResourceRoles from the given resource roles arrays.
 *
 * @param {object} options - The options to use.
 * @param {Actor} options.actor - The actor or capabilities to perform
 *   the action.
 * @param {string} options.id - The ID of the Account that is to be updated.
 * @param {Array} [options.add=[]] - The resourceRoles to add.
 * @param {Array} [options.remove=[]] - The resourceRoles to remove.
 * @param {number} options.sequence - The sequence number that must match the
 * current record prior to the patch.
 * @returns {Promise} Resolves once the operation completes.
 */
exports.updateRoles = async ({
  actor, id, add = [], remove = [], sequence
} = {}) => {
  assert.string(id, 'id');
  assert.array(add, 'add');
  assert.array(remove, 'remove');
  assert.number(sequence);

  if(sequence < 0) {
    throw new TypeError('"sequence" must be a non-negative integer.');
  }

  // get account record and check its sequence number
  const {account, meta} = await exports.get({actor: null, id});
  if(meta.sequence !== sequence) {
    return new BedrockError(
      'Could not update Account. Record sequence does not match.',
      'InvalidStateError', {
        httpStatusCode: 409,
        public: true,
        actual: sequence,
        expected: meta.sequence
      });
  }

  // actor must have the meta update capability for the account to make
  // any capability changes whatsoever
  // Note: **WARNING** this implementation means that any actor with the
  // ability to authenticate as the account to which they can bestow any
  // capability is essentially an admin
  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_META_UPDATE,
    resource: [account]
  });

  // generate resource role resources
  add = bedrock.util.clone(add);
  remove = bedrock.util.clone(remove);
  const changes = add.concat(remove);
  for(const role of changes) {
    if(role.generateResource === 'id') {
      // append identity `id` to the given resource list,
      // if it doesn't already exist
      if(!role.resource) {
        role.resource = [id];
      } else if(role.resource.indexOf(id) === -1) {
        role.resource.push(id);
      }
      delete role.generateResource;
    } else if(role.generateResource) {
      // unknown resource generation rule
      throw new BedrockError(
        'Could not set roles; unknown ResourceRole rule.',
        'NotSupportedError', {sysResourceRole: role});
    }
  }

  // 1. remove specified resource roles
  // 2. add specified resource roles
  // 3. ensure resource roles are unique
  const resourceRoles = _.uniqWith(
    brPermission.mergeCapabilities(
      brPermission.subtractCapabilities(meta.sysResourceRole, remove),
      add),
    _.isEqual);

  await database.collections.account.updateOne(
    {id: database.hash(id)}, {
      $set: {'meta.sysResourceRole': resourceRoles},
      $inc: {'meta.sequence': 1}
    }, database.writeOptions);
};

/**
 * Gets the capabilities for a given account.
 *
 * @param {object} options - The options to use.
 * @param {string} options.id - The ID of the Account to get the capabilities
 *   for.
 *
 * @returns {Promise} Resolves to an `actor` once the operation completes.
 */
exports.getCapabilities = async ({id} = {}) => {
  assert.string(id, 'id');

  const record = await database.collections.account.findOne(
    {id: database.hash(id)}, {_id: 0, 'meta.sysResourceRole': 1});
  const resourceRoles = record ? record.meta.sysResourceRole : [];
  const actor = {
    // TODO: deprecate use of `id` here?
    id,
    sysResourceRole: resourceRoles
  };
  brPermission.expandRoles(actor.sysResourceRole);

  return actor;
};

/**
 * Inserts a specified ID into a role's resource restriction array. The given
 * role is copied and the given ID is inserted into the new role's resource
 * restriction array.
 *
 * @param {object} options - The options to use.
 * @param {object} options.role - The role to transform.
 * @param {string} options.id - The ID to insert into the resource array.
 *
 * @returns {object} The transformed role.
 */
exports.generateResource = ({role, id} = {}) => {
  assert.string(id, 'id');
  assert.object(role, 'role');

  role = bedrock.util.clone(role);
  if(!role.resource) {
    role.resource = [id];
  } else if(role.resource.indexOf(id) === -1) {
    role.resource.push(id);
  }
  delete role.generateResource;
  return role;
};

/**
 * Checks to see if an actor has been granted a permission to some resource.
 * This method is a passthrough to the permission module's `checkPermission`
 * call, but, if necessary, it can look up an actor's `sysResourceRole` using
 * its `id`, prior to calling it.
 *
 * This method should NOT be exposed publicly as that would encourage breakage
 * of the permission model and the potential for moving to an object capability
 * model in the future.
 *
 * @ignore
 * @param {object} options - The options to use.
 * @param {Actor} options.actor - The actor or capabilities to
 *   perform the action, if null is given, permission will be granted.
 * @param {string} options.permission - The permission to check.
 * @param {Array} [options.resource] - Resources to check against the
 *   permission.
 * @param {Function|string} [options.translate] - A translation function
 *  (or string identifying a built-in function) to translate resource IDs in
 *  some fashion prior to checking permissions.
 *
 * @returns {Promise} Resolves once the operation completes.
 */
async function _checkPermission({
  actor, permission, resource, translate
} = {}) {
  const options = {};
  if(resource) {
    options.resource = resource;
  }
  if(translate) {
    options.translate = translate;
  }

  // if actor can be passed immediately, do so
  if(typeof actor === 'undefined' || actor === null ||
    actor.sysResourceRole || actor.sysPermissionTable) {
    return brPermissionCheck(actor, permission, options);
  }

  // TODO: deprecate auto-retrieving capabilities, require devs to call
  // `getCapabilities` to create an `actor`

  // get actor's capabilities (via resource roles) if it has an `id` that
  // is an account
  if(actor.id) {
    try {
      const newActor = await exports.getCapabilities({id: actor.id});
      actor.sysResourceRole = newActor.sysResourceRole;
    } catch(e) {}
  }

  return brPermissionCheck(actor, permission, options);
}

/**
 * An Actor may be an Object, undefined or null.
 *
 * @typedef Actor
 * @type {object|null|undefined}
 */
