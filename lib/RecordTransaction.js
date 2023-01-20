/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';
import {logger} from './logger.js';
import {v4 as uuid} from 'uuid';

const {util: {BedrockError}} = bedrock;

export class RecordTransaction {
  constuctor({
    type, id, record, data, meta, beforeUpdateProxyRecords, beforeCommit
  } = {}) {
    this.beforeUpdateProxyRecords = beforeUpdateProxyRecords;
    this.beforeCommit = beforeCommit;
    this.txn = {id: uuid(), type, recordId: id};
    this.id = id;
    this.record = record;
    this.data = data;
    this.meta = meta;
  }

  static async _doInsertTransaction() {
    // FIXME: set limit on attempts
    while(true) {
      try {
        const t = new RecordTransaction({
          initialize: async ({state}) => {
            // insert pending record; it must be present prior to the
            // insertion of any proxy records tagged with the `txn` in
            // order to enable clean transaction rollback or commitment
            const record = {...state.record, _pending: true, _txn: state.txn};
            // FIXME: what if there's a duplicate here? if the duplicate is
            // pending, we can roll it back
            await this._insert({record});
          },
          prepareCommit: async ({state}) => {
            // create `update` parameters
            const newTxn = {id: txnId, type: 'insert', committed: true};
            // FIXME: update must remove `_pending` as well; fine if `_update`
            // will do this automatically provided that this works with the new
            // `remove` implementation (not yet implemented)
            const update = {id, oldTxn, newTxn};
            return update;
          }
        });

        return await t.run();
      } catch(e) {
        if(e.name !== 'AbortError') {
          // unrecoverable error
          throw e;
        }
      }
    }
  }

  static async _doRemoveTransaction() {
    // FIXME: set limit on attempts
    while(true) {
      try {
        const t = new RecordTransaction({
          initialize: async ({state}) => {
            // mark data record for removal
            const {id, txn} = state;
            if(!await this._update({id, newTxn: txn})) {
              // try to complete any pending transaction
              const result = await this._processAnyPendingTransaction({id});
              if(!result.processed && !result.record) {
                // record already doesn't exist, throw not found
                throw result.error;
              }
              // abort and retry
              _throwAbortError();
            }
          },
          prepareCommit: async ({state}) => {
            // create `update` parameters
            const {id, txn} = state;
            const newTxn = {id: txn.id, type: 'delete', committed: true};
            // FIXME: set `_pending: true` -- either internally or pass it here
            const update = {id, oldTxn: txn, newTxn};
            return update;
          }
        });

        return await t.run();
      } catch(e) {
        if(e.name !== 'AbortError') {
          // unrecoverable error
          throw e;
        }
      }
    }
  }

  static async _doUpdateTransaction() {
    // FIXME: set limit on attempts
    while(true) {
      try {
        const t = new RecordTransaction({
          initialize: async ({state}) => {
            // mark data record for update
            const {id, txn} = state;
            // FIXME: include expected sequence; otherwise appears to be the
            // same as doing a `remove`
            if(!await this._update({id, newTxn: txn})) {
              // try to complete any pending transaction
              const result = await this._processAnyPendingTransaction({id});
              if(!result.processed && !result.record) {
                // record already doesn't exist, throw not found
                throw result.error;
              }
              // abort and retry
              _throwAbortError();
            }
          },
          prepareCommit: async ({state}) => {
            // create `update` parameters
            const {id, txn} = state;
            const newTxn = {id: txn.id, type: 'update', committed: true};
            const update = {id, oldTxn: txn, newTxn};
            return update;
          }
          // FIXME: might need to put complete() here to be able to clear
          // the transaction state via `_update`?
        });

        return await t.run();
      } catch(e) {
        if(e.name !== 'AbortError') {
          // unrecoverable error
          throw e;
        }
      }
    }
  }

  async run() {
    try {
      const {id, record, data, txn} = this;
      const state = {txn};

      await this.initialize({state});

      await this._updateProxyRecords();

      const update = await this.prepareCommit({state});

      // all proxy operations complete; try to commit transaction
      await this._commitTransaction({update});

      // transcation committed, now complete it in the background
      // background completing transaction
      // FIXME: pass old record to allow for faster queries during completion?
      await this._completeTransaction({record, data, txn, throwError: false});
    } catch(e) {
      // roll transaction back; but do not throw any errors
      const {id, txn} = this;
      await this._rollbackTransaction({id, txn, throwError: false});

      // transaction aborted, loop to retry
      if(e.name === 'AbortError') {
        throw e;
      }

      // duplicate error only occurs during an `insert` transaction
      if(e.name === 'DuplicateError') {
        // try to process a pending transaction
        const result = await this._processAnyPendingTransaction({id});
        if(!result.processed) {
          if(result.record) {
            // record is a stable duplicate, throw
            throw e;
          }
          // record has been removed, transaction aborted
          _throwAbortError();
        }
      }

      // throw any other error (unrecoverable)
      throw e;
    }
  }

  async _completeTransaction({record, data, txn, throwError = true} = {}) {
    const {id} = this;
    try {
      // complete any proxy operations
      await this._completeProxyOperations({record, data, txn});

      // FIXME: if the txn.type === 'remove', then call `delete` instead

      // all proxy operations completed, so remove `txn` from record
      // FIXME: this exists in RecordCollection, not here
      await this._update({id, oldTxn: txn});
    } catch(error) {
      if(throwError) {
        throw error;
      }
      logger.debug(
        `Failed to complete record "${id}" transaction "${txn.id}". It ` +
        'be automatically completed on the next read or write.', {error});
    }
  }

  // refreshes a record by processing any pending transaction; can throw
  // an abort error if the transaction processing aborts
  // FIXME: rename to `_processPendingTransaction` if that function is
  // only called from here and just add the `this.get()`; probably can't
  // do this since we call it from RecordCollection.get()
  async _processAnyPendingTransaction({id} = {}) {
    // get the existing record and process any pending transaction
    try {
      // FIXME: handle `_allowPending` flag
      const record = await this.get({id, _allowPending: true});
      if(!record._txn) {
        // nothing to process
        return {processed: false, record};
      }
      // process pending delete transaction and loop to try again
      await this._processPendingTransaction({record});
      return {processed: true};
    } catch(error) {
      if(error.name === 'NotFoundError') {
        return {processed: false, record: null, error};
      }
      throw error;
    }
  }

  async _processPendingTransaction({record, _awaitRollback = true} = {}) {
    const {_txn: txn} = record;
    if(!txn) {
      // no transaction to process
      return;
    }

    // complete or rollback existing transaction
    await txn.committed ?
      this._completeTransaction({record, txn}) :
      this._rollbackTransaction({record, txn, throwError: _awaitRollback});
  }

  // FIXME: check implementation
  async _rollbackTransaction({id, txn, throwError = true} = {}) {
    try {
      const {proxyCollections} = this;

      // mark data record with transaction to be rolled back if not already so
      if(!txn.rollback) {
        const newTxn = {...txn, rollback: true};
        if(!await this._update({id, newTxn})) {
          // FIXME: handle case where transaction was concurrently marked as
          // rolled back

          // FIXME: handle case where record does not exist; here it is safe to
          // assume that the proxy records can be rolled back, because the only
          // way this can happen is if an original transaction stalled ... it
          // was rolled back and then it continued and added proxy records that
          // weren't backed by any data record marked with the txn ID

          // some other transaction is being applied / rolled back, abort
          _throwAbortError();
        }
      }

      // call `rollback` on all proxy collections
      const values = [...proxyCollections.values()];
      // FIXME: determine if `uniqueValue` can be passed here
      const {id: txnId} = txn;
      await Promise.all(values.map(
        async proxyCollection => proxyCollection.rollbackChange({txnId})));

      // clear transaction from record
      if(!await this._update({id, oldTxn: newTxn})) {
        // some other transaction is being applied / rolled back, abort
        _throwAbortError();
      }
    } catch(error) {
      if(throwError) {
        throw error;
      }
      logger.debug(
        `Failed to rollback transaction "${txn.id}" for record "${id}". It ` +
        'will be automatically handled on the next read or write.', {error});
    }
  }

