/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';

const {util: {BedrockError}} = bedrock;

export class RecordCollectionHelper {
  constructor({recordCollection} = {}) {
    this.recordCollection = recordCollection;
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
    const {recordCollection: {dataField}} = this;
    const {id} = record?.[dataField];
    assert.string(id, `record.${dataField}.id`);
    try {
      const collection = this.recordCollection.getCollection();
      await collection.insertOne(record);
    } catch(e) {
      console.log('e', e);
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
   * Retrieves a record by `id`, optionally also matching on `uniqueField`
   * and `uniqueValue`.
   *
   * @param {object} options - The options to use.
   * @param {string} options.id - The ID of the record to retrieve.
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
    assert.string(id, 'id');
    assert.optionalString(uniqueField, 'uniqueField');
    assert.optionalString(uniqueValue, 'uniqueValue');

    const {recordCollection: {dataField}} = this;
    const query = {[`${dataField}.id`]: id};
    if(uniqueField !== undefined) {
      query[`${dataField}.${uniqueField}`] = uniqueValue;
    }
    if(!_allowPending) {
      query._pending = {$exists: false};
    }

    const projection = {_id: 0, [dataField]: 1, meta: 1, _pending: 1};
    const collection = this.recordCollection.getCollection();

    if(explain) {
      // 'find().limit(1)' is used here because 'findOne()' doesn't return a
      // cursor which allows the use of the explain function.
      const cursor = await collection.find(query, {projection}).limit(1);
      return cursor.explain('executionStats');
    }

    const record = await collection.findOne(query, {projection});
    if(!record) {
      const dataName = dataField[0].toUpperCase() + dataField.slice(1);
      throw new BedrockError(`${dataName} not found.`, {
        name: 'NotFoundError',
        details: {id, httpStatusCode: 404, public: true}
      });
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
    const collection = this.recordCollection.getCollection();
    return collection.find(query, options).toArray();
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
   * @param {object} [options.oldTxn] - The expected old transaction value.
   * @param {object} [options.newTxn] - The new transaction value.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
   *   `true` if the update succeeds or an ExplainObject if `explain=true`.
   */
  async update({id, data, meta, oldTxn, newTxn, explain = false} = {}) {
    const {
      expectedSequence, sequenceLocation
    } = this.validateUpdateParams({id, data, meta});
    return this._update({
      id, data, meta, sequenceLocation, expectedSequence, oldTxn, newTxn,
      explain
    });
  }

  /**
   * Deletes an existing record.
   *
   * @param {object} options - The options to use.
   * @param {string} options.id - The ID of the record to delete.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on delete
   *   success or an ExplainObject if `explain=true`.
   */
  async delete({id, explain = false} = {}) {
    assert.string(id, 'id');

    const {recordCollection: {dataField}} = this;
    const collection = this.recordCollection.getCollection();
    const query = {[`${dataField}.id`]: id};

    if(explain) {
      // 'find().limit(1)' is used here because 'deleteOne()' doesn't return a
      // cursor which allows the use of the explain function
      const cursor = await collection.find(query).limit(1);
      return cursor.explain('executionStats');
    }

    const result = await collection.deleteOne(query);
    return result.result.n > 0;
  }

  validateUpdateParams({id, data, meta} = {}) {
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
    const {recordCollection: {dataField, sequenceInData}} = this;
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
    return {expectedSequence, sequenceLocation};
  }

  _throwInvalidSequence({actualSequence, expectedSequence} = {}) {
    const {recordCollection: {dataField}} = this;
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
    _pending, explain = false
  } = {}) {
    const {recordCollection: {dataField}} = this;

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
    if(_pending === false) {
      update.$unset = {_pending: ''};
    } else if(_pending === true) {
      update.$set._pending = true;
    }

    // set transaction if `newTxn` is given
    if(newTxn) {
      update.$set._txn = newTxn;
      // if committing the new transaction and there is an expected sequence,
      // update the sequence number
      if(newTxn.committed && expectedSequence !== undefined) {
        update.$inc = {[`${sequenceLocation}.sequence`]: true};
      }
    } else {
      console.log('no newTxn');
      // clear any existing transaction
      update.$unset = {...update.$unset, _txn: ''};

      // if no transactions are involved but there is an expected sequence,
      // then increment the sequence number
      if(!oldTxn && expectedSequence !== undefined) {
        update.$inc = {[`${sequenceLocation}.sequence`]: true};
      }
    }

    console.log('the database update', update);

    // build query
    const collection = this.recordCollection.getCollection();
    const query = {[`${dataField}.id`]: id};
    // if `expectedSequence` given, ensure the sequence number matches
    if(expectedSequence !== undefined) {
      query[`${sequenceLocation}.sequence`] = expectedSequence;
    }
    if(!oldTxn) {
      // ensure there is no existing transaction
      query._txn = {$exists: false};
    } else {
      // ensure existing transaction matches
      query['_txn.id'] = oldTxn.id;
      if(oldTxn.rollback) {
        query['_txn.rollback'] = true;
      } else {
        query['_txn.rollback'] = {$exists: false};
      }
      if(oldTxn.committed) {
        query['_txn.committed'] = true;
      } else {
        query['_txn.committed'] = {$exists: false};
      }
    }

    if(explain) {
      // 'find().limit(1)' is used here because 'updateOne()' doesn't return
      // a cursor which allows the use of the explain function
      const cursor = await collection.find(query).limit(1);
      return cursor.explain('executionStats');
    }

    console.log('database update query', query);
    const result = await collection.updateOne(query, update);
    console.log('database update result', result.result.n);
    if(result.result.n > 0) {
      // record updated
      return true;
    }

    // check expected sequence if given
    if(expectedSequence !== undefined) {
      // determine if `sequence` did not match; will throw if record
      // does not exist (including if record is `_pending`)
      const record = await this.get({id});
      const {sequence: actualSequence} = record?.[sequenceLocation];
      if(actualSequence !== expectedSequence) {
        this._throwInvalidSequence({actualSequence, expectedSequence});
      }
    }

    // update did not occur
    return false;
  }
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */
