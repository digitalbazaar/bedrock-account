/*
 * Copyright (c) 2018 Digital Bazaar, Inc. All rights reserved.
 */
const assert = require('assert-plus');
const accountSchema = require('../schemas/bedrock-account');
const bedrock = require('bedrock');
const {config} = bedrock;
const {callbackify: brCallbackify} = bedrock.util;
const brIdentity = require('bedrock-identity');
const brPermission = require('bedrock-permission');
const {promisify} = require('util');
const brPermissionCheck = promisify(brPermission.checkPermission);
const database = require('bedrock-mongodb');
const jsonpatch = require('fast-json-patch');
const validateCapabilityDelegation = promisify(
  brIdentity.validateCapabilityDelegation);
const brValidation = require('bedrock-validation');
const validateInstance = promisify(brValidation.validateInstance);
const {BedrockError} = bedrock.util;

// load config defaults
require('./config');

// module permissions
const PERMISSIONS = bedrock.config.permission.permissions;

// module API
const api = {};
module.exports = api;

const logger = bedrock.loggers.get('app').child('bedrock-account');

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await promisify(database.openCollections)(['account', 'identity']);

  await promisify(database.createIndexes)([{
    collection: 'account',
    fields: {id: 1},
    options: {unique: true, background: false}
  }, {
    // `id` is a prefix to allow for sharding on `id` -- a collection
    // cannot be sharded unless its unique indexes have the shard key
    // as a prefix; a separate non-unique index is used for lookups
    collection: 'account',
    fields: {id: 1, 'account.email': 1},
    options: {
      partialFilterExpression: {'account.email': {$exists: true}},
      unique: true,
      background: false
    }
  }, {
    collection: 'account',
    fields: {'account.email': 1},
    options: {
      partialFilterExpression: {'account.email': {$exists: true}},
      unique: false,
      background: false
    }
  }, {
    // Note: Add index for identity management
    // `id` is a prefix to allow for sharding on `id` -- a collection
    // cannot be sharded unless its unique indexes have the shard key
    // as a prefix; a separate non-unique index is used for lookups
    collection: 'identity',
    fields: {id: 1, 'meta.bedrock-account.account': 1},
    options: {
      partialFilterExpression: {
        'meta.bedrock-account.account': {$exists: true}
      },
      unique: true,
      background: false
    }
  }, {
    // Note: Add index for identity management
    collection: 'identity',
    fields: {'meta.bedrock-account.account': 1},
    options: {
      partialFilterExpression: {
        'meta.bedrock-account.account': {$exists: true}
      },
      unique: false,
      background: false
    }
  }]);
});

/**
 * Check for the existence of an account.
 *
 * @param actor the actor or capabilities for performing the action.
 * @param [id] the ID of the account to check.
 * @param [email] the email address for the account.
 * @param [deleted] true to check accounts marked as deleted.
 *
 * @return a Promise that resolves to a boolean indicating account existence.
 */
api.exists = brCallbackify(async ({actor, id, email, deleted = false}) => {
  assert.optionalString(id, 'id');
  assert.optionalString(email, 'email');
  if(!(id || email)) {
    throw new Error('Either "id" or "email" must be provided.');
  }

  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_ACCESS,
    resource: [id]
  });
  const query = {'meta.status': deleted ? 'deleted' : 'active'};
  const projection = {};
  if(id) {
    query.id = database.hash(id);
    projection.id = 1;
  }
  if(email) {
    query['account.email'] = email;
    projection['account.email'] = 1;
  }
  return !!await database.collections.account.findOne(query, projection);
});

/**
 * Inserts a new Account. The Account must contain `id`.
 *
 * @param actor the actor or capabilities for performing the action.
 * @param account the Account containing at least the minimum required data.
 *
 * @return a Promise that resolves to the database account record.
 */
api.insert = brCallbackify(async ({actor, account}) => {
  assert.object(account, 'account');
  assert.string(account.id, 'account.id');
  assert.optionalString(account.email, 'account.email');
  assert.optionalString(account.phoneNumber, 'account.phoneNumber');

  const meta = {status: 'active'};

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
      roles[i] = api.generateResource({role, id: account.id});
    } else if(role.generateResource) {
      // unknown generation directive
      throw new BedrockError(
        'Could not create Account; unknown ResourceRole rule.',
        'InvalidResourceRole', {sysResourceRole: role});
    }
  }

  // validate resource roles (ensure actor is permitted to delegate the
  // roles specified in the account meta)
  if(meta.sysResourceRole) {
    await validateCapabilityDelegation(
      {actor, resourceRoles: meta.sysResourceRole});
  }

  logger.info('inserting account', {account});

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
  const result = await database.collections.account.insert(
    record, database.writeOptions);
  record = result.ops[0];

  // emit `postInsert` event with updated record data
  eventData.account = bedrock.util.clone(record.account);
  eventData.meta = bedrock.util.clone(record.meta);
  await bedrock.events.emit('bedrock-identity.postInsert', eventData);

  return record;
});

