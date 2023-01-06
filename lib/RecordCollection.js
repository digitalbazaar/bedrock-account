/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';
import {logger} from './logger.js';
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
        // FIXME: implement `_ensureUnique` using transactions
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
   * @param {boolean} [options._awaitTransaction=false] - An flag that
   *   causes any pending transaction to be awaited (for internal use only).
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
   *   the data record (`{[dataField], meta}`) or an ExplainObject if
   *   `explain=true`.
   */
  async get({
    id, uniqueField, uniqueValue,
    _allowPending = false, _awaitTransaction = false,
    explain = false
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

    // complete or rollback existing transaction, if any
    if(record._txn) {
      const {id: txnId} = record._txn;
      const promise = record._txn.rollback ?
        this._rollbackTransaction({record, txnId}) :
        this._completeTransaction({record, txnId});
      // if `get` is for an update, await promise, otherwise, background it
      if(_awaitTransaction) {
        await promise;
      } else {
        promise.catch(
          error => logger.debug(
            `Failed to handle record "${id}" transaction "${txnId}". It ` +
            'be automatically handled on the next read or write.', {error}));
      }
    }

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
  async update({id, data, meta, explain = false} = {}) {
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

    if(explain) {
      // handle explain case without performing any potential transactions
      return this._update(
        {id, data, meta, sequenceLocation, expectedSequence, explain});
    }

    /* Note: If any externalized unique field is changing, a continuable
    "transaction" must be performed to properly update the record and any proxy
    collections. The "transaction" is not performed using the MongoDB
    database transaction API, but through custom logic instead -- in order to
    enable sharding. */
    const {proxyCollections} = this;
    // FIXME: consider retrying `N` times instead of indefinitely to handle
    // cases where multiple updates are competing concurrently
    while(true) {
      // if updating data and there are proxy collections, the update may
      // need to be performed within a transaction
      if(data && proxyCollections.size > 0) {
        // check sequence number on existing record, throw if no match; await
        // any pending transaction on the record before trying another one
        const record = await this.get({id, _awaitTransaction: true});
        const {sequence: actualSequence} = record?.[sequenceLocation];
        if(actualSequence !== expectedSequence) {
          this._throwInvalidSequence({actualSequence, expectedSequence});
        }

        try {
          // attempt to perform update in a transaction
          const {txnId, result} = await this._tryTransaction(
            {id, data, meta, sequenceLocation, expectedSequence, record});
          if(txnId) {
            // transaction was performed; return result
            return result;
          }
        } catch(e) {
          // if transaction was aborted, loop to retry
          if(e.name === 'AbortError') {
            continue;
          }
          throw e;
        }
      }

      // perform data record update w/o a transaction
      return this._update({id, data, meta, sequenceLocation, expectedSequence});
    }
  }

  /**
   * Removes an existing record.
   *
   * @param {object} options - The options to use.
   * @param {string} options.id - The ID of the record to remove.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on remove
   *   success or an ExplainObject if `explain=true`.
   */
  async remove({id, explain = false} = {}) {
    assert.string(id, 'id');

    const {dataField} = this;
    const collection = this._getCollection();
    const query = {[`${dataField}.id`]: id};

    // FIXME: add proxy collection transaction code

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

  async _completeTransaction({record, txnId} = {}) {
    /* Algorithm:

    1. Remove txn ID `X` from all mapping records, ignore non-updates.
    2. Remove txn ID `X` from data record, ignore non-updates. */
    // FIXME: update all proxy collections by completing prepared removals
    // and removing any `_txnId` from other `_pending` mapping records
    if(txnId) {
      // FIXME: ?
    }
    const {dataField, proxyCollections} = this;
    const {[dataField]: data} = record;
    const values = [...proxyCollections.values()];
    const mappingRecords = await Promise.all(values.map(
      async proxyCollection => {
        // FIXME:
        const uniqueValue = data?.[proxyCollection.uniqueField];
        if(uniqueValue !== undefined) {
          return proxyCollection.get({uniqueValue});
        }
      }));
    // FIXME: implement algorithm
    return mappingRecords;
  }

  async _rollbackTransaction({record, txnId} = {}) {
    const {dataField, proxyCollections} = this;
    const id = record[dataField].id;

    // mark data record with transaction to be rolled back
    const newTxn = {id: txnId, rollback: true};
    if(!await this._update({id, newTxn})) {
      // some other transaction is being applied / rolled back, abort
      _throwAbortError();
    }

    // call `rollback` on all proxy collections
    const values = [...proxyCollections.values()];
    await Promise.all(values.map(
      async proxyCollection => proxyCollection.rollback({txnId})));

    // clear transaction from record
    if(!await this._update({id, oldTxn: newTxn})) {
      // some other transaction is being applied / rolled back, abort
      _throwAbortError();
    }
  }

  async _tryTransaction({
    id, data, meta, sequenceLocation, expectedSequence, record
  } = {}) {
    /* Algorithm for record+proxy collection transactions:

    1. Check sequence number on existing record, throw if no match.
    2. Update mapping records with txn ID `X`.
      2.1. Conflict, rollback all found pending transactions.
      2.2. Rollback txn with ID `X`.
      2.3. Loop and get existing record, completing any committed transaction.
    3. Update data record w/ committed transaction to data record.
      3.1. Rollback txn ID `X`.
      3.2. Loop and get existing record, completing any committed transaction.
    4. Background completing committed transaction.
    */
    const {txnId, allPrepared, pendingTxnIds} =
      await this._updateProxyCollections({record, data});
    if(txnId === undefined) {
      // no transaction created due to no required proxy updates, return early
      return {txnId, result: false};
    }

    // check for failed proxy collection preparation
    let rollback = !allPrepared;
    if(!rollback) {
      // nothing to rollback, so try to write update with committed transaction
      // to data record
      const newTxn = {id: txnId, rollback: false};
      if(!await this._update(
        {id, data, meta, sequenceLocation, expectedSequence, newTxn})) {
        // update failed, roll it back
        rollback = true;
      }
    }

    if(!rollback) {
      // background completing transaction
      this._completeTransaction({record, txnId}).catch(
        error => logger.debug(
          `Failed to complete record "${id}" transaction "${txnId}". It ` +
          'be automatically completed on the next read or write.', {error}));
    } else {
      /* Attempt to rollback any pending transactions. Any particular
      transaction may actually have been committed, in which case the rollback
      will either abort or will not have any effect. If the transaction was
      committed but not completed, we will complete it whenever we abort and
      loop to get a fresh copy of the record again. Note that rollbacks here
      must occur in serial to avoid a conflict that would trigger an abort. */
      for(const pendingTxnId of pendingTxnIds) {
        await this._rollbackTransaction({record, txnId: pendingTxnId});
      }

      // finally, rollback current transaction
      await this._rollbackTransaction({record, txnId});

      // transaction aborted, throw to potentially try again
      _throwAbortError();
    }

    // transaction committed, successful update
    return {txnId, result: true};
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

  async _update({
    id, data, meta, sequenceLocation, expectedSequence, newTxn, oldTxn,
    explain = false
  } = {}) {
    const {dataField, sequenceInData} = this;

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
    // set transaction if `newTxn` is given
    if(newTxn) {
      update.$set._txn = newTxn;
    } else {
      // clear any existing transaction
      update.$unset._txn = '';
    }
    // if not rolling a transaction back, update the sequence number
    if(!newTxn?.rollback) {
      if(sequenceInData) {
        update.$inc = {[`${dataField}.sequence`]: true};
      } else {
        update.$inc = {'meta.sequence': true};
      }
    }

    const collection = this._getCollection();
    const query = {[`${dataField}.id`]: id};
    // if `data` or `meta` have been given, ensure the sequence number matches
    if(data || meta) {
      if(sequenceInData) {
        query[`${dataField}.sequence`] = data.sequence - 1;
      } else {
        query['meta.sequence'] = meta.sequence - 1;
      }
    }
    // ensure `oldTxn` matches if given and that there is no existing
    // transaction if not given
    if(oldTxn) {
      query['_txn.id'] = oldTxn.id;
      query['_txn.rollback'] = oldTxn.rollback;
    } else {
      query._txn = {$exists: false};
    }

    if(explain) {
      // 'find().limit(1)' is used here because 'updateOne()' doesn't return
      // a cursor which allows the use of the explain function
      const cursor = await collection.find(query).limit(1);
      return cursor.explain('executionStats');
    }

    const result = await collection.updateOne(query, update);
    if(result.result.n > 0) {
      // record updated
      return true;
    }

    // check expected sequence if given
    if(expectedSequence) {
      // determine if `txnId` or `sequence` did not match; will throw if record
      // does not exist
      const record = await this.get({id});
      const {sequence: actualSequence} = record?.[sequenceLocation];
      if(actualSequence !== expectedSequence) {
        this._throwInvalidSequence({actualSequence, expectedSequence});
      }
    }

    // update did not occur
    return false;
  }

  async _updateProxyCollections({record, data} = {}) {
    // track any IDs found for pending transactions and whether every proxy
    // collection is properly prepared
    const pendingTxnIds = new Set();
    let allPrepared = true;

    // add unique mapping records w/transaction ID
    let txnId;
    const {dataField, proxyCollections} = this;
    const entries = [...proxyCollections.entries()];
    const recordId = record?.[dataField].id;
    await Promise.all(entries.map(
      async ([k, proxyCollection]) => {
        const existingValue = record?.[dataField]?.[k];
        if(data[k] === existingValue) {
          // nothing to change
          return;
        }
        // create a transaction ID if one hasn't been created yet
        if(txnId === undefined) {
          txnId = uuid();
        }
        // remove old mapping record and insert new one
        const [prepared] = await Promise.all([
          // FIXME: add test case for concurrent updates to data records with
          // no existing values that will add different new values
          existingValue === undefined ?
            true : proxyCollection.prepareRemove({recordId, txnId}),
          // if insert throws a duplicate error, the `record` sequence MUST
          // have changed and we will handle this elsewhere
          proxyCollection.insert({uniqueValue: data[k], recordId, txnId})
        ]);
        // preparation complete for this proxy collection
        if(prepared) {
          return;
        }
        // not prepared; get any pending `txnId` from the mapping record
        allPrepared = false;
        try {
          const mappingRecord = await proxyCollection.get({recordId});
          const txnId = mappingRecord._txnId;
          if(txnId) {
            pendingTxnIds.add(txnId);
          }
        } catch(e) {
          if(e.name !== 'NotFoundError') {
            throw e;
          }
        }
      }));
    return {txnId, allPrepared, pendingTxnIds};
  }
}

function _throwAbortError() {
  const error = new Error('Transaction operation aborted.');
  error.name = 'AbortError';
  throw error;
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */
