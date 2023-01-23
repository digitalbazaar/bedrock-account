/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';
import {ProxyCollection} from './ProxyCollection.js';
import {RecordCollectionHelper} from './RecordCollectionHelper.js';
import {RecordTransaction} from './RecordTransaction.js';
import {RecordTransactionProcessor} from './RecordTransactionProcessor.js';

export class RecordCollection {
  constructor({
    collectionName,
    dataField = collectionName,
    // `sequence` will be stored in the record data if `true` and will be
    // stored in the record meta data if `false`
    sequenceInData = true,
    uniqueFields = []
  } = {}) {
    this.collectionName = collectionName;
    this.dataField = dataField;
    this.sequenceInData = sequenceInData;
    this.helper = new RecordCollectionHelper({recordCollection: this});
    this.transactionProcessor = new RecordTransactionProcessor(
      {recordCollection: this});

    const proxyCollections = new Map();
    for(const uniqueField of uniqueFields) {
      proxyCollections.set(uniqueField, new ProxyCollection({
        collectionName: `${collectionName}-${uniqueField}`,
        dataField, uniqueField
      }));
    }
    this.proxyCollections = proxyCollections;
  }

  /**
   * Check for the existence of a record.
   *
   * @param {object} options - The options to use.
   * @param {string} [options.id] - The ID of the record to check.
   * @param {string} [options.uniqueField] - The name of the unique field.
   * @param {string} [options.uniqueValue] - The value of the unique field.
   *
   * @returns {Promise} Resolves to a boolean indicating record existence.
   */
  async exists({id, uniqueField, uniqueValue} = {}) {
    assert.optionalString(id, 'id');
    assert.optionalString(uniqueField, 'uniqueField');
    assert.optionalString(uniqueValue, 'uniqueValue');
    if(!(id !== undefined ||
      (uniqueField !== undefined && uniqueValue !== undefined))) {
      throw new Error(
        'Either "id" or "uniqueField" and "uniqueValue" are required.');
    }

    if(id !== undefined) {
      return this.helper.exists({id, uniqueField, uniqueValue});
    }

    const proxyCollection = this.proxyCollections.get(uniqueField);
    if(!proxyCollection) {
      // logic error; should not happen
      throw new Error(
        `Invalid field "${uniqueField}" used to check record existence.`);
    }
    try {
      await this._getProxyRecord({proxyCollection, uniqueValue});
      return true;
    } catch(e) {
      if(e.name === 'NotFoundError') {
        return false;
      }
      throw e;
    }
  }

  async initialize() {
    // concurrently create indexes for this collection and any proxies
    const proxyCollections = [...this.proxyCollections.values()];
    await Promise.all([
      this._createIndexes(),
      ...proxyCollections.map(pc => pc.createIndexes())
    ]);
  }

  /**
   * Inserts a new record. The record must contain a property named
   * `this.dataField` with a value with an `id` property.
   *
   * @param {object} options - The options to use.
   * @param {string} options.record - The record to insert.
   *
   * @returns {Promise<object>} Resolves to the database record.
   */
  async insert({record} = {}) {
    const {dataField} = this;
    const {id} = record?.[dataField];
    assert.string(id, `record.${dataField}.id`);

    // FIXME: disable this for now since it's not a use case, but add it back
    // as an optimization in the future; it needs to ensure any pending
    // transaction is processed if a duplicate error occurs
    /*
    // see if any fields that should be unique are set
    const keys = [...this.proxyCollections.keys()];
    const {[dataField]: data} = record;
    const applyUniqueConstraint = keys.some(k => data[k] !== undefined);
    if(!applyUniqueConstraint) {
      // no uniqueness constraints; insert record w/o transaction
      return this.helper.insert({record});
    }*/

    while(true) {
      try {
        // perform `insert` transaction
        const t = new RecordTransaction(
          {id, record, type: 'insert', recordCollection: this});
        await t.run();
        return record;
      } catch(e) {
        if(e.name !== 'AbortError') {
          // unrecoverable error
          throw e;
        }
      }
    }
  }

  /**
   * Retrieves a record by `id` or a unique field.
   *
   * @param {object} options - The options to use.
   * @param {string} [options.id] - The ID of the record to retrieve.
   * @param {string} [options.uniqueField] - The name of the unique field.
   * @param {string} [options.uniqueValue] - The value of the unique field.
   * @param {boolean} [options._allowPending=false] - For internal use only;
   *   allows finding records that are in the process of being created.
   *
   * @returns {Promise} - Returns a Promise that resolves to the data record
   *   (`{[dataField], meta}`).
   */
  async get({id, uniqueField, uniqueValue, _allowPending = false} = {}) {
    assert.optionalString(id, 'id');
    assert.optionalString(uniqueField, 'uniqueField');
    assert.optionalString(uniqueValue, 'uniqueValue');
    if(!(id !== undefined ||
      (uniqueField !== undefined && uniqueValue !== undefined))) {
      throw new Error(
        'Either "id" or "uniqueField" and "uniqueValue" are required.');
    }

    let proxyCollection;
    if(id === undefined) {
      // get proxy collection to use to get record ID
      proxyCollection = this.proxyCollections.get(uniqueField);
    }

    const {dataField, helper, transactionProcessor: tp} = this;
    const idField = `${dataField}Id`;
    while(true) {
      if(proxyCollection) {
        const proxyRecord = await this._getProxyRecord(
          {proxyCollection, uniqueValue});
        id = proxyRecord[idField];
      }

      // note that a `_pending` record is not retrieved during an `update` or
      // a default `get`; it will only be rolled back (if necessary) when
      // another attempt to insert or delete the record occurs
      const record = await helper.get(
        {id, uniqueField, uniqueValue, _allowPending});
      if(record._txn) {
        // process pending transaction with the record; if the transaction has
        // been committed, we can background the processing and return early
        const {committed} = record._txn;
        await tp.processPendingTransaction({record, throwError: !committed});
        // if transaction wasn't committed, loop to refresh the record
        if(!committed) {
          continue;
        }
      }
      return record;
    }
  }