/**
 * Retrieves an Account.
 *
* @param actor the actor or capabilities for performing the action.
 * @param id the ID of the Account to retrieve.
 *
 * @return a Promise that resolves to `{account, meta}`.
 */
api.get = brCallbackify(async ({actor, id}) => {
  assert.string(id, 'account.id');

  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_ACCESS,
    resource: [id]
  });

  const record = await database.collections.account.findOne(
      {id: database.hash(id)}, {account: 1, meta: 1});
  if(!record) {
    throw new BedrockError(
      'Account not found.',
      'NotFound',
      {id: id, httpStatusCode: 404, public: true});
  }

  _expandRoles(record.meta.sysResourceRole);

  return record;
});

/**
 * Retrieves all Accounts matching the given query.
 *
 * @param actor the actor or capabilities for performing the action.
 * @param [query] the optional query to use (default: {}).
 * @param [fields] optional fields to include or exclude (default: {}).
 * @param [options] options (eg: 'sort', 'limit').
 *
 * @return a Promise that resolves to the records that matched the query.
 */
api.getAll = brCallbackify(async (
  {actor, query = {}, fields = {}, options = {}}) => {
  // TODO: move permission check to after query to allow users with
  // more granular permissions to use this function
  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_ACCESS
  });

  const records = await database.collections.account.find(
    query, fields, options).toArray();

  for(const record of records) {
    if(record.meta) {
      _expandRoles(record.meta.sysResourceRole);
    }
  }

  return records;
});

/**
 * Updates an Account.
 *
 * @param actor the actor or capabilities to perform the action.
 * @param id the ID of the account to update.
 * @param patch a JSON patch for performing the update.
 * @param sequence the sequence number that must match the current record,
 *          prior to the patch.
 *
 * @return a Promise that resolves once the operation completes.
 */
api.update = brCallbackify(async ({actor, id, patch, sequence}) => {
  assert.string(id, 'id');
  assert.array(patch, 'patch');
  assert.number(sequence, 'sequence');

  if(sequence < 0) {
    throw new TypeError('"sequence" must be a positive integer.');
  }

  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_UPDATE,
    resource: [id]
  });

  const record = await api.get({actor, id});

  if(record.meta.sequence !== sequence) {
    return new BedrockError(
      'Could not update Account. Account sequence does not match.',
      'InvalidStateError', {httpStatusCode: 409, public: true});
  }

  const errors = jsonpatch.validate(patch, record.account);
  if(errors) {
    throw new BedrockError(
      'The given JSON patch is invalid.', 'ValidationError', {
        httpStatusCode: 400,
        public: true,
        patch,
        errors
      });
  }

  // apply patch and validate result
  const patched = jsonpatch.applyPatch(record.account, patch).newDocument;
  await validateInstance(patched, accountSchema, patched);

  const result = await database.collections.account.update({
    id: database.hash(id),
    'meta.sequence': sequence
  }, {
    $set: {account: patched}
  }, database.writeOptions);

  if(result.result.n === 0) {
    return new BedrockError(
      'Could not update Account. Account sequence does not match.',
      'InvalidStateError', {httpStatusCode: 409, public: true});
  }
});

/**
 * Sets an Account's status.
 *
 * @param actor the actor or capabilities to perform the action.
 * @param id the Account ID.
 * @param status the status.
 *
 * @return a Promise that resolves once the operation completes.
 */
api.setStatus = brCallbackify(async ({actor, id, status}) => {
  assert.string(id, 'id');
  assert.string(status, 'status');

  await _checkPermission({
    actor,
    permission: PERMISSIONS.ACCOUNT_META_UPDATE,
    resource: [id]
  });

  const result = await database.collections.account.update(
    {id: database.hash(id)},
    {$set: {'meta.status': status}},
    database.writeOptions);

  if(result.result.n === 0) {
    throw new BedrockError(
      'Could not set Account status. Account not found.',
      'NotFound',
      {httpStatusCode: 404, account: id, public: true});
  }
});

/**
 * Sets the Account's ResourceRoles from the given resource roles array.
 *
 * @param actor the actor or capabilities to perform the action.
 * @param id the ID of the Account that is to be updated.
 * @param roles the resource roles array to use.
 *
 * @return a Promise that resolves once the operation completes.
 */
