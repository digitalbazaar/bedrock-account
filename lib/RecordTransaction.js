/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {logger} from './logger.js';
import {v4 as uuid} from 'uuid';

const {util: {BedrockError}} = bedrock;

export class RecordTransaction {
  constuctor({
    type, id, record, data, meta, helper,
    initialize, prepareCommit
  } = {}) {
    this.txn = {id: uuid(), type, recordId: id};
    this.id = id;
    this.record = record;
    this.data = data;
    this.meta = meta;
    this.initialize = initialize;
    this.prepareCommit = prepareCommit;
    this.helper = helper;
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
      await this.helper.update({id, oldTxn: txn});
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
        if(!await this.helper.update({id, newTxn})) {
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
      if(!await this.helper.update({id, oldTxn: newTxn})) {
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
      if(!await this.helper.update(update)) {
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
          // FIXME: consider exposing as a helper function... that takes
          // ... the record ID and one or more proxy records so it can be
          // ... called from RecordCollection.get()
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