  async _commitTransaction({update} = {}) {
    // FIXME:
    // either throw `AbortError` if commit fails because the record was already
    // written to or the sequence was wrong .... or just roll back the
    // transaction here and throw why it failed (probably this)
    try {
      if(!await this._update(update)) {
        // commit failed; throw abort error
        _throwAbortError();
      }
    } catch(e) {
      // FIXME: if `e` was `InvalidStateError` then it was a sequence error,
      // throw after doing the rollback
      const {id} = update;
      const {txn} = this;

      // await rolling back transaction to try and clean up, but only log any
      // errors, throwing the original error once complete
      try {
        await this._rollbackTransaction({id, txn});
      } catch(e) {
        error => logger.debug(
          `Failed to rollback transaction "${txn.id}" for record "${id}". It ` +
          'will be automatically handled on the next read or write.', {error});
      }
      throw e;
    }
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
    //, $unset: {_pending: ''}};
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
      // clear any `_pending` flag if `newTxn` is not being rolled back
      if(!newTxn.rollback) {
        update.$unset = {_pending: ''};
      }
    } else {
      // clear any existing transaction
      update.$unset = {_txn: ''};
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
      // FIXME: handle `_allowPending` flag
      const record = await this.get({id});
      const {sequence: actualSequence} = record?.[sequenceLocation];
      if(actualSequence !== expectedSequence) {
        this._throwInvalidSequence({actualSequence, expectedSequence});
      }
    }

