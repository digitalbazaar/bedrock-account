/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';

const {util: {BedrockError}} = bedrock;

export class ProxyCollection {
  constructor({collectionName, dataField, uniqueField} = {}) {
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
    }, {
      collection: collectionName,
      fields: {'_txn.id': 1},
      options: {
        partialFilterExpression: {'_txn.id': {$exists: true}},
        unique: false,
        background: false
      }
    }]);
  }

  /**
   * Inserts a unique field + record ID mapping. A transaction may be
   * optionally set to allow the transaction to be rolled back.
   *
   * @param {object} options - The options to use.
   * @param {string} options.uniqueValue - The unique value.
   * @param {string} options.recordId - The record ID.
   * @param {object} options.txn - The insert transaction.
   *
   * @returns {Promise<object>} Resolves to the database record.
   */
  async insert({uniqueValue, recordId, txn} = {}) {
    assert.string(uniqueValue, 'uniqueValue');
    assert.string(recordId, 'recordId');
    assert.object(txn, 'txn');

    // create the mapping record
    const {dataField, uniqueField} = this;
    const idField = this._getDataIdField();
    const record = {
      [uniqueField]: uniqueValue,
      [idField]: recordId,
      _txn: {...txn, op: 'insert'}
    };

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
          recordId,
          [dataField]: recordId,
          uniqueField,
          uniqueValue,
          httpStatusCode: 409,
          public: true
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
   * Marks an existing mapping to be deleted.
   *
   * @param {object} options - The options to use.
   * @param {string} options.recordId - The record ID for the mapping.
   * @param {object} options.txn - The transaction.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on delete
   *   success or an ExplainObject if `explain=true`.
   */
  async prepareDelete({recordId, txn, explain = false} = {}) {
    assert.string(recordId, 'recordId');
    assert.object(txn, 'txn');

    const idField = this._getDataIdField();
    const collection = this._getCollection();

    // only update mapping record if it has no existing transaction ID
    const query = {[idField]: recordId, '_txn.id': {$exists: false}};
    const update = {$set: {_txn: {...txn, op: 'delete'}}};

    if(explain) {
      // 'find().limit(1)' is used here because 'updateOne()' doesn't return
      // a cursor which allows the use of the explain function
      const cursor = await collection.find(query).limit(1);
      return cursor.explain('executionStats');
    }

    const result = await collection.updateOne(query, update);
    return result.result.n > 0;
  }

  // FIXME: remove `delete` call; must be performed through a transaction
  /**
   * Deletes a mapping record. If it was previously prepared to be deleted (it
   * was previously marked with a transaction ID), then a matching transaction
   * ID can be passed to gate the operation.
   *
   * @param {object} options - The options to use.
   * @param {string} options.uniqueValue - The unique value for the mapping.
   * @param {string} options.recordId - The record ID for the mapping.
   * @param {string} [options.txnId] - The transaction ID.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on delete
   *   success or an ExplainObject if `explain=true`.
   */
  async delete({uniqueValue, recordId, txnId, explain = false} = {}) {
    assert.string(uniqueValue, 'uniqueValue');
    assert.string(recordId, 'recordId');
    assert.optionalString(txnId, 'txnId');

    const {uniqueField} = this;
    const idField = this._getDataIdField();
    const collection = this._getCollection();
    const query = {[uniqueField]: uniqueValue, [idField]: recordId};
    if(txnId) {
      query['_txn.id'] = txnId;
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
   * Rolls back any mapping record changes that had been marked with the
   * given transaction ID. Any matching record marked with an insert operation
   * will be deleted and any matching record marked with a delete operation
   * will no longer be marked as such.
   *
   * @param {object} options - The options to use.
   * @param {string} options.txnId - The transaction ID.
   * @param {string} [options.newValue] - The optional new unique value
   *   associated with the change.
   * @param {string} [options.oldValue] - The optional new unique value
   *   associated with the change.
   *
   * @returns {Promise} Resolves once the operation completes.
   */
  async rollbackChange({txnId, newValue, oldValue} = {}) {
    assert.string(txnId, 'txnId');
    assert.optionalString(newValue, 'newValue');
    assert.optionalString(oldValue, 'oldValue');
    const results = await Promise.allSettled([
      this._rollbackInsert({txnId, uniqueValue: newValue}),
      this._rollbackDelete({txnId, uniqueValue: oldValue})
    ]);
    this._throwAnyRejection({results});
  }

  /**
   * Completes any mapping record changes that had been marked with the
   * given transaction ID. Any matching record marked with an insert operation
   * will have its transaction tracking removed and any matching record marked
   * with a delete operation will be deleted.
   *
   * @param {object} options - The options to use.
   * @param {string} options.txnId - The transaction ID.
   * @param {string} [options.newValue] - The optional new unique value
   *   associated with the change.
   * @param {string} [options.oldValue] - The optional new unique value
   *   associated with the change.
   *
   * @returns {Promise} Resolves once the operation completes.
   */
  async completeChange({txnId, newValue, oldValue} = {}) {
    assert.string(txnId, 'txnId');
    assert.optionalString(newValue, 'newValue');
    assert.optionalString(oldValue, 'oldValue');
    const results = await Promise.allSettled([
      this._completeInsert({txnId, uniqueValue: newValue}),
      this._completeDelete({txnId, uniqueValue: oldValue})
    ]);
    this._throwAnyRejection({results});
  }

  _getCollection() {
    return database.collections[this.collectionName];
  }

  _getDataIdField() {
    return `${this.dataField}Id`;
  }

  async _completeInsert({txnId, uniqueValue} = {}) {
    const {uniqueField} = this;
    const collection = this._getCollection();
    const query = {'_txn.id': txnId, '_txn.op': 'insert'};
    const update = {$unset: {_txn: ''}};
    if(uniqueValue !== undefined) {
      query[uniqueField] = uniqueValue;
    }
    console.log('COMPLETING with update', query);
    await collection.updateOne(query, update);
  }

  async _completeDelete({txnId, uniqueValue} = {}) {
    const {uniqueField} = this;
    const collection = this._getCollection();
    const query = {'_txn.id': txnId, '_txn.op': 'delete'};
    if(uniqueValue !== undefined) {
      query[uniqueField] = uniqueValue;
    }
    console.log('COMPLETING with delete', query);
    await collection.deleteOne(query);
  }

  async _rollbackInsert({txnId, uniqueValue} = {}) {
    const {uniqueField} = this;
    const collection = this._getCollection();
    const query = {'_txn.id': txnId, '_txn.op': 'insert'};
    if(uniqueValue !== undefined) {
      query[uniqueField] = uniqueValue;
    }
    await collection.deleteOne(query);
  }

  async _rollbackDelete({txnId, uniqueValue} = {}) {
    const {uniqueField} = this;
    const collection = this._getCollection();
    const query = {'_txn.id': txnId, '_txn.op': 'delete'};
    if(uniqueValue !== undefined) {
      query[uniqueField] = uniqueValue;
    }
    const update = {$unset: {_txn: ''}};
    await collection.updateOne(query, update);
  }

  _throwAnyRejection({results} = {}) {
    // throw any error that occurred
    const rejected = results.find(({status}) => status === 'rejected');
    if(rejected) {
      throw rejected.reason;
    }
  }
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */
