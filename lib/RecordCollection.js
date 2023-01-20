/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';
import {logger} from './logger.js';
import {RecordCollectionHelper} from './RecordCollectionHelper.js';
import {v4 as uuid} from 'uuid';

const {util: {BedrockError}} = bedrock;

export class RecordCollection {
  constuctor({
    collectionName, dataField,
    // `sequence` will be stored in the record data if `true` and will be
    // stored in the record meta data if `false`
    sequenceInData = true,
    proxyCollections = new Map()
  } = {}) {
    this.collectionName = collectionName;
    this.dataField = dataField;
    this.sequenceInData = sequenceInData;
    this.proxyCollections = proxyCollections;
    this.helper = new RecordCollectionHelper(
      {collectionName, dataField, sequenceInData});
  }

  async createIndexes() {
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
    const {dataField, proxyCollections} = this;
    const {id} = record?.[dataField];
    assert.string(id, `record.${dataField}.id`);

    // see if any fields that should be unique are set
    const keys = [...proxyCollections.keys()];
    const {[dataField]: data} = record;
    const applyUniqueConstraint = keys.some(k => data[k] !== undefined);

    if(!applyUniqueConstraint) {
      // no uniqueness constraints; insert record w/o transaction
      return this.helper.insert({record});
    }

    // FIXME: doInsertTransaction
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
   * @param {boolean} [options._awaitRollback=false] - A flag that
   *   controls awaiting any transaction rollback (for internal use only).
   *
   * @returns {Promise} - Returns a Promise that resolves to the data record
   *   (`{[dataField], meta}`).
   */
  async get({
    id, uniqueField, uniqueValue,
    _allowPending = false, _awaitRollback = false
  } = {}) {
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

    while(true) {
      if(proxyCollection) {
        const proxyRecord = await proxyCollection.get({uniqueValue});
        if(proxyRecord._txn) {
          // FIXME: process transaction and loop to retry
        }
      }

      // FIXME: determine if `_allowPending` belongs here
      const record = await this.helper.get(
        {id, uniqueField, uniqueValue, _allowPending});
      if(record._txn) {
        // process pending transaction with the record
        await this._processPendingTransaction({record, _awaitRollback});
        // if transaction wasn't being rolled back or rollback was awaited,
        // then loop to refresh the record
        if(!record._txn.rollback || _awaitRollback) {
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
   * property of this collection. If `sequence` is in the data, then `data`
   * MUST be given, if it is in the meta data then `meta` MUST be given.
   *
   * @param {object} options - The options to use.
   * @param {string} options.id - The ID of the record to update.
   * @param {object} [options.data] - The new data to use.
   * @param {object} [options.meta] - The new meta data to use.
   *
   * @returns {Promise} - Returns a Promise that resolves to `true` if the
   *   update succeeds.
   */
  async update({id, data, meta} = {}) {
    // validate params
    const {
      expectedSequence, sequenceLocation
    } = this.helpers.validateUpdateParams({id, data, meta});

    // FIXME: determine if no external field is changing ... in which case
    // just do a regular update

    // FIXME: else, doUpdateTransaction
  }

  /**
   * Removes an existing record.
   *
   * @param {object} options - The options to use.
   * @param {string} options.id - The ID of the record to remove.
   *
   * @returns {Promise<boolean>} Resolves with `true` on remove success.
   */
  async remove({id} = {}) {
    assert.string(id, 'id');

    // FIXME: doRemoveTransaction
  }

  _getCollection() {
    return database.collections[this.collectionName];
  }
}