  /**
   * Retrieves all records matching the given query.
   *
   * @param {object} options - The options to use.
   * @param {object} [options.query={}] - The query to use.
   * @param {object} [options.options={}] - The options (eg: 'sort', 'limit').
   * @param {boolean} [options._allowPending=false] - For internal use only;
   *   allows finding records that are in the process of being created.
   *
   * @returns {Promise} Resolves to the records that matched the query.
   */
  async getAll({query = {}, options = {}, _allowPending = false} = {}) {
    return this.helper.getAll(query, options, _allowPending);
  }

  /**
   * Updates a record by overwriting it with new data and / or `meta` data. In
   * all cases, the `sequence` must match the existing record. The `sequence`
   * field is either in `data` or `meta` depending on the `sequenceInData`
   * property of this collection. If `expectedSequence` is not given, then if
   * `sequence` is in the data, then `data` MUST be given, if it is in the meta
   * data then `meta` MUST be given. Either way, `data` or `meta` must be given.
   *
   * @param {object} options - The options to use.
   * @param {string} options.id - The ID of the record to update.
   * @param {object} [options.data] - The new data to use.
   * @param {object} [options.meta] - The new meta data to use.
   * @param {object} [options.expectedSequence] - The expected sequence (the
   *   sequence associated with the current record in the database, prior to
   *   this update).
   *
   * @returns {Promise} - Returns a Promise that resolves to `true` when the
   *   operation completes.
   */
  async update({id, data, meta, expectedSequence} = {}) {
    // do early validation of params
    this.helper.validateUpdateParams({id, data, meta, expectedSequence});

    // get keys for checking if any fields that should be unique are set
    const {dataField, proxyCollections} = this;
    const keys = [...proxyCollections.keys()];
    while(true) {
      try {
        // get record; treat any pending record as not found
        const record = await this.get({id});

        // see if any fields that should be unique will change
        const {[dataField]: existingData} = record;
        const applyUniqueConstraint = data && keys.some(
          k => data[k] !== existingData[k]);

        if(!applyUniqueConstraint) {
          // no transaction needed; do update w/o transaction
          if(!await this.helper.update({id, data, meta, expectedSequence})) {
            // update failed and did not produce an exception; this can only
            // occur with a concurrent transaction, loop to retry
            continue;
          }
          return true;
        }

        // perform `update` transaction
        const t = new RecordTransaction({
          id, record, data, meta, type: 'update', expectedSequence,
          recordCollection: this
        });
        await t.run();
        return true;
      } catch(e) {
        if(e.name !== 'AbortError') {
          // unrecoverable error
          throw e;
        }
      }
    }
  }

  /**
   * Deletes an existing record.
   *
   * @param {object} options - The options to use.
   * @param {string} options.id - The ID of the record to delete.
   *
   * @returns {Promise<boolean>} Resolves with `true` when the operation
   *   completes.
   */
  async delete({id} = {}) {
    assert.string(id, 'id');

    while(true) {
      try {
        // perform `delete` transaction
        const t = new RecordTransaction(
          {id, type: 'delete', recordCollection: this});
        await t.run();
        return true;
      } catch(e) {
        if(e.name !== 'AbortError') {
          // unrecoverable error
          throw e;
        }
      }
    }
  }

  getCollection() {
    return database.collections[this.collectionName];
  }

  async _createIndexes() {
    const {collectionName, dataField} = this;
    await database.openCollections([collectionName]);
    await database.createIndexes([{
      collection: collectionName,
      fields: {[`${dataField}.id`]: 1},
      options: {
        unique: true,
        background: false
      }
    }]);
  }

  async _getProxyRecord({proxyCollection, uniqueValue} = {}) {
    const {transactionProcessor: tp} = this;
    while(true) {
      const proxyRecord = await proxyCollection.get({uniqueValue});
      if(!proxyRecord._txn) {
        return proxyRecord;
      }

      // process any transaction associated with the proxy record
      const blockingProxyRecords = [{proxyCollection, proxyRecord}];
      // record could be different from the one identified by `id`
      const {id: recordId} = proxyRecord._txn;
      const result = await tp.processAnyPendingTransaction(
        {id: recordId, blockingProxyRecords});
      if(result.error && result.error.name !== 'AbortError') {
        // unrecoverable error
        throw result.error;
      }
      // loop to retry
      continue;
    }
  }
}
