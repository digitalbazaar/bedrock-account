/*!
 * Copyright (c) 2018-2023 Digital Bazaar, Inc. All rights reserved.
 */
import {logger} from './logger.js';
import {v4 as uuid} from 'uuid';

export class RecordTransaction {
  constuctor({type, id, record, data, meta, helper} = {}) {
    this.txn = {id: uuid(), type, recordId: id};
    this.id = id;
    this.record = record;
    this.data = data;
    this.meta = meta;
    this.helper = helper;
    this.initialize = this[`_init_${type}`];
  }

  async run() {
    try {
      // init transaction (write intent to change data record)
      if(!await this.initialize()) {
        // try to complete any pending transaction
        const {id} = this;
        const result = await this._processAnyPendingTransaction({id});
        if(!result.processed && !result.record) {
          // record doesn't exist; never called in `insert` case, so safe to
          // to throw not found for both `update` and `delete` cases
          throw result.error;
        }
        // abort and retry
        _throwAbortError();
      }

      // perform relevant proxy collection updates
      await this._updateProxyRecords();

      // commit transaction (write to data record w/actual changes)
      const {id, record, data, meta, txn} = this;
      const newTxn = {...txn, committed: true};
      const update = {id, data, meta, oldTxn: txn, newTxn};
      if(txn.type === 'delete') {
        update._pending = true;
      }
      await this._commitTransaction({update});

      // transaction committed, now complete it in the background
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
    // FIXME: wrong `id` here, needs to be passed in
    const {id} = this;
    try {
      // complete any proxy operations
      await this._completeProxyOperations({record, data, txn});

      if(txn.type === 'delete') {
        // finally remove data record
        await this.helper.delete({id});
      } else {
        // remove `txn` from record
        await this.helper.update({id, oldTxn: txn});
      }
    } catch(error) {
      if(throwError) {
        throw error;
      }
      logger.debug(
        `Failed to complete record "${id}" transaction "${txn.id}". It ` +
        'be automatically completed on the next read or write.', {error});
    }
  }

  async _init_insert() {
    // insert pending record; it must be present prior to the
    // insertion of any proxy records tagged with the `txn` in
    // order to enable clean transaction rollback or commitment
    const record = {...this.record, _pending: true, _txn: this.txn};
    // if this throws a duplicate error, it will be handled via `run()`
    await this.helper.insert({record});
  }

  async _init_update() {
    // mark data record for update
    const {id, data, meta, txn} = this;
    // need to check expected sequence without setting `data` or `meta`
    const {
      expectedSequence, sequenceLocation
    } = this.helper.validateParams({id, data, meta});
    return this.helper._update(
      {id, expectedSequence, sequenceLocation, newTxn: txn});
  }

  async _init_delete() {
    // mark data record for removal
    const {id, txn} = this;
    return this.helper.update({id, newTxn: txn});
  }

  // refreshes a record by processing any pending transaction; can throw
  // an abort error if the transaction processing aborts
  async _processAnyPendingTransaction({id, blockingProxyRecords} = {}) {
    // get the existing record and process any pending transaction
    try {
      const record = await this.helper.get({id, _allowPending: true});
      if(!record._txn) {
        // nothing to process
        return {processed: false, record};
      }
      // process pending delete transaction and loop to try again
      await this._processPendingTransaction({record});
      return {processed: true};
    } catch(error) {
      if(error.name === 'NotFoundError') {
        /* Note: Here the data record does not exist, but it is safe to
        rollback any proxy record changes. The only way this state can
        occur is if a process running a transaction stalled, the
        transaction was rolled back by another process, and then the
        stalled process continued and wrote some proxy records that will
        never be committed and might not be removed if that previously
        stalled process crashes prior to removing them. */
        if(blockingProxyRecords) {
          // FIXME: test unrecoverable error thrown from
          // proxyCollection.rollback()
          const results = await Promise.allSettled(blockingProxyRecords.map(
            async ({proxyCollection, proxyRecord}) => {
              const {_txn: {id: txnId}, uniqueValue} = proxyRecord;
              // note that this only throws on unrecoverable errors
              return proxyCollection.rollbackChange({txnId, uniqueValue});
            }));
          // check rejections for an unrecoverable error
          const rejection = results.find(r => r.status === 'rejected');
          throw rejection.reason;
        }
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
      if(!await this.helper.update({id, oldTxn: txn})) {
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
    try {
      if(!await this.helper.update(update)) {
        // commit failed; throw abort error
        _throwAbortError();
      }
    } catch(e) {
      const {id, txn} = this;

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

    // used to track proxy records that are blocking proxy operations; these
    // are tracked by the record ID associated with their pending transactions
    const blockingProxyRecords = new Map();

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
          const {proxyCollection} = op;
          const blocked = blockingProxyRecords.get(txnRecordId);
          if(blocked) {
            blocked.push({proxyCollection, proxyRecord});
          } else {
            blockingProxyRecords.set(
              txnRecordId, {proxyCollection, proxyRecord});
          }
        }
      }));

      // process all pending transactions to unblock ops
      const entries = [...blockingProxyRecords.entries()];
      await Promise.all(entries.map(async ([id, blockingProxyRecords]) => {
        try {
          await this._processAnyPendingTransaction({id, blockingProxyRecords});
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
