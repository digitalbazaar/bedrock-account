/*!
 * Copyright (c) 2022-2023 Digital Bazaar, Inc. All rights reserved.
 */
import {logger} from './logger.js';

export class RecordTransactionProcessor {
  constuctor({recordCollection} = {}) {
    this.recordCollection = recordCollection;
  }

  async commitTransaction({id, data, meta, txn} = {}) {
    const {recordCollection: {helper}} = this;

    // write `committed` transaction to record and update any `data`/`meta`
    const newTxn = {...txn, committed: true};
    const update = {id, data, meta, oldTxn: txn, newTxn};
    if(txn.type === 'delete') {
      update._pending = true;
    } else if(txn.type === 'insert') {
      update._pending = false;
    }
    if(!await helper.update(update)) {
      // commit failed; throw abort error
      this.throwAbortError();
    }
  }

  async completeTransaction({record, data, txn, throwError = true} = {}) {
    const {recordCollection: {dataField, helper}} = this;
    const {id} = record[dataField];
    try {
      // complete any proxy operations
      await this._completeProxyOperations({record, data, txn});

      if(txn.type === 'delete') {
        // finally remove data record
        await helper.delete({id});
      } else {
        // remove `txn` from record
        await helper.update({id, oldTxn: txn});
      }
    } catch(error) {
      if(throwError) {
        throw error;
      }
      logger.debug(
        `Failed to complete record "${id}" transaction "${txn.id}". It ` +
        'will be automatically completed on the next operation.', {error});
    }
  }

  // refreshes a record by processing any pending transaction; can throw
  // an abort error if the transaction processing aborts
  async processAnyPendingTransaction({id, blockingProxyRecords} = {}) {
    const {recordCollection: {helper}} = this;

    // get the existing record and process any pending transaction
    try {
      const record = await helper.get({id, _allowPending: true});
      if(!record._txn) {
        // nothing to process
        return {processed: false, record};
      }
      // process pending delete transaction and loop to try again
      await this.processPendingTransaction({record});
      return {processed: true};
    } catch(error) {
      if(error.name !== 'NotFoundError') {
        // unrecoverable error
        throw error;
      }
      /* Note: Here the data record does not exist, but it is safe to
      rollback any proxy record changes. The only way this state can
      occur is if a process running a transaction stalled, the
      transaction was rolled back by another process, and then the
      stalled process continued and wrote some proxy records that will
      never be committed and might not be removed if that previously
      stalled process crashes prior to removing them. */
      if(blockingProxyRecords) {
        // FIXME: test unrecoverable error thrown from
        // proxyCollection.rollbackChange()
        const results = await Promise.allSettled(blockingProxyRecords.map(
          async ({proxyCollection, proxyRecord}) => {
            const {_txn: {id: txnId}, uniqueValue} = proxyRecord;
            // note that this only throws on unrecoverable errors
            return proxyCollection.rollbackChange({txnId, uniqueValue});
          }));
        this._throwAnyRejection({results});
      }
      return {processed: false, record: null, error};
    }
  }

  async processPendingTransaction({record} = {}) {
    // complete or rollback existing transaction
    const {_txn: txn} = record;
    await txn.committed ?
      this.completeTransaction({record, txn, throwError: true}) :
      this.rollbackTransaction({record, txn, throwError: true});
  }

  // FIXME: check implementation
  async rollbackTransaction({record, txn, throwError = true} = {}) {
    const {recordCollection: {helper, dataField, proxyCollections}} = this;
    const {id} = record[dataField];

    try {
      // mark data record with transaction to be rolled back if not already so
      let newTxn = txn;
      if(!txn.rollback) {
        newTxn = {...txn, rollback: true};
        const {_txn: oldTxn} = record;
        if(!await helper.update({id, newTxn, oldTxn})) {
          // some other transaction is being applied / rolled back, abort
          this.throwAbortError();
        }
      }

      // roll back changes on all proxy collections
      const values = [...proxyCollections.values()];
      // FIXME: determine if `uniqueValue` can be passed here
      const {id: txnId} = newTxn;
      const results = await Promise.allSettled(values.map(
        async proxyCollection => proxyCollection.rollbackChange({txnId})));
      this._throwAnyRejection({results});

      // clear transaction from record
      if(!await helper.update({id, oldTxn: newTxn})) {
        // some other transaction is being applied / rolled back, abort
        this.throwAbortError();
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

  async updateProxyRecords({record, data, txn} = {}) {
    // determine proxy operations to be run
    let ops = this._createPrepareProxyOperations({record, data, txn});

    // used to track proxy records that are blocking proxy operations; these
    // are tracked by the record ID associated with their pending transactions
    const blockingProxyRecords = new Map();

    // keep attempting to run all proxy operations until all have been
    // completed or rollback for `record` is required
    const {recordCollection: {dataField}} = this;
    const recordId = record[dataField].id;
    while(ops.length > 0) {
      const tmp = ops;
      ops = [];
      // wait for all proxy operations to settle
      let results = await Promise.allSettled(tmp.map(async op => {
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
      this._throwAnyRejection({results});

      // process all pending transactions to unblock ops
      const entries = [...blockingProxyRecords.entries()];
      results = await Promise.allSettled(
        entries.map(async ([id, blockingProxyRecords]) => {
          try {
            await this.processAnyPendingTransaction({id, blockingProxyRecords});
          } catch(e) {
            if(e.name !== 'AbortError') {
              // unrecoverable error
              throw e;
            }
          }
        }));
      this._throwAnyRejection({results});
    }
  }

  throwAbortError() {
    const error = new Error('Transaction operation aborted.');
    error.name = 'AbortError';
    throw error;
  }

  async _completeProxyOperations({record, data, txn} = {}) {
    // determine proxy operations to be run in a transaction
    const {recordCollection: {dataField, proxyCollections}} = this;
    const entries = [...proxyCollections.values()];
    const results = await Promise.allSettled(
      entries.map(async ([k, proxyCollection]) => {
        // FIXME: ensure that these are correct
        const newValue = data ? data[k] : record[dataField][k];
        const oldValue = record[dataField][k];
        await proxyCollection.completeChange(
          {txnId: txn.id, oldValue, newValue});
      }));
    this._throwAnyRejection({results});
  }

  async _runProxyOperation({recordId, txnId, op} = {}) {
    // keep trying to run op, handling any concurrent changes to the proxy
    // record based on the type of op, until the op completes or throws
    const {type, proxyCollection, uniqueValue} = op;
    // FIXME: place a limit on attempts?
    while(true) {
      try {
        if(type === 'insert') {
          await proxyCollection.insert({uniqueValue, recordId, txnId});
        } else {
          // `type` must be `delete` and this should perform an update to
          // mark the proxy record to be deleted, not actually delete it
          if(!await proxyCollection.prepareRemove({recordId, txnId})) {
            this.throwAbortError();
          }
        }
        // successful op
        return {success: true};
      } catch(e) {
        const aborted = e.name === 'AbortError';
        const duplicate = e.name === 'DuplicateError';
        if(!(aborted || duplicate)) {
          // FIXME: ensure to test simulated unrecoverable error
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

  _throwAnyRejection({results} = {}) {
    // throw any error that occurred
    const rejected = results.find(({status}) => status === 'rejected');
    if(rejected) {
      throw rejected.reason;
    }
  }
}
