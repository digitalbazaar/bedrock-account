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
   * Check for the existence of a record.
   *
   * @param {object} options - The options to use.
   * @param {string} options.id - The ID of the record to check.
   * @param {string} [options.uniqueField] - The name of the unique field.
   * @param {string} [options.uniqueValue] - The value of the unique field.
   *
   * @returns {Promise} Resolves to a boolean indicating record existence.
   */
  async exists({id, uniqueField, uniqueValue} = {}) {
    assert.string(id, 'id');
    assert.optionalString(uniqueField, 'uniqueField');
    assert.optionalString(uniqueValue, 'uniqueValue');

    const {recordCollection: {dataField}} = this;
    const query = {[`${dataField}.id`]: id, _pending: {$exists: false}};
    if(uniqueField !== undefined) {
      query[`${dataField}.${uniqueField}`] = uniqueValue;
    }

    const projection = {_id: 0, [`${dataField.id}`]: 1};
    const collection = this.recordCollection.getCollection();

    console.log('EXISTS query', query);
    const record = await collection.findOne(query, {projection});
    return !!record;
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
        details: {
          recordId: id,
          [dataField]: id,
          uniqueField: 'id',
          uniqueValue: id,
          httpStatusCode: 409,
          public: true
        },
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
    // even though `uniqueField` uniqueness constraint is enforced via proxy
    // collection, it must still be checked in the query to ensure the caller
    // gets a consistent view of the record (the record could have changed
    // since the `id` was retrieved from the proxy collection)
    if(uniqueField !== undefined) {
      query[`${dataField}.${uniqueField}`] = uniqueValue;
    }
    if(!_allowPending) {
      query._pending = {$exists: false};
    }

    const projection = {_id: 0, [dataField]: 1, meta: 1, _pending: 1, _txn: 1};
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
        details: {
          recordId: id,
          [dataField]: id,
          httpStatusCode: 404,
          public: true
        }
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
   * @param {object} [options.oldTxn] - The expected old transaction value.
   * @param {object} [options.newTxn] - The new transaction value.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise | ExplainObject} - Returns a Promise that resolves to
   *   `true` if the update succeeds or an ExplainObject if `explain=true`.
   */
  async update({
    id, data, meta, expectedSequence, oldTxn, newTxn, explain = false
  } = {}) {
    const result = this.validateUpdateParams(
      {id, data, meta, expectedSequence});
    expectedSequence = result.expectedSequence;
    const sequenceLocation = result.sequenceLocation;
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
   * @param {object} [options.txn] - The transaction to match; must always
   *   be present for any record with unique field values.
   * @param {boolean} [options.explain=false] - An optional explain boolean.
   *
   * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on delete
   *   success or an ExplainObject if `explain=true`.
   */
  async delete({id, txn, explain = false} = {}) {
    assert.string(id, 'id');
    assert.optionalObject(txn, 'txn');

    const {recordCollection: {dataField}} = this;
    const collection = this.recordCollection.getCollection();
    const query = {[`${dataField}.id`]: id};
    if(!txn) {
      // ensure there is no existing transaction
      query._txn = {$exists: false};
    } else {
      query['_txn.id'] = txn.id;
      if(txn.rollback) {
        query['_txn.rollback'] = true;
      } else if(txn.committed) {
        query['_txn.committed'] = true;
      } else {
        // this is a logic error that should never occur
        console.log('invalid txn passed', txn);
        throw new Error('Invalid delete operation in transaction.');
      }
    }

    if(explain) {
      // 'find().limit(1)' is used here because 'deleteOne()' doesn't return a
      // cursor which allows the use of the explain function
      const cursor = await collection.find(query).limit(1);
      return cursor.explain('executionStats');
    }

    console.log('helper delete query', query);
    const result = await collection.deleteOne(query);
    return result.result.n > 0;
  }

  validateUpdateParams({id, data, meta, expectedSequence} = {}) {
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
    const {recordCollection: {dataField, sequenceInData}} = this;
    let sequenceLocation;
    let sequenceParamName;
    let sequenceObject;
    if(sequenceInData) {
      sequenceParamName = 'data.sequence';
      sequenceObject = data;
      sequenceLocation = dataField;
    } else {
      sequenceParamName = 'meta.sequence';
      sequenceObject = meta;
      sequenceLocation = 'meta';
    }
    if(expectedSequence === undefined) {
      // sequence must be given in the sequence object
      assert.number(sequenceObject?.sequence, sequenceParamName);
      expectedSequence = sequenceObject.sequence - 1;
    } else {
      // expected sequence must be a number and if the sequence object was
      // given, then the two must match
      assert.number(expectedSequence, 'expectedSequence');
      if(sequenceObject && expectedSequence !== (sequenceObject.sequence - 1)) {
        // logic error; should not happen
        throw new Error(
          `Expected sequence "${expectedSequence}" must match ` +
          `"${sequenceParamName}".`);
      }
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
      // update the sequence number if data / meta not provided
      if(!data && !meta && newTxn.committed && expectedSequence !== undefined) {
        update.$inc = {[`${sequenceLocation}.sequence`]: 1};
      }
    } else {
      console.log('no newTxn');
      // clear any existing transaction
      update.$unset = {...update.$unset, _txn: ''};

      // if no transactions are involved but there is an expected sequence,
      // then increment the sequence number if data / meta not provided
      if(!data && !meta && !oldTxn && expectedSequence !== undefined) {
        update.$inc = {[`${sequenceLocation}.sequence`]: 1};
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