    // update did not occur
    return false;
  }

  // FIXME: try to remove this
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

  // FIXME: remove me
  async _ensureUnique({record, txnId} = {}) {
    /* Note: Now we must handle records with externalized unique values. These
    values cannot be uniquely indexed in the data record collection (as it
    would prevent sharding). Instead we must enforce uniqueness constraints
    via proxy collections. Only once we have confirmed that the unique values
    have been claimed in each applicable proxy collection can we mark the
    record as ready for use. */

    // FIXME: handle `_pending` properly
    // FIXME: try to just reuse update code
  }

  async _completeProxyOperations({record, data, txn} = {}) {
    // determine proxy operations to be run in a transaction
    const {dataField, proxyCollections} = this;
    const entries = [...proxyCollections.values()];
    // FIXME: check each `Promise.all` everywhere to see whether it should be
    // `Promise.allSettled`
    const results = await Promise.allSettled(
      entries.map(async ([k, proxyCollection]) => {
        // FIXME: ensure that these are correct
        const newValue = data ? data[k] : record[dataField][k];
        const oldValue = record[dataField][k];
        await proxyCollection.completeChange(
          {txnId: txn.id, oldValue, newValue});
      }));
    // throw any error that occurred
    const rejected = results.find(({status}) => status === 'rejected');
    throw rejected.reason;
  }

  async _createPrepareProxyOperations({record, data, txn} = {}) {
    // determine proxy operations to be run in a transaction
    const ops = [];
    const {dataField, proxyCollections} = this;
    const recordData = record[dataField];
    for(const [k, proxyCollection] of proxyCollections) {
      const uniqueValue = recordData[k];
      if(data) {
        const newValue = data[k];
        if(uniqueValue === newValue) {
          // nothing to change
          continue;
        }
        // push op to delete old value and to insert new one
        ops.push({type: 'delete', proxyCollection, uniqueValue});
        ops.push({type: 'insert', proxyCollection, uniqueValue: newValue});
      } else if(uniqueValue !== undefined) {
        ops.push({type: txn.type, proxyCollection, uniqueValue});
      }
    }
    return ops;
  }

  async _runProxyOperation({recordId, txnId, op} = {}) {
    // keep trying to run op, handling any concurrent changes to the proxy
    // record based on the type of op, until the op completes or throws
    const {type, proxyCollection, uniqueValue} = op;
    while(true) {
      try {
        if(type === 'insert') {
          await proxyCollection.insert({uniqueValue, recordId, txnId});
        } else {
          // `type` must be `delete` and this should perform an update to
          // mark the proxy record to be deleted, not actually delete it
          if(!await proxyCollection.prepareRemove({recordId, txnId})) {
            _throwAbortError();
          }
        }
        // successful op
        return {success: true};
      } catch(e) {
        const aborted = e.name === 'AbortError';
        const duplicate = e.name === 'DuplicateError';
        if(!(aborted || duplicate)) {
          // error is unrecoverable; throw it
          throw e;
        }
        try {
          // check existing record for a pending transaction to be processed
          const existing = await proxyCollection.get({recordId, uniqueValue});
          if(!existing._txn) {
            if(duplicate) {
              // stable duplicate found, throw error
              throw e;
            }
            // got an abort error when trying to mark record for deletion; so
            // there was a concurrent update; loop to retry
            continue;
          }
          // pending transaction found, return existing record for processing
          return {success: false, proxyRecord: existing};
        } catch(e) {
          if(e.name === 'NotFoundError' && duplicate) {
            // duplicate proxy record now removed, loop to try insert again
            continue;
          }
          throw e;
        }
      }
    }
  }

  async _updateProxyRecords({record, data, txn} = {}) {
    // determine proxy operations to be run
    let ops = this._createPrepareProxyOperations({record, data, txn});

    // used to track ops that are blocked other pending transactions; these
    // are tracked by the record ID associated with the pending transaction
    const blockedOps = new Map();

    // keep attempting to run all proxy operations until all have been
    // completed or rollback for `record` is required
    const {dataField} = this;
    const recordId = record[dataField].id;
    while(ops.length > 0) {
      const tmp = ops;
      ops = [];
      await Promise.all(tmp.map(async op => {
        const result = await this._runProxyOperation({recordId, txn, op});
        if(!result.success) {
          ops.push(op);
          const {proxyRecord} = result;
          // the record ID in the txn may be different from `recordId`
          const {recordId: txnRecordId} = proxyRecord._txn;
          const blocked = blockedOps.get(txnRecordId);
          if(blocked) {
            blocked.push({op, proxyRecord});
          } else {
            blockedOps.set(txnRecordId, {op, proxyRecord});
          }
        }
      }));

      // process all pending transactions to unblock ops
      const entries = [...blockedOps.entries()];
      await Promise.all(entries.map(async ([id, info]) => {
        try {
          const result = await this._processAnyPendingTransaction({id});
          if(!result.processed && !record) {
            /* Note: Here the data record does not exist, but it is safe to
            rollback any proxy record changes. The only way this state can
            occur is if a process running a transaction stalled, the
            transaction was rolled back by another process, and then the
            stalled process continued and wrote some proxy records that will
            never be committed and might not be removed if that previously
            stalled process crashes prior to removing them. */
            // FIXME: test unrecoverable error thrown from
            // proxyCollection.rollback()
            const results = await Promise.allSettled(info.map(
              async ({op: {proxyCollection}, proxyRecord}) => {
                const {_txn: {id: txnId}, uniqueValue} = proxyRecord;
                // note that this only throws on unrecoverable errors
                return proxyCollection.rollbackChange({txnId, uniqueValue});
              }));
            // check rejections for an unrecoverable error
            const rejection = results.find(r => r.status === 'rejected');
            throw rejection.reason;
          }
        } catch(e) {
          if(e.name !== 'AbortError') {
            // unrecoverable error
            throw e;
          }
        }
      }));
    }
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