api.setRoles = brCallbackify(async ({actor, id, resourceRoles}) => {
  assert.string(id, 'id');
  assert.array(resourceRoles, 'resourceRoles');

  // determine if the actor is an administrator for this account
  let isAdmin = false;
  try {
    await _checkPermission({
      actor,
      permission: PERMISSIONS.ACCOUNT_META_UPDATE,
      resource: [id]
    });
    isAdmin = true;
  } catch(e) {}

  if(!isAdmin) {
    // since actor is not an admin, ensure actor is permitted to delegate
    // whatever capabilities arise from the passed `resourceRoles`
    await validateCapabilityDelegation({actor, resourceRoles});
  }

  // generate resource role resources
  for(const role of resourceRoles) {
    if(role.generateResource === 'id') {
      // append account `id` to the given resource list,
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
        'Could not set roles.',
        'NotSupportedError', {sysResourceRole: role});
    }
  }
  await database.collections.account.update(
    {id: database.hash(id)},
    {$set: {'meta.sysResourceRole': resourceRoles}},
    database.writeOptions);
});

/**
 * Gets the capabilities for a given account.
 *
 * @param id the ID of the Account to get the capabilities for.
 * @param [identities] the optional set of identity IDs to restrict
 *          capabitilies to; if unspecified, all identity capabilities
 *          will be included.
 *
 * @return a Promise that resolves to an `actor` once the operation completes.
 */
api.getCapabilities = brCallbackify(async ({id, identities}) => {
  assert.optionalArray(identities, 'identities');
  if(identities) {
    identities.forEach((x, i) => assert.string(x, `identities[${i}]`));
  }

  const record = await database.collections.account.findOne(
    {id: database.hash(id)}, {'meta.sysResourceRole': 1});

  if(!record) {
    record.meta.sysResourceRole = [];
  }

  // get capabilities for all identities this account controls
  const query = {'meta.bedrock-account.account': id};
  if(identities) {
    const hashes = identities.map(x => database.hash(x));
    query.id = {$in: hashes};
  }
  const records = await database.collections.identity.find(
    query, {'identity.sysResourceRole': 1}).toArray();

  const actor = {
    // TODO: deprecate use of `id` here?
    id,
    sysResourceRole: record.meta.sysResourceRole
  };
  records
    .map(x => x.identity.sysResourceRole)
    .forEach(x => actor.sysResourceRole.push(...x));
  _expandRoles(actor.sysResourceRole);

  return actor;
});

/**
 * Inserts a specified ID into a role's resource restriction array. The given
 * role is copied and the given ID is inserted into the new role's resource
 * restriction array.
 *
 * @param role the role to transform.
 * @param id the ID to insert into the resource array.
 *
 * @return role the transformed role.
 */
api.generateResource = ({role, id}) => {
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
 * Assumes management over the given identity.
 *
 * **Note** This method requires the capability to update *the identity*. This
 * means that the actor must have authenticated as that identity (i.e. `actor`
 * must include the capability to update the identity).
 *
 * @param actor the actor or capabilities to perform the action.
 * @param accountId the ID of the account to make the manager of an identity.
 * @param identityId the ID of the identity to manage.
 *
 * @return a Promise that resolves once the operation completes.
 */
api.manageIdentity = brCallbackify(async ({actor, accountId, identityId}) => {
  assert.string(accountId, 'accountId');
  assert.string(identityId, 'identityId');

  await _checkPermission({
    actor,
    permission: PERMISSIONS.IDENTITY_EDIT,
    resource: [identityId]
  });

  const result = await database.collections.identity.update(
    {id: database.hash(identityId)},
    {$set: {'meta.bedrock-account.account': accountId}},
    database.writeOptions);

  if(result.result.n === 0) {
    throw new BedrockError(
      'Could not set Account as manager of Identity. Identity not found.',
      'NotFound', {
        httpStatusCode: 404,
        identity: identityId,
        account: accountId,
        public: true
      });
  }
});

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
 * @param actor the actor or capabilities to perform the action, if null is
 *          given, permission will be granted.
 * @param permission the permission to check.
 * @param [resource] an optional array of resources to check against the
 *          permission.
 *
 * @return a Promise that resolves once the operation completes.
 */
async function _checkPermission({actor, permission, resource}) {
  const options = {};
  if(resource) {
    options.resource = resource;
  }

  // if actor can be passed immediately, do so
  if(typeof actor === 'undefined' || actor === null ||
    actor.sysResourceRole || actor.sysPermissionTable) {
    return brPermissionCheck(actor, permission, options);
  }

  // get actor's capabilities (via resource roles)
  const newActor = await api.getCapabilities({id: actor.id});
  actor.sysResourceRole = newActor.sysResourceRole;

  brPermissionCheck(actor, permission, options);
};

/**
 * Expands the given resource roles to URLs as needed.
 *
 * @param resourceRoles the resource roles to operate on.
 */
function _expandRoles(resourceRoles) {
  if(!(config.permission.roleBaseUrl.length !== 0 && resourceRoles)) {
    return;
  }

  for(const role of resourceRoles) {
    if(role.sysRole.indexOf(':') !== -1) {
      continue;
    }
    role.sysRole = config.permission.roleBaseUrl + '/' +
      encodeURIComponent(role.sysRole);
  }
}
