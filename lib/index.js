/*
 * Copyright (c) 2018 Digital Bazaar, Inc. All rights reserved.
 */
const bedrock = require('bedrock');
const config = bedrock.config;
const brPermission = require('bedrock-permission');
const database = require('bedrock-mongodb');
const BedrockError = bedrock.util.BedrockError;

// load config defaults
require('./config');

// module permissions
const PERMISSIONS = bedrock.config.permission.permissions;

// module API
const api = {};
module.exports = api;

const logger = bedrock.loggers.get('app');

bedrock.events.on('bedrock-mongodb.ready', function init(callback) {
  async.auto({
    openCollections: function(callback) {
      database.openCollections(['account'], callback);
    },
    createIndexes: ['openCollections', function(callback) {
      database.createIndexes([{
        collection: 'account',
        fields: {id: 1},
        options: {unique: true, background: false}
      }, {
        // `id` is a prefix to allow for sharding on `id` -- a collection
        // cannot be sharded unless its unique indexes have the shard key
        // as a prefix; a separate non-unique index is used for lookups
        collection: 'account',
        fields: {id: 1, email: 1},
        options: {
          partialFilterExpression: {email: {$exists: true}},
          unique: true,
          background: false
        }
      }, {
        collection: 'account',
        fields: {email: 1},
        options: {
          partialFilterExpression: {email: {$exists: true}},
          unique: false,
          background: false
        }
      }], callback);
    }]
  }, function(err) {
    callback(err);
  });
});
