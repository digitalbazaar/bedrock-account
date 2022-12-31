/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';
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
    assert.string(record?.[dataField]?.id, `record.${dataField}.id`);

    try {
      // first, insert record in `pending` state
      record._pending = true;
      await database.collections.account.insertOne(record);
      // if any fields that should be unique are set, ensure they are unique
      const keys = [...proxyCollections.keys()];
      const {[dataField]: data} = record;
      if(keys.some(k => data[k] !== undefined)) {
        await this._ensureUnique({record});
      }
    } catch(e) {
      if(!database.isDuplicateError(e)) {
        throw e;
      }
      throw new BedrockError(`Duplicate ${dataField}.`, {
        name: 'DuplicateError',
        details: {public: true, httpStatusCode: 409},
        cause: e
      });
    }

    return record;
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
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
   *   the data record (`{[dataField], meta}`) or an ExplainObject if
   *   `explain=true`.
   */
  async get({
    id, uniqueField, uniqueValue, _allowPending = false, explain = false
  } = {}) {
    assert.optionalString(id, 'id');
    assert.optionalString(uniqueField, 'uniqueField');
    assert.optionalString(uniqueValue, 'uniqueValue');
    if(!(id !== undefined ||
      (uniqueField !== undefined && uniqueValue !== undefined))) {
      throw new Error(
        'Either "id" or "uniqueField" and "uniqueValue" are required.');
    }

    const {dataField} = this;
    const query = {};
    if(id !== undefined) {
      query[`${dataField}.id`] = id;
    }
    if(uniqueField !== undefined) {
      query[`${dataField}.${uniqueField}`] = uniqueValue;
    }
    if(!_allowPending) {
      query._pending = {$exists: false};
    }

    const projection = {_id: 0, [dataField]: 1, meta: 1, _pending: 1};
    const collection = this._getCollection();

    if(explain) {
      // 'find().limit(1)' is used here because 'findOne()' doesn't return a
      // cursor which allows the use of the explain function.
      const cursor = await collection.find(query, {projection}).limit(1);
      return cursor.explain('executionStats');
    }

    const record = await collection.findOne(query, {projection});
    if(!record) {
      const dataName = dataField[0].toUpperCase() + dataField.slice(1);
      throw new BedrockError(
        `${dataName} not found.`,
        'NotFoundError',
        {id, httpStatusCode: 404, public: true});
    }

    // FIXME: complete txn or perform rollback if `_txn` present
    // ... perform in background unless special `_update` flag is passed in
    // which case it should be performed in the foreground

    return record;
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
    if(!_allowPending) {
      query = {...query, _pending: {$exists: false}};
    }
    return database.collections.account.find(query, options).toArray();
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
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
   *   `true` if the update succeeds or an ExplainObject if `explain=true`.
   */
  async update({id, data, meta, explain} = {}) {
    // validate params
    if(!(data || meta)) {
      throw new TypeError('Either "data" or "meta" is required.');
    }
    assert.optionalObject(data, 'data');
    assert.optionalObject(meta, 'meta');
    if(id === undefined) {
      id = data?.id;
    }
    assert.string(id, 'id');
    if(data && data.id !== id) {
      throw new TypeError('"id" must equal "data.id".');
    }
    let expectedSequence;
    const {dataField, sequenceInData} = this;
    let sequenceLocation;
    if(sequenceInData) {
      assert.number(data?.sequence, `${dataField}.sequence`);
      expectedSequence = data.sequence - 1;
      sequenceLocation = dataField;
    } else {
      assert.number(meta?.sequence, 'meta.sequence');
      expectedSequence = meta.sequence - 1;
      sequenceLocation = 'meta';
    }

    // if any externalized unique field is changing, a continuable
    // "transaction" must be performed to properly update the record
    let txnId;
    if(data) {
      const record = await this.get({id});
      const {sequence: actualSequence} = record?.[sequenceLocation];
      if(actualSequence !== expectedSequence) {
        this._throwInvalidSequence({actualSequence, expectedSequence});
      }

      // complete any existing transaction
      await this._completeTransaction({record});

      // start a new transaction
      txnId = await this._startTransaction({record, data});
    }

    // build update
    const now = Date.now();
    const update = {$set: {}};
    if(data) {
      update.$set[dataField] = data;
    }
    if(meta) {
      update.$set.meta = {...meta, updated: now};
    } else {
      update.$set['meta.updated'] = now;
    }
    // FIXME: check if `txnId` is set, indicating a transaction is in progress
    // and must be set in the record below
    if(txnId) {
      update.$set._txnId = txnId;
    }

    const collection = this._getCollection();
    const query = {[`${dataField}.id`]: id};
    if(sequenceInData) {
      query[`${dataField}.sequence`] = data.sequence - 1;
    } else {
      query['meta.sequence'] = meta.sequence - 1;
    }
    // FIXME: check if `txnId` is set, indicating a transaction is in progress
    // and must be set in the record below
    if(txnId) {
      query._txnId = txnId;
    }

    if(explain) {
      // 'find().limit(1)' is used here because 'updateOne()' doesn't return a
      // cursor which allows the use of the explain function.
      const cursor = await collection.find(query).limit(1);
      return cursor.explain('executionStats');
    }

    const result = await collection.updateOne(query, update);
    if(result.result.n > 0) {
      // record updated
      // FIXME: if a `txnId` was set, we must now complete the transaction
      // ... ensure `_completeTransaction()` can be called easily here
      return true;
    }

    // determine if `txnId` or `sequence` did not match; will throw if record
    // does not exist
    const record = await this.get({id});
    const {sequence: actualSequence} = record?.[sequenceLocation];
    if(actualSequence !== expectedSequence) {
      this._throwInvalidSequence({actualSequence, expectedSequence});
    }
    // FIXME: check `txnId` if it was set

    return false;
  }

  /**
   * Removes an existing mapping.
   *
   * @param {object} options - The options to use.
   * @param {string} options.uniqueValue - The unique value.
   * @param {string} options.recordId - The record ID to remove.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on remove
   *   success or an ExplainObject if `explain=true`.
   */
  async remove({uniqueValue, recordId, explain = false} = {}) {
    assert.string(uniqueValue, 'uniqueValue');
    assert.string(recordId, 'recordId');

    const {idField, uniqueField} = this;
    const collection = this._getCollection();
    const query = {[uniqueField]: uniqueValue, [idField]: recordId};

    if(explain) {
      // 'find().limit(1)' is used here because 'deleteOne()' doesn't return a
      // cursor which allows the use of the explain function
      const cursor = await collection.find(query).limit(1);
      return cursor.explain('executionStats');
    }

    const result = await collection.deleteOne(query);
    return result.result.n > 0;
  }

  _getCollection() {
    return database.collections[this.collectionName];
  }

  async _completeTransaction({record} = {}) {
    /* Algorithm:

    // FIXME: before any attempt is made to clean up what appears to be a
    // failed transaction, a write must be made to the data record indicating
    // that the transaction has failed / is to be rolled back; it may be best
    // to indicate this with a special flag, so: _txn: {id, rollback: true}
    // ... and have the original update that is working on the transaction
    // only apply it if `_txn` is not present at all; this allows for cases
    // where the transaction ID is found in proxy collections by other
    // processes and they need to track that they are starting a rollback
    // ... rollbacks need to cover the case where a transaction would remove
    // a mapping record -- and if it's rolled back, we must not remove that
    // record, but instead just remove the txn ID from it

    // FIXME:
    Case 0:
    1. Get data record, it has a txn ID
    2. Complete txn or perform rollback in foreground w/special _update flag
    3. Done

    Case 1:
    1. Update mapping records with the txn ID, no failures
    2. Write txn ID, rollback: false to the data record
    3. Remove txn ID from all mapping records, no failures
    4. Remove txn ID from data record
    5. Done!

    Case 2:
    1. Update mapping records with the txn ID `A`, one fails!
    2. Call completeTxn() with txn ID from failed mapping record...
    3. Get all mapping records with txn ID and data record with it
    4. data record has txnId, rollback: false
    5. Remove txn ID from all mapping records, no failures
    6. Remove txn ID from data record, replacing with rollback with txn ID `A`
    7. Rollback txn `A`
    8. Check if sequence number is still ok, throw if not
    9. Loop with txn ID `B`

    Case 3:
    1. Update mapping records with the txn ID `A`, no failures
    2. Write txn ID, rollback: false to data record, conflict!
    3. Perform txn completion or rollback on data record
    4. Rollback txn `A`
    5. Check if sequence number is still ok, throw if not
    6. Loop with txn ID `B`

    ***Case N:
    1. Check sequence number on existing record, throw if no match
    2. Update mapping records with txn ID `A`
      2.1. Conflict, call completeTxn() w/txn ID from failed mapping record
      2.2. Rollback txn ID `A`
      2.3. Loop
    3. Write `txn ID, rollback: false` to data record
      3.1. Conflict, call completeTxn() w/data record ID (no txn ID)
      3.2. Rollback txn ID `A`
      3.3. Loop
    4. Background:
      4.1. Remove txn ID `A` from all mapping records, ignore non-updates
      4.2. Remove txn ID `A` from data record, ignore non-updates

    When completeTxn() is called without a data record ID, it gets the record
    and uses the txn ID from the data record, finishing early if there is none;
    when it is called with a txn ID, it first tries to update the data record
    to `txn ID, rollback: true` (gated by there being no txn at all on the
    data record). If this fails, it calls completeTxn() and then loops to try
    again with `txn ID`. The condition for breaking the loop, if any, is TBD. */
    const {dataField, proxyCollections} = this;
    const {[dataField]: data} = record;
    const values = [...proxyCollections.values()];
    const mappingRecords = await Promise.all(values.map(
      async proxyCollection => {
        const uniqueValue = data?.[proxyCollection.uniqueField];
        if(uniqueValue !== undefined) {
          return proxyCollection.get({uniqueValue});
        }
      }));
    // FIXME: implement algorithm
  }

  async _startTransaction({data, record} = {}) {
    let txnId;

    // FIXME: add unique mapping records w/transaction ID
    const {dataField, proxyCollections} = this;
    const entries = [...proxyCollections.entries()];
    const mappingUpdates = await Promise.all(entries.map(
      async ([k, proxyCollection]) => {
        if(txnId === undefined) {
          txnId = uuid();
        }
        if(data[k] !== record?.[dataField]?.[k]) {
          // FIXME: implement
          return proxyCollection.update();
        }
      }));
    // FIXME: for each of the mapping updates that did not complete, we must
    // check for incomplete transactions
    return txnId;
  }

  _throwInvalidSequence({actualSequence, expectedSequence} = {}) {
    const {dataField} = this;
    const details = {httpStatusCode: 409, public: true};
    if(actualSequence !== undefined) {
      details.actual = actualSequence;
    }
    if(expectedSequence !== undefined) {
      details.expected = expectedSequence;
    }
    throw new BedrockError(
      `Could not update ${dataField}. Record sequence does not match.`, {
        name: 'InvalidStateError',
        details
      });
  }
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */
