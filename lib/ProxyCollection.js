/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';

const {util: {BedrockError}} = bedrock;

export class ProxyCollection {
  constuctor({collectionName, dataField, uniqueField} = {}) {
    this.collectionName = collectionName;
    this.dataField = dataField;
    this.uniqueField = uniqueField;
  }

  async createIndexes() {
    const {collectionName, uniqueField} = this;
    const idField = this._getDataIdField();

    await database.openCollections([collectionName]);
    await database.createIndexes([{
      collection: collectionName,
      fields: {[uniqueField]: 1},
      options: {
        unique: true,
        background: false
      }
    }, {
      collection: collectionName,
      fields: {[idField]: 1},
      options: {
        unique: false,
        background: false
      }
    }]);
  }

  /**
   * Inserts a unique field + record ID mapping. A transaction ID may be
   * optionally set to allow the transaction to be rolled back.
   *
   * @param {object} options - The options to use.
   * @param {string} options.uniqueValue - The unique value.
   * @param {string} options.recordId - The record ID.
   * @param {string} [options.txnId] - The transaction ID.
   *
   * @returns {Promise<object>} Resolves to the database record.
   */
  async insert({uniqueValue, recordId, txnId} = {}) {
    assert.string(uniqueValue, 'uniqueValue');
    assert.string(recordId, 'recordId');
    assert.optionalString(txnId, 'txnId');

    // create the mapping record
    const {dataField, uniqueField} = this;
    const idField = this._getDataIdField();
    const record = {[uniqueField]: uniqueValue, [idField]: recordId};
    if(txnId) {
      record._txnId = txnId;
    }

    try {
      // insert the mapping
      const collection = this._getCollection();
      const result = await collection.insertOne(record);
      return result.ops[0];
    } catch(e) {
      if(!database.isDuplicateError(e)) {
        throw e;
      }
      // intentionally surface as a duplicate record error
      // (not just a duplicate mapping error)
      throw new BedrockError(`Duplicate ${dataField}.`, {
        name: 'DuplicateError',
        details: {
          [idField]: recordId, [uniqueField]: uniqueValue,
          public: true, httpStatusCode: 409
        },
        cause: e
      });
    }
  }

  /**
   * Gets a unique field + record ID mapping.
   *
   * @param {object} options - The options to use.
   * @param {string} options.recordId - The record ID for the mapping.
   * @param {string} [options.uniqueValue] - The unique value.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise<object | ExplainObject>} Resolves with the record that
   *   matches the query or an ExplainObject if `explain=true`.
   */
  async get({recordId, uniqueValue, explain = false} = {}) {
    assert.optionalString(uniqueValue, 'uniqueValue');
    assert.optionalString(recordId, 'recordId');
    if(recordId === undefined && uniqueValue === undefined) {
      throw new Error('One of "recordId" or "uniqueValue" is required.');
    }

    const {dataField, uniqueField} = this;
    const idField = this._getDataIdField();
    const collection = this._getCollection();
    const query = {};
    if(recordId !== undefined) {
      query[idField] = recordId;
    }
    if(uniqueValue !== undefined) {
      query[uniqueField] = uniqueValue;
    }
    const projection = {_id: 0, [uniqueField]: 1, [idField]: 1};

    if(explain) {
      // 'find().limit(1)' is used here because 'findOne()' doesn't return a
      // cursor which allows the use of the explain function
      const cursor = await collection.find(query, {projection}).limit(1);
      return cursor.explain('executionStats');
    }

    const record = await collection.findOne(query, {projection});
    if(!record) {
      const dataName = dataField[0].toUpperCase() + dataField.slice(1);
      throw new BedrockError(`${dataName} not found.`, {
        name: 'NotFoundError',
        details: {
          [uniqueField]: uniqueValue, httpStatusCode: 404, public: true
        }
      });
    }

    return record;
  }

  /**
   * Marks an existing mapping to be removed.
   *
   * @param {object} options - The options to use.
   * @param {string} options.recordId - The record ID for the mapping.
   * @param {string} options.txnId - The transaction ID.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on remove
   *   success or an ExplainObject if `explain=true`.
   */
  async prepareRemove({recordId, txnId, explain = false} = {}) {
    assert.string(recordId, 'recordId');
    assert.string(txnId, 'txnId');

    const idField = this._getDataIdField();
    const collection = this._getCollection();

    // only update mapping record if it has no existing transaction ID
    const query = {[idField]: recordId, _txnId: {$exist: false}};
    const update = {$set: {_txnId: txnId}};

    if(explain) {
      // 'find().limit(1)' is used here because 'updateOne()' doesn't return
      // a cursor which allows the use of the explain function
      const cursor = await collection.find(query).limit(1);
      return cursor.explain('executionStats');
    }

    const result = await collection.updateOne(query, update);
    return result.result.n > 0;
  }

  /**
   * Removes a mapping record. If it was previously prepared to be removed (it
   * was previously marked with a transaction ID), then a matching transaction
   * ID can be passed to gate the operation.
   *
   * @param {object} options - The options to use.
   * @param {string} options.uniqueValue - The unique value for the mapping.
   * @param {string} options.recordId - The record ID for the mapping.
   * @param {string} [options.txnId] - The transaction ID.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on remove
   *   success or an ExplainObject if `explain=true`.
   */
  async remove({uniqueValue, recordId, txnId, explain = false} = {}) {
    assert.string(uniqueValue, 'uniqueValue');
    assert.string(recordId, 'recordId');
    assert.optionalString(txnId, 'txnId');

    const {uniqueField} = this;
    const idField = this._getDataIdField();
    const collection = this._getCollection();
    const query = {[uniqueField]: uniqueValue, [idField]: recordId};
    if(txnId) {
      query._txnId = txnId;
    }

    if(explain) {
      // 'find().limit(1)' is used here because 'deleteOne()' doesn't return a
      // cursor which allows the use of the explain function
      const cursor = await collection.find(query).limit(1);
      return cursor.explain('executionStats');
    }

    const result = await collection.deleteOne(query);
    return result.result.n > 0;
  }

  /**
   * Rolls back the removal of a mapping by removing the transaction ID that
   * was used to mark the mapping record previously.
   *
   * @param {object} options - The options to use.
   * @param {string} options.recordId - The record ID for the mapping.
   * @param {string} options.txnId - The transaction ID.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on remove
   *   success or an ExplainObject if `explain=true`.
   */
  async rollbackRemove({recordId, txnId, explain = false} = {}) {
    assert.string(recordId, 'recordId');
    assert.string(txnId, 'txnId');

    const idField = this._getDataIdField();
    const collection = this._getCollection();

    // only update mapping record if it has no existing transaction ID
    const query = {[idField]: recordId, _txnId: txnId};
    const update = {$unset: {_txnId: ''}};

    if(explain) {
      // 'find().limit(1)' is used here because 'updateOne()' doesn't return
      // a cursor which allows the use of the explain function
      const cursor = await collection.find(query).limit(1);
      return cursor.explain('executionStats');
    }

    const result = await collection.updateOne(query, update);
    return result.result.n > 0;
  }

  _getCollection() {
    return database.collections[this.collectionName];
  }

  _getDataIdField() {
    return `${this.dataField}Id`;
  }
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */
